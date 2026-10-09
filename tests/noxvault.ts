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
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { Noxvault } from "../target/types/noxvault";
import * as wots from "../sdk/wots";
import {
  HASHES_PER_TX,
  UnlockPlan,
  verifyRanges,
  newMasterSecret,
  findSignedMessages,
  planUnlock,
  preflightUnlock,
  recordPda,
  scanVaults,
  secretToWords,
  spentPda,
  unlockPda,
  vaultKey,
  wordsToSecret,
} from "../sdk/client";

describe("noxvault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.noxvault as Program<Noxvault>;
  const conn = provider.connection;
  const payer = provider.wallet.publicKey;
  const master = newMasterSecret();
  const key = (i: number) => vaultKey(master, i, program.programId);
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  async function send(ixs: TransactionInstruction[]) {
    const sig = await provider.sendAndConfirm(new Transaction().add(...ixs), [], { commitment: "confirmed" });
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    return tx?.meta?.computeUnitsConsumed ?? 0;
  }

  async function run(plan: UnlockPlan) {
    console.log(`      ${wots.verifyCost(plan.digest).reduce((a, b) => a + b, 0)} hashes to verify`);
    for (const t of plan.transactions) {
      const cu = await send(t.instructions);
      console.log(`      ${t.label}: ${cu} CU`);
    }
  }

  async function fund(to: PublicKey, sol: number) {
    await send([SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: sol * LAMPORTS_PER_SOL })]);
  }

  async function cancel(vault: PublicKey) {
    await send([
      await program.methods
        .cancelUnlock()
        .accountsPartial({ payer, unlock: unlockPda(vault, payer, program.programId) })
        .instruction(),
    ]);
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

  it("signs and verifies off-chain; tampering fails", () => {
    const k = wots.deriveKey(master, 99);
    const d = wots.messageDigest({
      programId: program.programId.toBytes(),
      vault: new Uint8Array(32),
      mint: new Uint8Array(32),
      dest: new Uint8Array(32).fill(1),
      nextVault: new Uint8Array(32).fill(2),
      amount: 5n,
    });
    const sig = wots.sign(k, d);
    expect(sig.length).to.eq(34);
    expect(wots.verify(k.root, k.pkSeed, d, sig)).to.eq(true);
    const d2 = d.slice();
    d2[0] ^= 1;
    expect(wots.verify(k.root, k.pkSeed, d2, sig)).to.eq(false);
  });

  it("splits even the worst-case signature into transactions that fit the compute limit", () => {
    const worst = wots.verifyCost(new Uint8Array(32)); // all-zero digest: every chain walks 255 steps
    const ranges = verifyRanges(worst, HASHES_PER_TX);
    for (const [from, to] of ranges) expect(worst.slice(from, to).reduce((a, b) => a + b, 0)).to.be.at.most(HASHES_PER_TX);
    expect(ranges[ranges.length - 1][1]).to.eq(34);
  });

  it("round-trips the secret through 24 words", () => {
    const words = secretToWords(master);
    expect(words.split(" ").length).to.eq(24);
    expect(Buffer.from(wordsToSecret(words)).equals(Buffer.from(master))).to.eq(true);
  });

  it("registers a vault for the explorer", async () => {
    const k = key(0);
    await send([
      await program.methods
        .register(Array.from(k.root))
        .accountsPartial({ payer, vault: k.vault, record: recordPda(k.vault, program.programId) })
        .instruction(),
    ]);
    const r = await program.account.record.fetch(recordPda(k.vault, program.programId));
    expect(r.vault.equals(k.vault)).to.eq(true);
  });

  it("unlocks SOL: pays dest, forwards the rest to the next vault, marks the key spent", async () => {
    const k0 = key(0);
    const k1 = key(1);
    const dest = Keypair.generate().publicKey;
    await fund(k0.vault, 2);

    const plan = await planUnlock({
      program,
      payer,
      key: k0,
      next: k1.vault,
      dest,
      amount: BigInt(0.5 * LAMPORTS_PER_SOL),
    });
    await run(plan);

    expect(await conn.getBalance(dest)).to.eq(0.5 * LAMPORTS_PER_SOL);
    expect(await conn.getBalance(k0.vault)).to.eq(0);
    expect(await conn.getBalance(k1.vault)).to.eq(1.5 * LAMPORTS_PER_SOL);
    const spent = await program.account.spent.fetch(spentPda(k0.vault, program.programId));
    expect(spent.successor.equals(k1.vault)).to.eq(true);
    expect(await conn.getAccountInfo(unlockPda(k0.vault, payer, program.programId))).to.eq(null);
  });

  it("never lets a spent key sign again", async () => {
    const k0 = key(0);
    await fund(k0.vault, 0.1);
    const plan = await planUnlock({ program, payer, key: k0, next: key(2).vault, dest: payer, amount: 1000n });
    const txs = plan.transactions;
    for (const t of txs.slice(0, -1)) await send(t.instructions);
    await expectError(send(txs[txs.length - 1].instructions), "already in use");
    await cancel(k0.vault);
  });

  it("forwards SOL sent to a spent vault to its successor", async () => {
    const k0 = key(0);
    const k1 = key(1);
    const before = await conn.getBalance(k1.vault);
    const stray = await conn.getBalance(k0.vault);
    await send([
      await program.methods
        .sweep()
        .accountsPartial({ vault: k0.vault, spent: spentPda(k0.vault, program.programId), successor: k1.vault })
        .instruction(),
    ]);
    expect(await conn.getBalance(k0.vault)).to.eq(0);
    expect(await conn.getBalance(k1.vault)).to.eq(before + stray);
  });

  it("rejects a tampered signature and freezes it once verification starts", async () => {
    const k1 = key(1);
    const plan = await planUnlock({ program, payer, key: k1, next: key(2).vault, dest: payer, amount: 1000n });
    // Walk chain 3 one step further than the signature reveals.
    const a3 = wots.digits(plan.digest)[3];
    const forged = wots.F(k1.pkSeed, 3, a3, plan.signature[3]);
    const unlock = unlockPda(k1.vault, payer, program.programId);
    const forge = await program.methods.writeSigs(3, [Array.from(forged)]).accountsPartial({ payer, vault: k1.vault, unlock }).instruction();
    const steps = plan.steps;
    const verifyAt = steps.findIndex((s) => s.label.startsWith("verify"));
    for (const s of steps.slice(0, verifyAt)) await send([s.ix]);
    await send([forge]);
    for (const s of steps.slice(verifyAt, -1)) await send([budget, s.ix]);
    await expectError(send([steps[steps.length - 1].ix]), "BadSignature");
    await expectError(send([forge]), "Frozen");
    await cancel(k1.vault);
  });

  it("rejects a payout to anyone but the signed destination", async () => {
    const k1 = key(1);
    const dest = Keypair.generate().publicKey;
    const plan = await planUnlock({ program, payer, key: k1, next: key(2).vault, dest, amount: 1000n });
    const steps = plan.steps;
    for (const s of steps.slice(0, -1)) await send([budget, s.ix]);
    const finish = steps[steps.length - 1].ix;
    const thief = Keypair.generate().publicKey;
    const keys = finish.keys.map((k) => (k.pubkey.equals(dest) ? { ...k, pubkey: thief } : k));
    await expectError(send([new TransactionInstruction({ ...finish, keys })]), "WrongDest");
    await cancel(k1.vault);
  });

  it("unlocks a token and forwards the rest of it to the next vault", async () => {
    const k1 = key(1);
    const k2 = key(2);
    const wallet = (provider.wallet as anchor.Wallet).payer;
    const mint = await createMint(conn, wallet, payer, null, 6);
    const vaultAta = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, k1.vault, true);
    await mintTo(conn, wallet, mint, vaultAta.address, wallet, 1_000_000);
    const dest = Keypair.generate().publicKey;

    const plan = await planUnlock({ program, payer, key: k1, next: k2.vault, dest, amount: 250_000n, mint });
    await run(plan);

    const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true);
    expect(Number((await getAccount(conn, ata(dest))).amount)).to.eq(250_000);
    expect(Number((await getAccount(conn, ata(k2.vault))).amount)).to.eq(750_000);
    expect(await conn.getAccountInfo(ata(k1.vault))).to.eq(null);

    // k1's SOL is still there; the sweep moves it on to k2 without any new signature.
    expect(await conn.getBalance(k1.vault)).to.be.greaterThan(0);
    await send([
      await program.methods
        .sweep()
        .accountsPartial({ vault: k1.vault, spent: spentPda(k1.vault, program.programId), successor: k2.vault })
        .instruction(),
    ]);
    expect(await conn.getBalance(k1.vault)).to.eq(0);
  });

  it("refuses to plan an unlock that could never be paid out", async () => {
    const k2 = key(2);
    const base = { program, payer, key: k2, next: key(3).vault };
    const empty = Keypair.generate().publicKey;
    const tooSmall = await preflightUnlock({ ...base, dest: empty, amount: 1000n });
    expect(tooSmall.errors.join()).to.contain("destination is empty");
    const tooMuch = await preflightUnlock({ ...base, dest: payer, amount: BigInt(1000 * LAMPORTS_PER_SOL) });
    expect(tooMuch.errors.join()).to.contain("less than this amount");
    const used = await preflightUnlock({ ...base, key: key(0), dest: payer, amount: 1000n });
    expect(used.errors.join()).to.contain("already used");
    const ok = await preflightUnlock({ ...base, dest: payer, amount: 1000n });
    expect(ok.errors).to.deep.eq([]);
  });

  it("finds the user's vaults again from the secret alone, including token-only vaults", async () => {
    // Vault 4 holds only a token and no SOL; vault 3 stays empty in between.
    const wallet = (provider.wallet as anchor.Wallet).payer;
    const mint = await createMint(conn, wallet, payer, null, 0);
    const ata = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, key(4).vault, true);
    await mintTo(conn, wallet, mint, ata.address, wallet, 7);
    expect(await conn.getBalance(key(4).vault)).to.eq(0);

    const { vaults, nextFresh } = await scanVaults(program, master);
    expect(vaults.map((v) => v.index)).to.deep.eq([0, 1, 2, 4]);
    expect(vaults[0].spent && vaults[1].spent && !vaults[2].spent).to.eq(true);
    expect(nextFresh).to.eq(5);
  });

  it("remembers a signed message for good: cancel, another payer or copied values cannot get a second one signed", async () => {
    const k = key(10);
    const next = key(11).vault;
    await fund(k.vault, 0.2);
    const m1 = { program, payer, key: k, next, dest: payer, amount: 1000n };
    const plan1 = await planUnlock(m1);

    // Half of M1's signature lands, then the buffer is cancelled (time-out + discard, closed tab...).
    await send([plan1.steps[0].ix, plan1.steps[1].ix]);
    await cancel(k.vault);
    let signed = await findSignedMessages(program, k);
    expect(signed.length).to.eq(1);
    expect(Buffer.from(signed[0].digest).equals(Buffer.from(plan1.digest))).to.eq(true);
    expect(signed[0].chains.length).to.eq(17);

    // Any other message is refused, from this payer or from another wallet.
    const other = Keypair.generate();
    await fund(other.publicKey, 0.1);
    const m2 = await preflightUnlock({ ...m1, amount: 2000n });
    expect(m2.errors.join()).to.contain("already signed");
    const m2b = await preflightUnlock({ ...m1, payer: other.publicKey, dest: other.publicKey });
    expect(m2b.errors.join()).to.contain("already signed");

    // Someone copies the published values into a buffer with their own message: it does not count.
    const theirs = unlockPda(k.vault, other.publicKey, program.programId);
    const open = await program.methods
      .openUnlock({ pkSeed: Array.from(k.pkSeed), mint: PublicKey.default, dest: other.publicKey, nextVault: next, amount: new anchor.BN(999) })
      .accountsPartial({ payer: other.publicKey, vault: k.vault, unlock: theirs })
      .instruction();
    const copy = await program.methods
      .writeSigs(0, plan1.signature.slice(0, 17).map((v) => Array.from(v)))
      .accountsPartial({ payer: other.publicKey, vault: k.vault, unlock: theirs })
      .instruction();
    await provider.sendAndConfirm(new Transaction().add(open, copy), [other], { commitment: "confirmed" });
    signed = await findSignedMessages(program, k);
    expect(signed.length).to.eq(1);
    expect(Buffer.from(signed[0].digest).equals(Buffer.from(plan1.digest))).to.eq(true);

    // The original message can still be completed.
    expect((await preflightUnlock(m1)).errors).to.deep.eq([]);
    const before = await conn.getBalance(payer);
    await run(await planUnlock(m1));
    expect(await conn.getAccountInfo(spentPda(k.vault, program.programId))).to.not.eq(null);
    expect((await findSignedMessages(program, k))[0].chains.length).to.eq(34);
    expect(await conn.getBalance(payer)).to.be.lessThan(before + 1000 + 1); // fees paid, 1000 received
  });
});
