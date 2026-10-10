// End-to-end check against a live cluster (v3): make sure the canary exists, create a vault,
// fund it, withdraw (paying fees ourselves), withdraw again through the relayer module, run a
// schedule, and check the signature history. Usage: pnpm exec tsx scripts/devnet-smoke.ts
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import {
  Noxvault,
  fetchCanary,
  fetchProtocol,
  fetchState,
  findSignedMessages,
  idl,
  initCanaryIx,
  initVaultIx,
  makeConfig,
  makeSigner,
  newMasterSecret,
  pickLeaf,
  planAction,
  preflightAction,
  runScheduleIx,
  vaultOf,
  vaultSchedules,
  vaultTier,
} from "../sdk/client";
import { relay } from "../sdk/relayer";
import { Action, authPath, encodeAction, messageDigest, sign } from "../sdk/wots";

const ZERO = new Uint8Array(32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // "confirmed" blockhashes: a "processed" one is often unknown to the node that simulates.
  const env = anchor.AnchorProvider.env();
  const conn = new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed");
  const provider = new anchor.AnchorProvider(conn, env.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program<Noxvault>(idl as Noxvault, provider);
  const payer = provider.wallet.publicKey;
  // Public RPCs sometimes simulate against a lagging node; every step is retry-safe.
  const send = async (ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await provider.sendAndConfirm(new Transaction().add(...ixs), signers, { commitment: "confirmed" });
      } catch (e) {
        if (attempt >= 4 || !/Blockhash not found|block height exceeded/.test(String(e))) throw e;
        await sleep(1500);
      }
    }
  };

  if (!(await fetchCanary(program))) {
    await send([await initCanaryIx(program, payer)]);
    console.log("canary initialized");
  }

  const t0 = Date.now();
  const signer = makeSigner(newMasterSecret(), 0, 0);
  console.log(`tree built in ${Date.now() - t0} ms`);
  const config = makeConfig(signer);
  const vault = vaultOf(config);
  await send([await initVaultIx(program, payer, config), SystemProgram.transfer({ fromPubkey: payer, toPubkey: vault, lamports: 0.06 * LAMPORTS_PER_SOL })]);
  console.log("vault", vault.toBase58(), "initialized + funded");

  const withdraw = (amount: number, fee = 0n, feePayee = ZERO): Action => ({
    kind: "withdraw",
    mint: ZERO,
    dest: payer.toBytes(),
    amount: BigInt(Math.round(amount * LAMPORTS_PER_SOL)),
    fee,
    feePayee,
  });
  const next = async () => pickLeaf((await fetchState(program, vault))!, signer, await findSignedMessages(program, vault, signer)).leaf;

  // 1. Pay fees ourselves.
  const params = { program, payer, vault, signer, leaf: await next(), action: withdraw(0.01) };
  const pre = await preflightAction(params);
  if (pre.errors.length) throw new Error(pre.errors.join("; "));
  for (const t of (await planAction(params)).transactions) console.log(t.label, await send(t.instructions));

  // 2. Through the relayer module, with a separate fee-paying key.
  const relayer = Keypair.generate();
  await send([SystemProgram.transfer({ fromPubkey: payer, toPubkey: relayer.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL })]);
  const rp = new anchor.Program<Noxvault>(idl as Noxvault, new anchor.AnchorProvider(conn, new anchor.Wallet(relayer), { commitment: "confirmed" }));
  const leaf = await next();
  const action = withdraw(0.01, 1_000_000n, Uint8Array.from(relayer.publicKey.toBytes()));
  const digest = messageDigest(program.programId.toBytes(), vault.toBytes(), 0, leaf, encodeAction(action));
  const relayed = await relay(rp, relayer, { vault, tree: 0, leaf, pkSeed: signer.seeds.pkSeed, authPath: authPath(signer.pub, leaf), signature: sign(signer.seeds, leaf, digest), action }, { minFee: 500_000n });
  console.log("relayed", relayed.length, "transactions");

  // 3. Schedules need the Guardian tier: put enough $NOX in the vault itself.
  const protocol = (await fetchProtocol(program))!;
  if (!protocol.noxMint.equals(PublicKey.default)) {
    const tp = (await conn.getAccountInfo(protocol.noxMint))!.owner;
    const decimals = (await getMint(conn, protocol.noxMint, "confirmed", tp)).decimals;
    const from = getAssociatedTokenAddressSync(protocol.noxMint, payer, false, tp);
    const to = getAssociatedTokenAddressSync(protocol.noxMint, vault, true, tp);
    await send([
      createAssociatedTokenAccountIdempotentInstruction(payer, to, vault, protocol.noxMint, tp),
      createTransferCheckedInstruction(from, protocol.noxMint, to, payer, protocol.guardian, decimals, [], tp),
    ]);
    console.log("tier:", (await vaultTier(program, vault)).name);
  }
  // A schedule of two payments, run by anyone.
  const sched: Action = { kind: "schedule", id: 0, mint: ZERO, dest: payer.toBytes(), amount: 5_000_000n, interval: 2n, count: 2, start: 0n, fee: 0n, feePayee: ZERO };
  for (const t of (await planAction({ program, payer, vault, signer, leaf: await next(), action: sched })).transactions) await send(t.instructions);
  // getProgramAccounts on a public RPC can lag a few seconds behind a confirmed transaction.
  let s = (await vaultSchedules(program, vault))[0];
  for (let i = 0; !s && i < 15; i++) {
    await sleep(2000);
    s = (await vaultSchedules(program, vault))[0];
  }
  await send([await runScheduleIx(program, payer, vault, s)]);
  console.log("schedule paid once; remaining", (await vaultSchedules(program, vault))[0]?.remaining);

  const signed = await findSignedMessages(program, vault, signer);
  const state = (await fetchState(program, vault))!;
  console.log(`history: ${signed.length} signed messages; actions on chain: ${state.actions}; vault ${(await conn.getBalance(vault)) / LAMPORTS_PER_SOL} SOL`);
  const again = await preflightAction({ ...params, leaf: signed[0].leaf, action: withdraw(0.001) });
  console.log("reusing a key refused:", again.errors.some((e) => /already/.test(e)));
  const c = await fetchCanary(program);
  console.log(`canary ${c?.watched.toBase58()} bounty ${(c?.balance ?? 0) / LAMPORTS_PER_SOL} SOL, tripped: ${c?.tripped}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
