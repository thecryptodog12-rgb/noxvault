import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { expect } from "chai";
import { Noxvault } from "../target/types/noxvault";
import * as wots from "../sdk/wots";
import { checkRelay, decodeRelayRequest, encodeRelayRequest, relay } from "../sdk/relayer";
import {
  ActionPlan,
  HASHES_PER_TX,
  RECOVERY_TREE,
  SignedAction,
  Signer,
  budgetPda,
  buildEscapeSolTx,
  createNonceIxs,
  escapeApproveIx,
  escapeTokenIx,
  executeIx,
  executePendingIx,
  fetchApproval,
  fetchCanary,
  fetchLink,
  fetchState,
  findSignedMessages,
  findVaultsFor,
  inboxPda,
  initCanaryIx,
  initVaultIx,
  inSlot,
  leafUsed,
  makeConfig,
  makeSigner,
  migrateIxs,
  newMasterSecret,
  pickLeaf,
  planAction,
  preflightAction,
  raiseBaselineIx,
  registerLinkIx,
  requestLinkChangeIx,
  applyLinkChangeIx,
  runScheduleIx,
  secretToWords,
  setEscapeTxIx,
  setPanicIx,
  spendBudgetIx,
  stakePda,
  sweepInboxIxs,
  testamentIxs,
  tripCanaryIx,
  unlockPda,
  vaultBudgets,
  vaultOf,
  vaultSchedules,
  verifyRanges,
  wordsToSecret,
  CANARY_ADDRESS,
  TIER_FREE,
  TIER_GUARDIAN,
  TIER_SENTINEL,
  fetchProtocol,
  initProtocolIx,
  vaultTier,
} from "../sdk/client";

const SOL = (n: number) => BigInt(Math.round(n * LAMPORTS_PER_SOL));
const ZERO = new Uint8Array(32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => BigInt(Math.floor(Date.now() / 1000));

describe("noxvault v3", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.noxvault as Program<Noxvault>;
  const conn = provider.connection;
  const payer = provider.wallet.publicKey;
  const wallet = (provider.wallet as anchor.Wallet).payer;
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  const master = newMasterSecret();
  let primary: Signer;
  let vault: PublicKey;
  let mint: PublicKey;
  let nox: PublicKey; // test $NOX, 0 decimals
  const treasury = Keypair.generate().publicKey;
  const GUARDIAN = 1_000n;
  const SENTINEL = 10_000n;
  const CREATE_FEE = SOL(0.01);

  /** Puts $NOX in a vault (its ATA is created even before the vault is initialized). */
  async function giveNox(v: PublicKey, amount: bigint) {
    const a = await getOrCreateAssociatedTokenAccount(conn, wallet, nox, v, true, "confirmed", { commitment: "confirmed" });
    await mintTo(conn, wallet, nox, a.address, wallet, amount, [], { commitment: "confirmed" });
  }

  async function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    let sig = "";
    for (let attempt = 1; ; attempt++) {
      try {
        sig = await provider.sendAndConfirm(new Transaction().add(...ixs), signers, { commitment: "confirmed" });
        break;
      } catch (e) {
        if (attempt >= 4 || !/Blockhash not found/.test(String(e))) throw e;
        await sleep(1000);
      }
    }
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    return tx?.meta?.computeUnitsConsumed ?? 0;
  }

  async function run(plan: ActionPlan, as?: Keypair, log = false) {
    for (const t of plan.transactions) {
      if (as) {
        const tx = new Transaction().add(...t.instructions);
        tx.feePayer = as.publicKey;
        await anchor.web3.sendAndConfirmTransaction(conn, tx, [as], { commitment: "confirmed" });
      } else {
        const cu = await send(t.instructions);
        if (log) console.log(`      ${t.label}: ${cu} CU`);
      }
    }
  }

  async function fund(to: PublicKey, sol: number) {
    await send([SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: Number(SOL(sol)) })]);
  }

  async function cancel(v: PublicKey, who = payer) {
    await send([await program.methods.cancelUnlock().accountsPartial({ payer: who, unlock: unlockPda(v, who, program.programId) }).instruction()]);
  }

  async function expectError(p: Promise<unknown>, code: string) {
    try {
      await p;
    } catch (e) {
      expect(String(e) + JSON.stringify((e as any).logs ?? [])).to.contain(code);
      return;
    }
    expect.fail(`expected ${code}`);
  }

  const fee0 = { fee: 0n, feePayee: ZERO };
  const withdraw = (dest: PublicKey, amount: bigint, fee = 0n, feePayee: PublicKey = PublicKey.default): wots.Action => ({
    kind: "withdraw",
    mint: ZERO,
    dest: dest.toBytes(),
    amount,
    fee,
    feePayee: feePayee.toBytes(),
  });

  async function act(signer: Signer, v: PublicKey, action: wots.Action, opts: { leaf?: number; as?: Keypair; log?: boolean } = {}) {
    const state = (await fetchState(program, v))!;
    const leaf = opts.leaf ?? pickLeaf(state, signer, await findSignedMessages(program, v, signer)).leaf;
    const plan = await planAction({ program, payer: opts.as?.publicKey ?? payer, vault: v, signer, leaf, action });
    await run(plan, opts.as, opts.log);
    return { plan, leaf };
  }

  async function newVault(settings: Parameters<typeof makeConfig>[1] = {}, signer?: Signer, noxAmount = 0n) {
    const s = signer ?? makeSigner(newMasterSecret(), 0, 0);
    const config = makeConfig(s, settings);
    const v = vaultOf(config, program.programId);
    if (noxAmount > 0n) await giveNox(v, noxAmount);
    await send([await initVaultIx(program, payer, config)]);
    return { signer: s, vault: v, config };
  }

  before(async () => {
    primary = makeSigner(master, 0, 0);
    vault = vaultOf(makeConfig(primary), program.programId);
    mint = await createMint(conn, wallet, payer, null, 6);
    nox = await createMint(conn, wallet, payer, null, 0);
    await send([await initCanaryIx(program, payer)]);
    await send([await initProtocolIx(program, payer, { noxMint: nox, guardian: GUARDIAN, sentinel: SENTINEL, createFee: CREATE_FEE, treasury })]);
  });

  // ---------- core ----------

  it("builds trees whose signatures rebuild the root, and nothing else does", () => {
    const leaf = 37;
    const d = wots.messageDigest(program.programId.toBytes(), vault.toBytes(), 0, leaf, wots.encodeAction(withdraw(payer, 5n)));
    const sig = wots.sign(primary.seeds, leaf, d);
    const path = wots.authPath(primary.pub, leaf);
    expect(wots.equal(wots.recoverRoot(primary.seeds.pkSeed, leaf, d, sig, path), primary.pub.root)).to.eq(true);
    const d2 = d.slice();
    d2[5] ^= 1;
    expect(wots.equal(wots.recoverRoot(primary.seeds.pkSeed, leaf, d2, sig, path), primary.pub.root)).to.eq(false);
    expect(wots.encodeConfig(makeConfig(primary)).length).to.eq(429);
    expect(wots.equal(wordsToSecret(secretToWords(master)), master)).to.eq(true);
    const worst = wots.verifyCost(new Uint8Array(32));
    for (const [from, to] of verifyRanges(worst, HASHES_PER_TX)) expect(worst.slice(from, to).reduce((a, b) => a + b, 0)).to.be.at.most(HASHES_PER_TX);
  });

  it("initializes a vault; the address commits to the rules; a free-tier vault pays the creation fee", async () => {
    expect((await fetchProtocol(program))!.noxMint.equals(nox)).to.eq(true);
    expect((await vaultTier(program, vault)).tier).to.eq(TIER_FREE);
    await send([await initVaultIx(program, payer, makeConfig(primary))]);
    expect(await conn.getBalance(treasury)).to.eq(Number(CREATE_FEE));
    const st = (await fetchState(program, vault))!;
    expect(wots.equal(st.config.trees[0].root, primary.pub.root)).to.eq(true);
    expect(vaultOf(makeConfig(primary, { whitelist: [payer], slowDelaySecs: 60 }), program.programId).equals(vault)).to.eq(false);
  });

  it("withdraws SOL from the same address, through approve + execute", async () => {
    await fund(vault, 6);
    const dest = Keypair.generate().publicKey;
    await act(primary, vault, withdraw(dest, SOL(0.5)), { log: true });
    await act(primary, vault, withdraw(dest, SOL(0.25)));
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.75)));
    const st = (await fetchState(program, vault))!;
    expect(leafUsed(st, 0, 0) && leafUsed(st, 0, 1) && !leafUsed(st, 0, 2)).to.eq(true);
  });

  it("lets a relayer send everything and get paid by the vault", async () => {
    const relayer = Keypair.generate();
    await fund(relayer.publicKey, 0.1);
    const rp = new Program<Noxvault>(program.idl, new anchor.AnchorProvider(conn, new anchor.Wallet(relayer), { commitment: "confirmed" }));
    const st = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st, primary, await findSignedMessages(program, vault, primary));
    const sign = (action: wots.Action): SignedAction => {
      const d = wots.messageDigest(program.programId.toBytes(), vault.toBytes(), 0, leaf, wots.encodeAction(action));
      return { vault, tree: 0, leaf, pkSeed: primary.seeds.pkSeed, authPath: wots.authPath(primary.pub, leaf), signature: wots.sign(primary.seeds, leaf, d), action };
    };
    const dest = Keypair.generate().publicKey;
    const policy = { minFee: SOL(0.001) };
    expect(await checkRelay(rp, relayer.publicKey, sign(withdraw(dest, SOL(0.01), 1000n, relayer.publicKey)), policy)).to.contain("fee must be at least");
    const good = sign(withdraw(dest, SOL(0.01), SOL(0.001), relayer.publicKey));
    expect(await checkRelay(rp, relayer.publicKey, { ...good, action: withdraw(payer, SOL(0.01), SOL(0.001), relayer.publicKey) }, policy)).to.contain("signature does not match");
    const before = await conn.getBalance(relayer.publicKey);
    await relay(rp, relayer, decodeRelayRequest(JSON.parse(JSON.stringify(encodeRelayRequest(good)))), policy);
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.01)));
    expect(await conn.getBalance(relayer.publicKey)).to.be.greaterThan(before);
  });

  it("relays Sentinel-tier vaults for free, others only for a fee", async () => {
    const relayer = Keypair.generate();
    await fund(relayer.publicKey, 0.1);
    const rp = new Program<Noxvault>(program.idl, new anchor.AnchorProvider(conn, new anchor.Wallet(relayer), { commitment: "confirmed" }));
    const policy = { minFee: SOL(0.001) };
    const signedFor = (s: Signer, v: PublicKey): SignedAction => {
      const action = withdraw(payer, SOL(0.01));
      const d = wots.messageDigest(program.programId.toBytes(), v.toBytes(), 0, 0, wots.encodeAction(action));
      return { vault: v, tree: 0, leaf: 0, pkSeed: s.seeds.pkSeed, authPath: wots.authPath(s.pub, 0), signature: wots.sign(s.seeds, 0, d), action };
    };
    const free = await newVault();
    await fund(free.vault, 0.1);
    expect(await checkRelay(rp, relayer.publicKey, signedFor(free.signer, free.vault), policy)).to.contain("fee must be paid");
    const sentinel = await newVault({}, undefined, SENTINEL);
    await fund(sentinel.vault, 0.1);
    expect(await checkRelay(rp, relayer.publicKey, signedFor(sentinel.signer, sentinel.vault), policy)).to.eq(null);
    await relay(rp, relayer, signedFor(sentinel.signer, sentinel.vault), policy);
    expect(leafUsed((await fetchState(program, sentinel.vault))!, 0, 0)).to.eq(true);
  });

  it("never accepts a used key, and rejects a tampered signature", async () => {
    await expectError(run(await planAction({ program, payer, vault, signer: primary, leaf: 0, action: withdraw(payer, 1000n) })), "KeyUsed");
    const st = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st, primary, await findSignedMessages(program, vault, primary));
    const plan = await planAction({ program, payer, vault, signer: primary, leaf, action: withdraw(payer, 1000n) });
    const forged = wots.F(primary.seeds.pkSeed, leaf, 3, wots.digits(plan.digest)[3], plan.signature[3]);
    const unlock = unlockPda(vault, payer, program.programId);
    const forge = await program.methods.writeSigs(3, [Array.from(forged)]).accountsPartial({ payer, vault, unlock }).instruction();
    const verifyAt = plan.steps.findIndex((s) => s.label.startsWith("verify"));
    for (const s of plan.steps.slice(0, verifyAt)) await send([s.ix]);
    await send([forge]);
    for (const s of plan.steps.slice(verifyAt).filter((s) => s.label.startsWith("verify"))) await send([budget, s.ix]);
    await expectError(send([plan.steps.find((s) => s.label === "approve")!.ix]), "BadSignature");
    await expectError(send([forge]), "Frozen");
    await cancel(vault);
  });

  it("remembers a signed message for good: cancel, another payer or copies cannot get a second one", async () => {
    const st = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st, primary, await findSignedMessages(program, vault, primary));
    const m1 = withdraw(payer, 1000n);
    const plan1 = await planAction({ program, payer, vault, signer: primary, leaf, action: m1 });
    await send(plan1.transactions[0].instructions);
    await cancel(vault);
    const signed = (await findSignedMessages(program, vault, primary)).filter((m) => m.leaf === leaf);
    expect(signed.length).to.eq(1);
    expect(pickLeaf(st, primary, await findSignedMessages(program, vault, primary)).leaf).to.eq(leaf);
    const other = Keypair.generate();
    await fund(other.publicKey, 0.1);
    expect((await preflightAction({ program, payer: other.publicKey, vault, signer: primary, leaf, action: withdraw(payer, 2000n) })).errors.join()).to.contain("already signed");
    const fake = await planAction({ program, payer: other.publicKey, vault, signer: primary, leaf, action: withdraw(other.publicKey, 999n), execute: false });
    const copy = await program.methods
      .writeSigs(0, plan1.signature.slice(0, 12).map((v) => Array.from(v)))
      .accountsPartial({ payer: other.publicKey, vault, unlock: unlockPda(vault, other.publicKey, program.programId) })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(fake.steps[0].ix, copy), [other], { commitment: "confirmed" });
    expect((await findSignedMessages(program, vault, primary)).filter((m) => m.leaf === leaf).length).to.eq(1);
    expect((await preflightAction({ program, payer, vault, signer: primary, leaf, action: m1 })).errors).to.deep.eq([]);
    await run(await planAction({ program, payer, vault, signer: primary, leaf, action: m1 }));
    expect(leafUsed((await fetchState(program, vault))!, 0, leaf)).to.eq(true);
  });

  it("withdraws a token and refuses to sign what could never execute", async () => {
    const vAta = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, vault, true);
    await mintTo(conn, wallet, mint, vAta.address, wallet, 1_000_000);
    const dest = Keypair.generate().publicKey;
    await act(primary, vault, { kind: "withdraw", mint: mint.toBytes(), dest: dest.toBytes(), amount: 250_000n, ...fee0 });
    expect(Number((await getAccount(conn, getAssociatedTokenAddressSync(mint, dest, true))).amount)).to.eq(250_000);
    const st = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st, primary, await findSignedMessages(program, vault, primary));
    const base = { program, payer, vault, signer: primary, leaf };
    expect((await preflightAction({ ...base, action: withdraw(Keypair.generate().publicKey, 1000n) })).errors.join()).to.contain("destination is empty");
    expect((await preflightAction({ ...base, action: withdraw(payer, SOL(1000)) })).errors.join()).to.contain("less SOL");
    const bal = BigInt(await conn.getBalance(vault));
    expect((await preflightAction({ ...base, action: withdraw(payer, bal - 1000n) })).errors.join()).to.contain("rent minimum");
  });

  // ---------- multisig ----------

  it("needs 2 of 3 signers: one approval waits, the second executes", async () => {
    const p = makeSigner(newMasterSecret(), 0, 0);
    const c1 = inSlot(makeSigner(newMasterSecret(), 0, 0), 1);
    const c2 = inSlot(makeSigner(newMasterSecret(), 0, 0), 2);
    // Multi-signer vaults need the Sentinel tier: $NOX held in the vault itself.
    await expectError(newVault({ coSigners: [c1.pub.root, c2.pub.root], threshold: 2 }, p, GUARDIAN), "TierTooLow");
    const { vault: v } = await newVault({ coSigners: [c1.pub.root, c2.pub.root], threshold: 2 }, p, SENTINEL);
    expect((await vaultTier(program, v)).tier).to.eq(TIER_SENTINEL);
    await fund(v, 1);
    const dest = Keypair.generate().publicKey;
    const action = withdraw(dest, SOL(0.3));
    const first = await act(p, v, action);
    expect(first.plan.willExecute).to.eq(false);
    expect(await conn.getBalance(dest)).to.eq(0);
    expect((await fetchApproval(program, v, action))!.trees).to.eq(0b001);
    // Nobody can execute it early.
    await expectError(send([await executeIx(program, payer, v, action, payer)]), "NotApproved");
    const second = await act(c2, v, action);
    expect(second.plan.willExecute).to.eq(true);
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.3)));
    expect(await fetchApproval(program, v, action)).to.eq(null);
  });

  // ---------- rules: whitelist, instant limit, delay, recovery ----------

  describe("whitelist, instant limit, delay and recovery", () => {
    const friend = Keypair.generate().publicKey;
    const stranger = Keypair.generate().publicKey;
    const heir = Keypair.generate().publicKey;
    let p2: Signer;
    let rec: Signer;
    let v2: PublicKey;

    before(async () => {
      p2 = makeSigner(master, 1, 0);
      rec = makeSigner(newMasterSecret(), 0, RECOVERY_TREE);
      ({ vault: v2 } = await newVault({ recoveryRoot: rec.pub.root, recoveryDelaySecs: 8, whitelist: [friend], slowDelaySecs: 3, instantLimitLamports: SOL(0.3) }, p2));
      await fund(v2, 3);
      for (const k of [friend, stranger, heir]) await fund(k, 0.01);
    });

    it("pays the whitelist at once, and a stranger at once within the 24 h limit", async () => {
      await act(p2, v2, withdraw(friend, SOL(0.1)));
      await act(p2, v2, withdraw(stranger, SOL(0.2)));
      expect(await conn.getBalance(friend)).to.eq(Number(SOL(0.11)));
      expect(await conn.getBalance(stranger)).to.eq(Number(SOL(0.21)));
    });

    it("holds a stranger over the limit; the recovery key can cancel it", async () => {
      await act(p2, v2, withdraw(stranger, SOL(0.2)));
      let st = (await fetchState(program, v2))!;
      expect(st.pending?.dest.equals(stranger)).to.eq(true);
      await expectError(send([await executePendingIx(program, payer, v2, st)]), "NotYet");
      await act(rec, v2, { kind: "cancel", ...fee0 });
      st = (await fetchState(program, v2))!;
      expect(st.pending).to.eq(null);
    });

    it("pays the held withdrawal after the delay", async () => {
      await act(p2, v2, withdraw(stranger, SOL(0.2)));
      await sleep(4500);
      await send([await executePendingIx(program, payer, v2, (await fetchState(program, v2))!)]);
      expect(await conn.getBalance(stranger)).to.eq(Number(SOL(0.41)));
    });

    it("keeps the recovery key to cancelling while the owner is active, then hands it the vault", async () => {
      const early = withdraw(heir, SOL(0.1));
      const st = (await fetchState(program, v2))!;
      const { leaf } = pickLeaf(st, rec, await findSignedMessages(program, v2, rec));
      expect((await preflightAction({ program, payer, vault: v2, signer: rec, leaf, action: early })).errors.join()).to.contain("can only cancel");
      await expectError(run(await planAction({ program, payer, vault: v2, signer: rec, leaf, action: early, execute: true })), "RecoveryLocked");
      await sleep(9000);
      // That key published part of a signature for `early`: it can only ever complete that.
      const approval = await fetchApproval(program, v2, early);
      if (approval) await send([await executeIx(program, payer, v2, early, approval.creator)]);
      else {
        const { leaf: again, resume } = pickLeaf((await fetchState(program, v2))!, rec, await findSignedMessages(program, v2, rec));
        expect(again).to.eq(leaf);
        expect(resume?.action.kind).to.eq("withdraw");
        await cancel(v2); // close the old buffer; resending the same message reveals nothing new
        await run(await planAction({ program, payer, vault: v2, signer: rec, leaf, action: resume!.action }));
      }
      const rest = BigInt(await conn.getBalance(v2));
      await act(rec, v2, withdraw(heir, rest));
      expect(await conn.getBalance(v2)).to.eq(0);
      expect(await conn.getBalance(heir)).to.eq(Number(rest + SOL(0.11)));
    });

    it("refuses withdrawals outside a strict whitelist", async () => {
      const { signer: p3, vault: v3 } = await newVault({ whitelist: [friend], slowDelaySecs: 0 });
      await fund(v3, 1);
      expect((await preflightAction({ program, payer, vault: v3, signer: p3, leaf: 0, action: withdraw(stranger, SOL(0.1)) })).errors.join()).to.contain("do not allow");
      await expectError(run(await planAction({ program, payer, vault: v3, signer: p3, leaf: 0, action: withdraw(stranger, SOL(0.1)) })), "NotWhitelisted");
    });
  });

  // ---------- schedules and budgets ----------

  it("pays a schedule on time, and only on time (Guardian tier)", async () => {
    const dest = Keypair.generate().publicKey;
    await fund(dest, 0.01);
    const sched: wots.Action = { kind: "schedule", id: 1, mint: ZERO, dest: dest.toBytes(), amount: SOL(0.05), interval: 3n, count: 2, start: 0n, ...fee0 };
    const st0 = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st0, primary, await findSignedMessages(program, vault, primary));
    expect((await preflightAction({ program, payer, vault, signer: primary, leaf, action: sched })).errors.join()).to.contain("Guardian");
    await giveNox(vault, GUARDIAN);
    expect((await vaultTier(program, vault)).tier).to.eq(TIER_GUARDIAN);
    await act(primary, vault, sched);
    let [s] = await vaultSchedules(program, vault);
    await send([await runScheduleIx(program, payer, vault, s)]);
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.06)));
    [s] = await vaultSchedules(program, vault);
    await expectError(send([await runScheduleIx(program, payer, vault, s)]), "NotYet");
    await sleep(3500);
    await send([await runScheduleIx(program, payer, vault, s)]);
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.11)));
    expect((await vaultSchedules(program, vault)).length).to.eq(0); // done: closed
  });

  it("lets a session key spend within its budget, and nothing more", async () => {
    const session = Keypair.generate();
    await fund(session.publicKey, 0.05);
    await act(primary, vault, { kind: "budget", id: 2, session: session.publicKey.toBytes(), mint: ZERO, limit: SOL(0.1), period: 3600n, expires: now() + 3600n, ...fee0 });
    const [b] = await vaultBudgets(program, vault);
    const shop = Keypair.generate().publicKey;
    const spend = async (amount: bigint) => {
      const tx = new Transaction().add(await spendBudgetIx(program, vault, b, shop, amount));
      tx.feePayer = session.publicKey;
      return anchor.web3.sendAndConfirmTransaction(conn, tx, [session], { commitment: "confirmed" });
    };
    await spend(SOL(0.06));
    expect(await conn.getBalance(shop)).to.eq(Number(SOL(0.06)));
    await expectError(spend(SOL(0.05)), "OverBudget");
    await act(primary, vault, { kind: "cancelBudget", id: 2, ...fee0 });
    expect(await conn.getAccountInfo(budgetPda(vault, 2, program.programId))).to.eq(null);
  });

  // ---------- invoice addresses ----------

  it("sweeps invoice addresses (SOL and tokens) into the vault", async () => {
    const inbox = inboxPda(vault, 7, program.programId);
    await fund(inbox, 0.2);
    const inboxAta = getAssociatedTokenAddressSync(mint, inbox, true);
    await send([createAssociatedTokenAccountIdempotentInstruction(payer, inboxAta, inbox, mint)]);
    await mintTo(conn, wallet, mint, inboxAta, wallet, 5_000);
    const before = await conn.getBalance(vault);
    const vAta = getAssociatedTokenAddressSync(mint, vault, true);
    const tokBefore = Number((await getAccount(conn, vAta)).amount);
    await send(await sweepInboxIxs(program, payer, vault, 7, [{ mint, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }]));
    expect(await conn.getBalance(inbox)).to.eq(0);
    expect(await conn.getBalance(vault)).to.be.greaterThan(before + Number(SOL(0.2)) - 1);
    expect(Number((await getAccount(conn, vAta)).amount)).to.eq(tokBefore + 5_000);
  });

  // ---------- testament ----------

  it("splits everything among the heirs once the owner is inactive", async () => {
    const h1 = Keypair.generate().publicKey;
    const h2 = Keypair.generate().publicKey;
    const heirs = { heirs: [{ addr: h1, bps: 6000 }, { addr: h2, bps: 4000 }], testamentDelaySecs: 3 };
    await expectError(newVault(heirs), "TierTooLow");
    const { signer: ps, vault: v } = await newVault(heirs, undefined, GUARDIAN);
    await fund(v, 1);
    const vAta = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, v, true);
    await mintTo(conn, wallet, mint, vAta.address, wallet, 1000);
    let st = (await fetchState(program, v))!;
    await expectError(send(await testamentIxs(program, payer, v, st)), "NotYet");
    await sleep(4000);
    st = (await fetchState(program, v))!;
    await send(await testamentIxs(program, payer, v, st, { mint, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }));
    await send(await testamentIxs(program, payer, v, st));
    expect(await conn.getBalance(h1)).to.eq(Number(SOL(0.6)));
    expect(await conn.getBalance(h2)).to.eq(Number(SOL(0.4)));
    expect(Number((await getAccount(conn, getAssociatedTokenAddressSync(mint, h1, true))).amount)).to.eq(600);
    expect(Number((await getAccount(conn, getAssociatedTokenAddressSync(mint, h2, true))).amount)).to.eq(400);
    void ps;
  });

  // ---------- Escape Hatch and canary ----------

  describe("Escape Hatch and canary", () => {
    const w = Keypair.generate();
    let wAta: PublicKey;

    before(async () => {
      await fund(w.publicKey, 1);
      wAta = (await getOrCreateAssociatedTokenAccount(conn, wallet, mint, w.publicKey)).address;
      await mintTo(conn, wallet, mint, wAta, wallet, 7_000);
    });

    it("registers a wallet → vault link (a timestamped registry entry)", async () => {
      await send([await registerLinkIx(program, w.publicKey, vault)], [w]);
      const l = (await fetchLink(program, w.publicKey))!;
      expect(l.vault.equals(vault)).to.eq(true);
      // Changing the vault takes 30 days.
      const { vault: other } = await newVault();
      await send([await requestLinkChangeIx(program, w.publicKey, other)], [w]);
      await expectError(send([await applyLinkChangeIx(program, w.publicKey)]), "NotYet");
    });

    it("moves delegated tokens only after panic (or a tripped canary)", async () => {
      await send([escapeApproveIx(w.publicKey, wAta)], [w]);
      const l = (await fetchLink(program, w.publicKey))!;
      await expectError(send([await escapeTokenIx(program, payer, l, wAta, mint)]), "NotTriggered");
      await send([await setPanicIx(program, w.publicKey, true)], [w]);
      const vAta = getAssociatedTokenAddressSync(mint, vault, true);
      const before = Number((await getAccount(conn, vAta)).amount);
      await send([await escapeTokenIx(program, payer, (await fetchLink(program, w.publicKey))!, wAta, mint)]);
      expect(Number((await getAccount(conn, wAta)).amount)).to.eq(0);
      expect(Number((await getAccount(conn, vAta)).amount)).to.eq(before + 7_000);
    });

    it("evacuates the wallet's SOL with a pre-signed, never-expiring transaction stored on chain", async () => {
      const nonce = Keypair.generate();
      await provider.sendAndConfirm(new Transaction().add(...(await createNonceIxs(conn, w.publicKey, nonce.publicKey))), [w, nonce], { commitment: "confirmed" });
      const tx = await buildEscapeSolTx(program, w.publicKey, vault, nonce.publicKey);
      tx.sign(w);
      await send([await setEscapeTxIx(program, w.publicKey, tx.serialize())], [w]);
      await sleep(2000); // the stored transaction does not expire
      const stored = (await fetchLink(program, w.publicKey))!.escapeTx;
      const before = await conn.getBalance(vault);
      const walletSol = await conn.getBalance(w.publicKey);
      const sig = await conn.sendRawTransaction(stored); // anyone can broadcast it
      await conn.confirmTransaction(sig, "confirmed");
      expect(await conn.getBalance(w.publicKey)).to.eq(0);
      expect(await conn.getBalance(vault)).to.eq(before + walletSol - 5000);
    });

    it("watches a canary nobody can move; it cannot be tripped by anyone else", async () => {
      await fund(CANARY_ADDRESS, 0.5);
      await send([await raiseBaselineIx(program)]);
      const c = (await fetchCanary(program))!;
      expect(c.baseline).to.eq(SOL(0.5));
      expect(c.tripped).to.eq(false);
      await expectError(send([await tripCanaryIx(program)]), "NotTriggered");
    });
  });

  describe("stake, migrate, find (last: migrate empties the main vault)", () => {

  it("stakes from the vault, unstakes and collects", async function () {
    this.timeout(300_000);
    const votes = await conn.getVoteAccounts();
    const vote = new PublicKey((votes.current[0] ?? votes.delinquent[0]).votePubkey);
    const amount = SOL(1.5);
    const before = await conn.getBalance(vault);
    // The stake program refuses changes while epoch rewards are paid out at the start of an
    // epoch (EpochRewardsActive, 0x10); with 64-slot epochs that window is hit by chance.
    const clearOfBoundary = async () => {
      while ((await conn.getEpochInfo()).slotIndex < 8) await sleep(500);
    };
    await clearOfBoundary();
    await act(primary, vault, { kind: "stake", seed: 0, vote: vote.toBytes(), amount, ...fee0 });
    const stake = stakePda(vault, 0, program.programId);
    expect(await conn.getBalance(stake)).to.eq(Number(amount));
    await clearOfBoundary();
    await act(primary, vault, { kind: "unstake", seed: 0, ...fee0 });
    const epoch = (await conn.getEpochInfo()).epoch;
    while ((await conn.getEpochInfo()).epoch <= epoch + 1) await sleep(2000);
    await clearOfBoundary();
    await act(primary, vault, { kind: "collectStake", seed: 0, ...fee0 });
    expect(await conn.getAccountInfo(stake)).to.eq(null);
    expect(await conn.getBalance(vault)).to.be.at.least(before);
  });

  it("migrates everything to a new vault", async () => {
    const { vault: target } = await newVault();
    await act(primary, vault, { kind: "migrate", newVault: target.toBytes(), ...fee0 });
    const st = (await fetchState(program, vault))!;
    expect(st.migrateTo?.equals(target)).to.eq(true);
    const sol = await conn.getBalance(vault);
    const tok = Number((await getAccount(conn, getAssociatedTokenAddressSync(mint, vault, true))).amount);
    await send(await migrateIxs(program, payer, vault, st, [{ mint, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }]));
    expect(await conn.getBalance(vault)).to.eq(0);
    expect(Number((await getAccount(conn, getAssociatedTokenAddressSync(mint, target, true))).amount)).to.eq(tok);
    expect(await conn.getBalance(target)).to.be.at.least(sol);
  });

  it("finds a phrase's vaults on chain", async () => {
    const found = await findVaultsFor(program, primary);
    expect(found.map((f) => f.state.vault.toBase58())).to.deep.eq([vault.toBase58()]);
  });
  });
});
