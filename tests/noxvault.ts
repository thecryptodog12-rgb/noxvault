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
  planUnlock,
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
    const forge = await program.methods.writeSigs(3, [Array.from(forged)]).accountsPartial({ payer, unlock }).instruction();
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

  it("finds the user's vaults again from the secret alone", async () => {
    const { vaults, nextFresh } = await scanVaults(program, master);
    expect(vaults.map((v) => v.index)).to.deep.eq([0, 1, 2]);
    expect(vaults[0].spent && vaults[1].spent && !vaults[2].spent).to.eq(true);
    expect(nextFresh).to.eq(3);
  });
});
