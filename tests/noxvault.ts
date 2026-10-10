import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { Noxvault } from "../target/types/noxvault";
import * as wots from "../sdk/wots";
import { checkRelay, decodeRelayRequest, encodeRelayRequest, relay } from "../sdk/relayer";
import {
  ActionPlan,
  SignedAction,
  HASHES_PER_TX,
  Signer,
  TREE_PRIMARY,
  TREE_RECOVERY,
  executePendingIx,
  fetchState,
  findSignedMessages,
  findVaultsFor,
  initVaultIx,
  leafUsed,
  makeConfig,
  makeSigner,
  newMasterSecret,
  pickLeaf,
  planAction,
  preflightAction,
  secretToWords,
  stakePda,
  unlockPda,
  vaultOf,
  verifyRanges,
  wordsToSecret,
} from "../sdk/client";

const SOL = (n: number) => BigInt(Math.round(n * LAMPORTS_PER_SOL));
const ZERO = new Uint8Array(32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("noxvault v2", () => {
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

  async function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const sig = await provider.sendAndConfirm(new Transaction().add(...ixs), signers, { commitment: "confirmed" });
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    return tx?.meta?.computeUnitsConsumed ?? 0;
  }

  /** Sends a plan; with `as`, that keypair is the fee payer (a relayer). */
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

  const withdraw = (dest: PublicKey, amount: bigint, fee = 0n, feePayee = payer): wots.Action => ({
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

  before(async () => {
    primary = makeSigner(master, 0, TREE_PRIMARY);
    vault = vaultOf(makeConfig(primary), program.programId);
  });

  it("builds trees whose signatures rebuild the root, and nothing else does", () => {
    const leaf = 37;
    const d = wots.messageDigest(program.programId.toBytes(), vault.toBytes(), 0, leaf, wots.encodeAction(withdraw(payer, 5n)));
    const sig = wots.sign(primary.seeds, leaf, d);
    const path = wots.authPath(primary.pub, leaf);
    expect(wots.equal(wots.recoverRoot(primary.seeds.pkSeed, leaf, d, sig, path), primary.pub.root)).to.eq(true);
    const d2 = d.slice();
    d2[5] ^= 1;
    expect(wots.equal(wots.recoverRoot(primary.seeds.pkSeed, leaf, d2, sig, path), primary.pub.root)).to.eq(false);
    expect(wots.equal(wots.recoverRoot(primary.seeds.pkSeed, leaf + 1, d, sig, path), primary.pub.root)).to.eq(false);
    expect(wots.encodeConfig(makeConfig(primary)).length).to.eq(210);
  });

  it("splits even the worst-case signature into transactions that fit the compute limit", () => {
    const worst = wots.verifyCost(new Uint8Array(32));
    for (const [from, to] of verifyRanges(worst, HASHES_PER_TX))
      expect(worst.slice(from, to).reduce((a, b) => a + b, 0)).to.be.at.most(HASHES_PER_TX);
  });

  it("round-trips a phrase through 24 words", () => {
    expect(wots.equal(wordsToSecret(secretToWords(master)), master)).to.eq(true);
  });

  it("initializes a vault from its config; the address commits to the rules", async () => {
    await send([await initVaultIx(program, payer, makeConfig(primary))]);
    const st = (await fetchState(program, vault))!;
    expect(wots.equal(st.config.primaryRoot, primary.pub.root)).to.eq(true);
    const other = makeConfig(primary, { whitelist: [payer], slowDelaySecs: 60 });
    expect(vaultOf(other, program.programId).equals(vault)).to.eq(false);
  });

  it("withdraws SOL and keeps the same vault address", async () => {
    await fund(vault, 4);
    const dest = Keypair.generate().publicKey;
    await act(primary, vault, withdraw(dest, SOL(0.5)), { log: true });
    await act(primary, vault, withdraw(dest, SOL(0.25)));
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.75)));
    expect(await conn.getBalance(vault)).to.eq(Number(SOL(3.25)));
    const st = (await fetchState(program, vault))!;
    expect(leafUsed(st, 0, 0) && leafUsed(st, 0, 1) && !leafUsed(st, 0, 2)).to.eq(true);
  });

  it("lets a relayer send everything and get paid by the vault", async () => {
    const relayer = Keypair.generate();
    await fund(relayer.publicKey, 0.1);
    const before = await conn.getBalance(relayer.publicKey);
    const dest = Keypair.generate().publicKey;
    const fee = SOL(0.002);
    await act(primary, vault, withdraw(dest, SOL(0.1), fee, relayer.publicKey), { as: relayer });
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.1)));
    const after = await conn.getBalance(relayer.publicKey);
    expect(after - before).to.be.greaterThan(0);
    expect(after - before).to.be.at.most(Number(fee));
  });

  it("relays a signed action through the relayer module, which checks it first", async () => {
    const relayer = Keypair.generate();
    await fund(relayer.publicKey, 0.1);
    const rp = new Program<Noxvault>(program.idl, new anchor.AnchorProvider(conn, new anchor.Wallet(relayer), { commitment: "confirmed" }));
    const policy = { minFee: SOL(0.001) };
    const st = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st, primary, await findSignedMessages(program, vault, primary));
    const sign = (action: wots.Action): SignedAction => {
      const d = wots.messageDigest(program.programId.toBytes(), vault.toBytes(), 0, leaf, wots.encodeAction(action));
      return { vault, tree: 0, leaf, pkSeed: primary.seeds.pkSeed, authPath: wots.authPath(primary.pub, leaf), signature: wots.sign(primary.seeds, leaf, d), action };
    };
    const dest = Keypair.generate().publicKey;
    // Too low a fee and a forged signature are refused before anything is sent.
    expect(await checkRelay(rp, relayer.publicKey, sign(withdraw(dest, SOL(0.01), 1000n, relayer.publicKey)), policy)).to.contain("fee must be at least");
    const good = sign(withdraw(dest, SOL(0.01), SOL(0.001), relayer.publicKey));
    const forged = { ...good, action: withdraw(Keypair.generate().publicKey, SOL(0.01), SOL(0.001), relayer.publicKey) };
    expect(await checkRelay(rp, relayer.publicKey, forged, policy)).to.contain("signature does not match");
    // The request survives JSON (as it would over HTTP) and is sent.
    const wire = decodeRelayRequest(JSON.parse(JSON.stringify(encodeRelayRequest(good))));
    await relay(rp, relayer, wire, policy);
    expect(await conn.getBalance(dest)).to.eq(Number(SOL(0.01)));
  });

  it("never accepts a used key", async () => {
    const plan = await planAction({ program, payer, vault, signer: primary, leaf: 0, action: withdraw(payer, 1000n) });
    await expectError(run(plan), "KeyUsed");
  });

  it("rejects a tampered signature and freezes it once verification starts", async () => {
    const st = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st, primary, []);
    const plan = await planAction({ program, payer, vault, signer: primary, leaf, action: withdraw(payer, 1000n) });
    const a3 = wots.digits(plan.digest)[3];
    const forged = wots.F(primary.seeds.pkSeed, leaf, 3, a3, plan.signature[3]);
    const unlock = unlockPda(vault, payer, program.programId);
    const forge = await program.methods.writeSigs(3, [Array.from(forged)]).accountsPartial({ payer, vault, unlock }).instruction();
    const verifyAt = plan.steps.findIndex((s) => s.label.startsWith("verify"));
    for (const s of plan.steps.slice(0, verifyAt)) await send([s.ix]);
    await send([forge]);
    for (const s of plan.steps.slice(verifyAt, -1)) await send([budget, s.ix]);
    await expectError(send([plan.steps[plan.steps.length - 1].ix]), "BadSignature");
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
    expect(wots.equal(signed[0].digest, plan1.digest)).to.eq(true);
    expect(pickLeaf(st, primary, await findSignedMessages(program, vault, primary)).leaf).to.eq(leaf);

    const other = Keypair.generate();
    await fund(other.publicKey, 0.1);
    const pre = await preflightAction({ program, payer: other.publicKey, vault, signer: primary, leaf, action: withdraw(payer, 2000n) });
    expect(pre.errors.join()).to.contain("already signed");

    const theirs = unlockPda(vault, other.publicKey, program.programId);
    const fake = await planAction({ program, payer: other.publicKey, vault, signer: primary, leaf, action: withdraw(other.publicKey, 999n) });
    const copy = await program.methods
      .writeSigs(0, plan1.signature.slice(0, 12).map((v) => Array.from(v)))
      .accountsPartial({ payer: other.publicKey, vault, unlock: theirs })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(fake.steps[0].ix, copy), [other], { commitment: "confirmed" });
    const again = (await findSignedMessages(program, vault, primary)).filter((m) => m.leaf === leaf);
    expect(again.length).to.eq(1);

    expect((await preflightAction({ program, payer, vault, signer: primary, leaf, action: m1 })).errors).to.deep.eq([]);
    await run(await planAction({ program, payer, vault, signer: primary, leaf, action: m1 }));
    expect(leafUsed((await fetchState(program, vault))!, 0, leaf)).to.eq(true);
  });

  it("withdraws a token", async () => {
    const mint = await createMint(conn, wallet, payer, null, 6);
    const ata = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, vault, true);
    await mintTo(conn, wallet, mint, ata.address, wallet, 1_000_000);
    const dest = Keypair.generate().publicKey;
    await act(primary, vault, { kind: "withdraw", mint: mint.toBytes(), dest: dest.toBytes(), amount: 250_000n, fee: 0n, feePayee: payer.toBytes() });
    expect(Number((await getAccount(conn, getAssociatedTokenAddressSync(mint, dest, true))).amount)).to.eq(250_000);
    expect(Number((await getAccount(conn, ata.address)).amount)).to.eq(750_000);
  });

  it("refuses to sign what could never execute", async () => {
    const st = (await fetchState(program, vault))!;
    const { leaf } = pickLeaf(st, primary, await findSignedMessages(program, vault, primary));
    const base = { program, payer, vault, signer: primary, leaf };
    const empty = Keypair.generate().publicKey;
    expect((await preflightAction({ ...base, action: withdraw(empty, 1000n) })).errors.join()).to.contain("destination is empty");
    expect((await preflightAction({ ...base, action: withdraw(payer, SOL(1000)) })).errors.join()).to.contain("less SOL");
    const bal = BigInt(await conn.getBalance(vault));
    expect((await preflightAction({ ...base, action: withdraw(payer, bal - 1000n) })).errors.join()).to.contain("rent minimum");
    expect((await preflightAction({ ...base, leaf: 0, action: withdraw(payer, 1000n) })).errors.join()).to.contain("already used");
  });

  describe("whitelist, delay and recovery", () => {
    const heir = Keypair.generate().publicKey;
    const friend = Keypair.generate().publicKey;
    const stranger = Keypair.generate().publicKey;
    let p2: Signer;
    let rec: Signer;
    let v2: PublicKey;

    before(async () => {
      p2 = makeSigner(master, 1, TREE_PRIMARY);
      rec = makeSigner(newMasterSecret(), 0, TREE_RECOVERY);
      const config = makeConfig(p2, { recoveryRoot: rec.pub.root, recoveryDelaySecs: 8, whitelist: [friend], slowDelaySecs: 3 });
      v2 = vaultOf(config, program.programId);
      await send([await initVaultIx(program, payer, config)]);
      await fund(v2, 2);
      await fund(friend, 0.01);
      await fund(stranger, 0.01);
      await fund(heir, 0.01);
    });

    it("pays a whitelisted address at once", async () => {
      await act(p2, v2, withdraw(friend, SOL(0.1)));
      expect(await conn.getBalance(friend)).to.eq(Number(SOL(0.11)));
    });

    it("holds anything else for the delay; the recovery key can cancel it", async () => {
      await act(p2, v2, withdraw(stranger, SOL(0.2)));
      let st = (await fetchState(program, v2))!;
      expect(st.pending?.dest.equals(stranger)).to.eq(true);
      await expectError(send([await executePendingIx(program, payer, v2, st)]), "NotYet");
      await act(rec, v2, { kind: "cancel", fee: 0n, feePayee: payer.toBytes() });
      st = (await fetchState(program, v2))!;
      expect(st.pending).to.eq(null);
      expect(await conn.getBalance(stranger)).to.eq(Number(SOL(0.01)));
    });

    it("pays the held withdrawal after the delay", async () => {
      await act(p2, v2, withdraw(stranger, SOL(0.2)));
      await sleep(4500);
      await send([await executePendingIx(program, payer, v2, (await fetchState(program, v2))!)]);
      expect(await conn.getBalance(stranger)).to.eq(Number(SOL(0.21)));
    });

    it("keeps the recovery key to cancelling while the owner is active", async () => {
      const st = (await fetchState(program, v2))!;
      const { leaf } = pickLeaf(st, rec, await findSignedMessages(program, v2, rec));
      const pre = await preflightAction({ program, payer, vault: v2, signer: rec, leaf, action: withdraw(heir, SOL(0.1)) });
      expect(pre.errors.join()).to.contain("can only cancel");
      const plan = await planAction({ program, payer, vault: v2, signer: rec, leaf, action: withdraw(heir, SOL(0.1)) });
      await expectError(run(plan), "RecoveryLocked");
      await cancel(v2);
    });

    it("hands the vault to the recovery key after the owner is inactive", async () => {
      await sleep(9000);
      const st = (await fetchState(program, v2))!;
      // The leaf whose withdrawal was refused above can only ever finish that same message.
      const { leaf, resume } = pickLeaf(st, rec, await findSignedMessages(program, v2, rec));
      expect(resume?.action.kind).to.eq("withdraw");
      await run(await planAction({ program, payer, vault: v2, signer: rec, leaf, action: resume!.action }));
      const rest = BigInt(await conn.getBalance(v2));
      const { leaf: next } = pickLeaf((await fetchState(program, v2))!, rec, await findSignedMessages(program, v2, rec));
      await run(await planAction({ program, payer, vault: v2, signer: rec, leaf: next, action: withdraw(heir, rest) }));
      expect(await conn.getBalance(v2)).to.eq(0);
      expect(await conn.getBalance(heir)).to.eq(Number(rest + SOL(0.11)));
    });

    it("refuses withdrawals outside a strict whitelist", async () => {
      const p3 = makeSigner(master, 2, TREE_PRIMARY);
      const config = makeConfig(p3, { whitelist: [friend], slowDelaySecs: 0 });
      const v3 = vaultOf(config, program.programId);
      await send([await initVaultIx(program, payer, config)]);
      await fund(v3, 1);
      const pre = await preflightAction({ program, payer, vault: v3, signer: p3, leaf: 0, action: withdraw(stranger, SOL(0.1)) });
      expect(pre.errors.join()).to.contain("only pays out to its whitelist");
      await expectError(run(await planAction({ program, payer, vault: v3, signer: p3, leaf: 0, action: withdraw(stranger, SOL(0.1)) })), "NotWhitelisted");
    });
  });

  it("stakes from the vault, unstakes and collects", async function () {
    this.timeout(300_000);
    const votes = await conn.getVoteAccounts();
    const vote = new PublicKey((votes.current[0] ?? votes.delinquent[0]).votePubkey);
    const amount = SOL(1.5);
    const before = await conn.getBalance(vault);
    await act(primary, vault, { kind: "stake", seed: 0, vote: vote.toBytes(), amount, fee: 0n, feePayee: payer.toBytes() });
    const stake = stakePda(vault, 0, program.programId);
    expect(await conn.getBalance(stake)).to.eq(Number(amount));
    expect(await conn.getBalance(vault)).to.eq(before - Number(amount));

    await act(primary, vault, { kind: "unstake", seed: 0, fee: 0n, feePayee: payer.toBytes() });
    const epoch = (await conn.getEpochInfo()).epoch;
    while ((await conn.getEpochInfo()).epoch <= epoch + 1) await sleep(2000);
    await act(primary, vault, { kind: "collectStake", seed: 0, fee: 0n, feePayee: payer.toBytes() });
    expect(await conn.getAccountInfo(stake)).to.eq(null);
    expect(await conn.getBalance(vault)).to.be.at.least(before);
  });

  it("finds a phrase's vaults on chain", async () => {
    const found = await findVaultsFor(program, primary);
    expect(found.map((s) => s.vault.toBase58())).to.deep.eq([vault.toBase58()]);
  });
});
