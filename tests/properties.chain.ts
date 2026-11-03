// On-chain property tests: random inputs (fast-check) run against the local validator and are
// compared with the reference model in tests/model.ts. IDs refer to docs/audit/INVARIANTS.md.
// "FIX-xx" tests were the audit's "GAP-xx" tests: they proved each finding of
// docs/audit/INVARIANTS.md §9 and now assert the fixed (v4.1) behaviour.
// Runs inside `anchor test` after tests/noxvault.ts (it reuses the protocol account if present).
// Run counts are small on purpose (each run signs and sends several transactions); raise them
// with FC_CHAIN_RUNS=<n>. Seed a failing run with FC_SEED=<seed>.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import fc from "fast-check";
import { Noxvault } from "../target/types/noxvault";
import * as wots from "../sdk/wots";
import * as M from "./model";
import {
  Signer,
  buildSteps,
  executeIx,
  executePendingIx,
  fetchApproval,
  MAX_ACTION_FEE,
  fetchLetterKey,
  fetchProtocol,
  fetchState,
  initProtocolIx,
  initVaultIx,
  makeConfig,
  makeDuressSigner,
  makeSigner,
  migrateIxs,
  newMasterSecret,
  packSteps,
  planAction,
  spendBudgetIx,
  statePda,
  toAnchorAction,
  unlockPda,
  vaultBudgets,
  vaultOf,
  writeLetterIxs,
  closeLetterIx,
  letterPda,
  RECOVERY_TREE,
} from "../sdk/client";

const SOL = (n: number) => BigInt(Math.round(n * LAMPORTS_PER_SOL));
const ZERO = new Uint8Array(32);
const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
const chainRuns = (n: number) => ({ numRuns: Number(process.env.FC_CHAIN_RUNS ?? n), ...(seed !== undefined ? { seed } : {}), endOnFailure: true });
const fee0 = { fee: 0n, feePayee: ZERO };
const withdraw = (dest: PublicKey, amount: bigint, fee = 0n, feePayee: PublicKey = PublicKey.default): wots.Action => ({
  kind: "withdraw",
  mint: ZERO,
  dest: dest.toBytes(),
  amount,
  fee,
  feePayee: feePayee.toBytes(),
});

const CODES = ["FeeTooHigh", "FeeInLockdown", "DuplicateRoot", "BudgetDestRestricted", "DurationTooLong", "WrongDest", "NotYet", "KeyUsed", "BadTree", "BadSignature", "NotWhitelisted", "PendingExists", "Lockdown", "DuressSolOnly", "NotApproved", "NotLetterKey", "RentDust", "InsufficientFunds", "ZeroAmount", "DestIsVault"];

describe("properties (on chain)", function () {
  this.timeout(600_000);
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.noxvault as Program<Noxvault>;
  const conn = provider.connection;
  const payer = provider.wallet.publicKey;
  const wallet = (provider.wallet as anchor.Wallet).payer;

  let owner: Signer; // one signer tree reused across vaults: every digest names its vault
  let duress: Signer;
  let rec: Signer;
  let unique = 0n; // makes every generated config (and so every vault address) distinct
  const leaves = new Map<string, number>();
  const nextLeaf = (v: PublicKey, tree: number) => {
    const k = `${v.toBase58()}/${tree}`;
    const l = leaves.get(k) ?? 0;
    leaves.set(k, l + 1);
    return l;
  };

  async function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const tx = new Transaction().add(...ixs);
    if (signers.length) tx.feePayer = signers[0].publicKey;
    return signers.length
      ? anchor.web3.sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" })
      : provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
  }
  const fund = (to: PublicKey, lamports: bigint) => send([SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: Number(lamports) })]);
  const balance = async (k: PublicKey) => BigInt(await conn.getBalance(k, "confirmed"));
  const codeOf = (e: unknown) => {
    const s = String(e) + JSON.stringify((e as { logs?: string[] }).logs ?? []);
    return CODES.find((c) => s.includes(c)) ?? s.slice(0, 300);
  };

  /** Signs and sends an action; returns "ok" or the program error code. Never leaves a buffer open. */
  async function act(signer: Signer, v: PublicKey, action: wots.Action, execute?: boolean): Promise<string> {
    const leaf = nextLeaf(v, signer.tree);
    const plan = await planAction({ program, payer, vault: v, signer, leaf, action, execute });
    try {
      for (const t of plan.transactions) await send(t.instructions);
      return "ok";
    } catch (e) {
      if (await conn.getAccountInfo(unlockPda(v, payer, program.programId), "confirmed"))
        await send([await program.methods.cancelUnlock().accountsPartial({ payer, unlock: unlockPda(v, payer, program.programId) }).instruction()]);
      return codeOf(e);
    }
  }

  async function newVault(settings: Parameters<typeof makeConfig>[1], signer = owner) {
    unique += 1n;
    // duress_limit doubles as a uniquifier so fast-check never generates the same vault twice.
    const config = makeConfig(signer, { ...settings, duressLimitLamports: (settings?.duressLimitLamports ?? SOL(0.5)) + unique });
    const v = vaultOf(config, program.programId);
    await send([await initVaultIx(program, payer, config)]);
    return { vault: v, config };
  }

  async function giveNox(v: PublicKey, amount: bigint) {
    const p = await fetchProtocol(program);
    if (!p || p.noxMint.equals(PublicKey.default)) return; // tiers off
    const a = await getOrCreateAssociatedTokenAccount(conn, wallet, p.noxMint, v, true, "confirmed", { commitment: "confirmed" });
    await mintTo(conn, wallet, p.noxMint, a.address, wallet, amount, [], { commitment: "confirmed" });
  }

  before(async () => {
    if (!(await fetchProtocol(program)))
      await send([await initProtocolIx(program, payer, { noxMint: PublicKey.default, guardian: 0n, sentinel: 0n, createFee: 0n, treasury: payer })]);
    owner = makeSigner(newMasterSecret(), 0, 0);
    duress = makeDuressSigner(newMasterSecret(), 0);
    rec = makeSigner(newMasterSecret(), 0, RECOVERY_TREE);
  });

  // ---------- one-time keys ----------

  it("P-21 a burned leaf never opens again, for any action; out-of-range trees and leaves are refused", async () => {
    const { vault: v } = await newVault({});
    await fund(v, SOL(0.1));
    expect(await act(owner, v, { kind: "ping", ...fee0 })).to.eq("ok"); // burns leaf 0 of tree 0
    const key = fc.uint8Array({ minLength: 32, maxLength: 32 });
    const action = fc.oneof(
      fc.record({ kind: fc.constant("withdraw" as const), mint: fc.constant(ZERO), dest: key, amount: fc.bigInt({ min: 1n, max: 1_000_000n }), fee: fc.constant(0n), feePayee: fc.constant(ZERO) }),
      fc.record({ kind: fc.constantFrom("ping" as const, "cancel" as const), fee: fc.bigInt({ min: 0n, max: 1000n }), feePayee: key }),
      fc.record({ kind: fc.constant("letterKey" as const), key, fee: fc.constant(0n), feePayee: fc.constant(ZERO) })
    ) as fc.Arbitrary<wots.Action>;
    const target = fc.oneof(
      fc.constant({ tree: 0, leaf: 0, code: "KeyUsed" }),
      fc.integer({ min: 5, max: 255 }).map((tree) => ({ tree, leaf: 1, code: "BadTree" })),
      fc.integer({ min: 256, max: 65535 }).map((leaf) => ({ tree: 0, leaf, code: "BadTree" })),
      // Unused signer slots 1 and 2 (root zero) cannot sign.
      fc.integer({ min: 1, max: 2 }).map((tree) => ({ tree, leaf: 0, code: "BadTree" }))
    );
    const path = wots.authPath(owner.pub, 0).map((p) => Array.from(p));
    await fc.assert(
      fc.asyncProperty(action, target, async (a, t) => {
        const ix = await program.methods
          .openUnlock(t.tree, t.leaf, Array.from(owner.seeds.pkSeed), path, toAnchorAction(a) as never)
          .accountsPartial({ payer, vault: v, state: statePda(v, program.programId), unlock: unlockPda(v, payer, program.programId), systemProgram: SystemProgram.programId })
          .instruction();
        try {
          await send([ix]);
        } catch (e) {
          return codeOf(e) === t.code;
        }
        return false;
      }),
      chainRuns(12)
    );
  });

  it("P-22 a signature made for one vault (or one tree slot) never approves in another; one root never fills two slots", async () => {
    // G-05 fixed: init_vault refuses the same root in two slots (signer, recovery or duress).
    const p = await fetchProtocol(program);
    const sentinel = p && !p.noxMint.equals(PublicKey.default) ? p.sentinel : 0n;
    const dupes = [
      makeConfig(owner, { coSigners: [owner.pub.root], threshold: 2, duressLimitLamports: SOL(0.5) + (unique += 1n) }),
      makeConfig(owner, { recoveryRoot: owner.pub.root, recoveryDelaySecs: 3600, duressLimitLamports: SOL(0.5) + (unique += 1n) }),
      makeConfig(owner, { duressRoot: owner.pub.root, duressLimitLamports: SOL(0.5) + (unique += 1n) }),
    ];
    for (const [i, cfg] of dupes.entries()) {
      await giveNox(vaultOf(cfg, program.programId), sentinel);
      let code = "ok";
      try {
        await send([await initVaultIx(program, payer, cfg)]);
      } catch (e) {
        code = codeOf(e);
      }
      if (code !== "DuplicateRoot") throw new Error(`duplicate-root config #${i}: ${code}`);
    }
    // vB holds another signer in slot 0 and the owner's tree in slot 1. A signature by the owner's
    // tree made for (vA, slot 1) or for (vB, slot 0) never approves as (vB, slot 1): the digest
    // names the vault and the slot.
    unique += 1n;
    const other = makeSigner(newMasterSecret(), 0, 0);
    const cfgB = makeConfig(other, { coSigners: [owner.pub.root], threshold: 2, duressLimitLamports: SOL(0.5) + unique });
    const vB = vaultOf(cfgB, program.programId);
    await giveNox(vB, sentinel);
    await send([await initVaultIx(program, payer, cfgB)]);
    const { vault: vA } = await newVault({});
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 1n, max: SOL(1) }), fc.constantFrom("vault", "slot"), async (amount, how) => {
        const action = withdraw(Keypair.generate().publicKey, amount);
        const leaf = nextLeaf(vB, 1);
        const [sv, st] = how === "vault" ? [vA, 1] : [vB, 0];
        const d = wots.messageDigest(program.programId.toBytes(), sv.toBytes(), st, leaf, wots.encodeAction(action));
        const signature = wots.sign(owner.seeds, leaf, d);
        const steps = await buildSteps(program, payer, { vault: vB, tree: 1, leaf, pkSeed: owner.seeds.pkSeed, authPath: wots.authPath(owner.pub, leaf), signature, action }, { execute: false });
        let code = "ok";
        try {
          for (const t of packSteps(payer, steps)) await send(t.instructions);
        } catch (e) {
          code = codeOf(e);
        }
        await send([await program.methods.cancelUnlock().accountsPartial({ payer, unlock: unlockPda(vB, payer, program.programId) }).instruction()]);
        const state = (await fetchState(program, vB))!;
        const burned = (state.used[1][leaf >> 3] & (1 << (leaf & 7))) !== 0;
        return code === "BadSignature" && !burned;
      }),
      chainRuns(2)
    );
  });

  // ---------- spending rules: chain vs model ----------

  it("P-23 whitelist / instant limit / slow delay: the program pays, queues and refuses exactly like the model", async () => {
    const friend = Keypair.generate().publicKey;
    const scenario = fc.record({
      whitelist: fc.boolean(),
      instantLimit: fc.constantFrom(0n, SOL(0.1), SOL(0.3)),
      slowDelay: fc.constantFrom(0n, 3600n),
      steps: fc.array(fc.record({ toFriend: fc.boolean(), amount: fc.integer({ min: 1, max: 25 }).map((c) => SOL(c / 100)) }), { minLength: 2, maxLength: 3 }),
    });
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const stranger = Keypair.generate().publicKey;
        const { vault: v, config } = await newVault({ whitelist: s.whitelist ? [friend] : [], instantLimitLamports: s.instantLimit, slowDelaySecs: Number(s.slowDelay) });
        await fund(v, SOL(1));
        const c: M.RuleConfig = {
          whitelist: config.whitelist.map((k) => new PublicKey(k).toBase58()),
          slowDelay: s.slowDelay,
          instantLimit: s.instantLimit,
          threshold: 1,
          recoveryDelay: 0n,
          duressLimit: config.duressLimit,
          duressLock: config.duressLock,
        };
        const st0 = (await fetchState(program, v))!;
        const model: M.RuleState = { windowStart: BigInt(st0.windowStart), windowSpent: 0n, pending: null, lockdownUntil: 0n, lastActive: 0n };
        for (const step of s.steps) {
          const dest = step.toFriend ? friend : stranger;
          let want: string;
          try {
            want = M.gate(model, c, 0, M.SOL_MINT, dest.toBase58(), step.amount, false, model.windowStart + 1n) ? "paid" : "queued";
          } catch (e) {
            want = (e as M.RuleError).code;
          }
          const before = await balance(dest);
          const got = await act(owner, v, withdraw(dest, step.amount));
          const paid = (await balance(dest)) - before;
          const st = (await fetchState(program, v))!;
          const result = got !== "ok" ? got : paid === step.amount ? "paid" : st.pending?.dest.equals(dest) && st.pending.amount === step.amount && paid === 0n ? "queued" : `?paid=${paid}`;
          if (result !== want) throw new Error(`step ${JSON.stringify({ ...step, amount: String(step.amount) })}: chain ${result}, model ${want}`);
          if (st.windowSpent !== model.windowSpent) throw new Error(`window_spent: chain ${st.windowSpent}, model ${model.windowSpent}`);
        }
        return true;
      }),
      chainRuns(4)
    );
  });

  // ---------- duress ----------

  it("P-24 a duress withdrawal pays exactly the model's amount, never above duress_limit, and locks", async () => {
    const rentMin = BigInt(await conn.getMinimumBalanceForRentExemption(0));
    const scenario = fc.record({
      limit: fc.integer({ min: 1, max: 100 }).map((c) => SOL(c / 100)),
      funded: fc.integer({ min: 1, max: 150 }).map((c) => SOL(c / 100)),
      amount: fc.integer({ min: 1, max: 200 }).map((c) => SOL(c / 100)),
      fee: fc.constantFrom(0n, SOL(0.005), MAX_ACTION_FEE), // v4.1: fees above MAX_ACTION_FEE never sign
    });
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { vault: v, config } = await newVault({ duressRoot: duress.pub.root, duressLimitLamports: s.limit, duressLockSecs: 86_400 });
        await fund(v, s.funded);
        const dest = Keypair.generate().publicKey;
        const relayer = Keypair.generate().publicKey;
        await fund(dest, SOL(0.01));
        await fund(relayer, SOL(0.01));
        const c: M.RuleConfig = { whitelist: [], slowDelay: 0n, instantLimit: 0n, threshold: 1, recoveryDelay: 0n, duressLimit: config.duressLimit, duressLock: config.duressLock };
        const st: M.RuleState = { windowStart: 0n, windowSpent: 0n, pending: null, lockdownUntil: 0n, lastActive: 0n };
        const vaultBefore = await balance(v);
        const t0 = BigInt(Math.floor(Date.now() / 1000));
        const want = M.duressPayout(st, c, vaultBefore, rentMin, s.amount, s.fee, t0);
        const [d0, r0] = [await balance(dest), await balance(relayer)];
        const got = await act(duress, v, withdraw(dest, s.amount, s.fee, s.fee > 0n ? relayer : PublicKey.default));
        if (got !== "ok") throw new Error(`duress withdrawal failed: ${got}`);
        const paid = (await balance(dest)) - d0;
        const fee = (await balance(relayer)) - r0;
        const after = (await fetchState(program, v))!;
        if (paid !== want.paid || fee !== want.fee) throw new Error(`chain paid ${paid} + fee ${fee}, model ${want.paid} + ${want.fee}`);
        if (paid + fee > config.duressLimit) return false;
        if (BigInt(after.lockdownUntil) < t0 - 5n + config.duressLock) return false;
        // A second duress withdrawal during the lockdown pays nothing more.
        const d1 = await balance(dest);
        if ((await act(duress, v, withdraw(dest, s.amount))) !== "ok") return false;
        return (await balance(dest)) === d1;
      }),
      chainRuns(4)
    );
  });

  // ---------- sealed letters ----------

  it("P-25 letter-key operations never move vault lamports or touch vault state, for any sequence", async () => {
    const lk = Keypair.generate();
    const stranger = Keypair.generate();
    const { vault: v } = await newVault({});
    await fund(v, SOL(0.3));
    await fund(lk.publicKey, SOL(2));
    await fund(stranger.publicKey, SOL(0.1));
    expect(await act(owner, v, { kind: "letterKey", key: lk.publicKey.toBytes(), ...fee0 })).to.eq("ok");
    expect((await fetchLetterKey(program, v))!.key.equals(lk.publicKey)).to.eq(true);
    const op = fc.oneof(
      fc.record({ op: fc.constant("write" as const), id: fc.integer({ min: 0, max: 2 }), len: fc.integer({ min: 1, max: 3000 }), label: fc.string({ maxLength: 20 }), round: fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }) }),
      fc.record({ op: fc.constant("close" as const), id: fc.integer({ min: 0, max: 2 }) }),
      fc.record({ op: fc.constant("stranger" as const), id: fc.integer({ min: 0, max: 2 }) })
    );
    const stateKey = statePda(v, program.programId);
    const snapshot = async () => ({ lamports: await balance(v), state: (await conn.getAccountInfo(stateKey, "confirmed"))!.data.toString("hex") });
    const base = await snapshot();
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 4 }), async (ops) => {
        for (const o of ops) {
          const exists = !!(await conn.getAccountInfo(letterPda(v, o.id, program.programId), "confirmed"));
          if (o.op === "write") {
            const data = Uint8Array.from({ length: o.len }, (_, i) => (i * 7 + o.len) & 0xff);
            for (const ix of await writeLetterIxs(program, lk.publicKey, v, o.id, { unlockRound: o.round, label: o.label, ciphertext: data })) await send([ix], [lk]);
          } else if (o.op === "close" && exists) {
            await send([await closeLetterIx(program, lk.publicKey, v, o.id)], [lk]);
          } else if (o.op === "stranger") {
            try {
              await send(await writeLetterIxs(program, stranger.publicKey, v, o.id, { unlockRound: 1n, label: "x", ciphertext: new Uint8Array(10) }), [stranger]);
              return false;
            } catch (e) {
              if (codeOf(e) !== "NotLetterKey") return false;
            }
          }
          const now = await snapshot();
          if (now.lamports !== base.lamports || now.state !== base.state) return false;
        }
        return true;
      }),
      chainRuns(5)
    );
  });

  // ---------- audit findings, fixed in v4.1 (docs/audit/INVARIANTS.md §9) ----------

  describe("audit findings G-01..G-05, G-08: fixed in v4.1", () => {
    const codeOfSend = async (p: Promise<unknown>) => {
      try {
        await p;
        return "ok";
      } catch (e) {
        return codeOf(e);
      }
    };

    it("FIX-01 (G-01) during a duress lockdown a signer Ping or Cancel pays no fee; a recovery Cancel may pay the capped fee", async () => {
      const attacker = Keypair.generate().publicKey;
      const relayer = Keypair.generate().publicKey;
      const limit = SOL(0.05);
      const { vault: v } = await newVault({
        duressRoot: duress.pub.root,
        duressLimitLamports: limit,
        whitelist: [Keypair.generate().publicKey],
        slowDelaySecs: 0,
        recoveryRoot: rec.pub.root,
        recoveryDelaySecs: 86_400,
      });
      await fund(v, SOL(1));
      await fund(attacker, SOL(0.01));
      await fund(relayer, SOL(0.01));
      // A Ping with a fee, approved (not executed) before the lockdown.
      const early: wots.Action = { kind: "ping", fee: MAX_ACTION_FEE, feePayee: attacker.toBytes() };
      expect(await act(owner, v, early, false)).to.eq("ok");
      expect(await fetchApproval(program, v, early)).to.not.eq(null);
      expect(await act(duress, v, withdraw(attacker, SOL(1)))).to.eq("ok");
      const st = (await fetchState(program, v))!;
      expect(st.lockdownUntil).to.be.greaterThan(Math.floor(Date.now() / 1000));
      const vaultAfterDuress = await balance(v);
      // A signer withdrawal is refused; a signer Ping or Cancel with a fee never even opens...
      expect(await act(owner, v, withdraw(attacker, SOL(0.1)), true)).to.eq("Lockdown");
      expect(await act(owner, v, { kind: "ping", fee: SOL(0.5), feePayee: attacker.toBytes() })).to.eq("FeeTooHigh");
      expect(await act(owner, v, { kind: "ping", fee: 1n, feePayee: attacker.toBytes() })).to.eq("FeeInLockdown");
      expect(await act(owner, v, { kind: "cancel", fee: MAX_ACTION_FEE, feePayee: attacker.toBytes() })).to.eq("FeeInLockdown");
      // ...and the approval made before the lockdown does not execute during it (authorize).
      expect(await codeOfSend(send([await executeIx(program, payer, v, early, payer)]))).to.eq("FeeInLockdown");
      // With fee 0 they work, and nothing leaves the vault.
      expect(await act(owner, v, { kind: "ping", ...fee0 })).to.eq("ok");
      expect(await balance(v)).to.eq(vaultAfterDuress);
      // The recovery holder's Cancel may pay a (capped) relayer fee, and ends the lockdown.
      const r0 = await balance(relayer);
      expect(await act(rec, v, { kind: "cancel", fee: MAX_ACTION_FEE, feePayee: relayer.toBytes() })).to.eq("ok");
      expect((await balance(relayer)) - r0).to.eq(MAX_ACTION_FEE);
      expect((await fetchState(program, v))!.lockdownUntil).to.eq(0);
    });

    it("FIX-01b (G-01) a fee above MAX_ACTION_FEE never signs, on any vault; within the cap it pays exactly the fee", async () => {
      const stranger = Keypair.generate().publicKey;
      const { vault: v } = await newVault({ whitelist: [Keypair.generate().publicKey], slowDelaySecs: 0 });
      await fund(v, SOL(1));
      await fund(stranger, SOL(0.01));
      expect(await act(owner, v, withdraw(stranger, SOL(0.1)))).to.eq("NotWhitelisted");
      await fc.assert(
        fc.asyncProperty(fc.bigInt({ min: MAX_ACTION_FEE + 1n, max: SOL(0.9) }), fc.constantFrom("ping" as const, "cancel" as const), async (fee, kind) => {
          const before = await balance(v);
          const code = await act(owner, v, { kind, fee, feePayee: stranger.toBytes() });
          return code === "FeeTooHigh" && (await balance(v)) === before;
        }),
        chainRuns(3)
      );
      const before = await balance(stranger);
      expect(await act(owner, v, { kind: "ping", fee: MAX_ACTION_FEE, feePayee: stranger.toBytes() })).to.eq("ok");
      expect((await balance(stranger)) - before).to.eq(MAX_ACTION_FEE);
    });

    it("FIX-02 (G-02) Migrate obeys the instant limit (waits slow_delay, cancellable); in strict mode it is refused", async () => {
      const { vault: v } = await newVault({ instantLimitLamports: SOL(0.1), slowDelaySecs: 86_400, recoveryRoot: rec.pub.root, recoveryDelaySecs: 86_400 });
      await fund(v, SOL(1));
      const thief = makeSigner(newMasterSecret(), 0, 0);
      const { vault: theirs } = await newVault({}, thief);
      expect(await act(owner, v, { kind: "migrate", newVault: theirs.toBytes(), ...fee0 })).to.eq("ok");
      let st = (await fetchState(program, v))!;
      expect(st.migrateTo).to.eq(null);
      expect(st.pending?.kind).to.eq("migrate");
      expect(st.pending?.dest.equals(theirs)).to.eq(true);
      expect(Number(st.pending!.executableAt)).to.be.greaterThan(Math.floor(Date.now() / 1000) + 86_000);
      expect(await codeOfSend(send([await executePendingIx(program, payer, v, st)]))).to.eq("NotYet");
      // The recovery holder cancels it within the delay.
      expect(await act(rec, v, { kind: "cancel", ...fee0 })).to.eq("ok");
      st = (await fetchState(program, v))!;
      expect(st.pending).to.eq(null);
      expect(st.migrateTo).to.eq(null);
      expect(await balance(v)).to.eq(SOL(1));
      // Strict whitelist: a migration to a non-whitelisted vault is refused outright.
      const { vault: strict } = await newVault({ whitelist: [Keypair.generate().publicKey], slowDelaySecs: 0 });
      await fund(strict, SOL(0.1));
      expect(await act(owner, strict, { kind: "migrate", newVault: theirs.toBytes(), ...fee0 })).to.eq("NotWhitelisted");
      expect((await fetchState(program, strict))!.migrateTo).to.eq(null);
    });

    it("FIX-03 (G-03) budgets: refused on an instant-limit vault without whitelist, and spend only to the whitelist", async () => {
      const p = await fetchProtocol(program);
      const guardian = p && !p.noxMint.equals(PublicKey.default) ? p.guardian : 0n;
      const session = Keypair.generate();
      await fund(session.publicKey, SOL(0.05));
      const expires = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const budget = (id: number): wots.Action => ({ kind: "budget", id, session: session.publicKey.toBytes(), mint: ZERO, limit: SOL(10), period: 86_400n, expires, ...fee0 });
      // No whitelist + instant limit: every destination is restricted, so no budget.
      const { vault: v } = await newVault({ instantLimitLamports: SOL(0.1), slowDelaySecs: 86_400 });
      await giveNox(v, guardian);
      await fund(v, SOL(1));
      expect(await act(owner, v, budget(0))).to.eq("BudgetDestRestricted");
      expect(await vaultBudgets(program, v)).to.have.length(0);
      // Whitelist vault: the session key pays the whitelist only.
      const friend = Keypair.generate().publicKey;
      await fund(friend, SOL(0.01));
      const { vault: w } = await newVault({ whitelist: [friend], instantLimitLamports: SOL(0.1), slowDelaySecs: 86_400 });
      await giveNox(w, guardian);
      await fund(w, SOL(1));
      expect(await act(owner, w, budget(1))).to.eq("ok");
      const [b] = await vaultBudgets(program, w);
      const stranger = Keypair.generate().publicKey;
      expect(await codeOfSend(send([await spendBudgetIx(program, w, b, stranger, SOL(0.05))], [session]))).to.eq("BudgetDestRestricted");
      expect(await balance(stranger)).to.eq(0n);
      await send([await spendBudgetIx(program, w, b, friend, SOL(0.5))], [session]);
      expect(await balance(friend)).to.eq(SOL(0.51));
    });

    it("FIX-04 (G-04) a Cancel from the signers or from the recovery tree stops a started migration", async () => {
      const { vault: target } = await newVault({});
      const { vault: v } = await newVault({ whitelist: [target], slowDelaySecs: 3600, recoveryRoot: rec.pub.root, recoveryDelaySecs: 86_400 });
      await fund(v, SOL(0.5));
      for (const who of [owner, rec]) {
        expect(await act(owner, v, { kind: "migrate", newVault: target.toBytes(), ...fee0 })).to.eq("ok");
        let st = (await fetchState(program, v))!;
        expect(st.migrateTo?.equals(target)).to.eq(true);
        expect(await act(who, v, { kind: "cancel", ...fee0 })).to.eq("ok");
        st = (await fetchState(program, v))!;
        expect(st.migrateTo).to.eq(null);
        // The sweep is refused from now on.
        expect(await codeOfSend(send(await migrateIxs(program, payer, v, { ...st, migrateTo: target }, [])))).to.eq("WrongDest");
      }
      expect(await balance(v)).to.eq(SOL(0.5));
    });

    it("FIX-08 (G-08) delays above 10 years are refused at init; intervals and periods above 10 years never sign", async () => {
      const TOO_LONG = 10 * 365 * 86_400 + 1;
      const settings = [{ slowDelaySecs: TOO_LONG }, { duressLockSecs: TOO_LONG }, { recoveryRoot: rec.pub.root, recoveryDelaySecs: TOO_LONG }];
      for (const s of settings) {
        unique += 1n;
        const cfg = makeConfig(owner, { ...s, duressLimitLamports: SOL(0.5) + unique });
        expect(await codeOfSend(send([await initVaultIx(program, payer, cfg)]))).to.eq("DurationTooLong");
      }
      // i64::MAX used to make `now + slow_delay` abort; now it is refused up front.
      unique += 1n;
      const huge = { ...makeConfig(owner, { duressLimitLamports: SOL(0.5) + unique }), slowDelay: (1n << 63n) - 1n };
      expect(await codeOfSend(send([await initVaultIx(program, payer, huge)]))).to.eq("DurationTooLong");
      const { vault: v } = await newVault({});
      await fund(v, SOL(0.1));
      const dest = Keypair.generate().publicKey.toBytes();
      expect(await act(owner, v, { kind: "schedule", id: 0, mint: ZERO, dest, amount: 1n, interval: (1n << 63n) - 1n, count: 2, start: 0n, ...fee0 })).to.eq("DurationTooLong");
      expect(await act(owner, v, { kind: "budget", id: 0, session: dest, mint: ZERO, limit: 1n, period: BigInt(TOO_LONG), expires: 1n << 62n, ...fee0 })).to.eq("DurationTooLong");
    });
  });
});
