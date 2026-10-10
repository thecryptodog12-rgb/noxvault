// End-to-end check against a live cluster: create a vault, fund it, withdraw twice from the
// same address (once paying fees ourselves, once through the relayer module), check history.
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import {
  Noxvault,
  TREE_PRIMARY,
  fetchState,
  findSignedMessages,
  idl,
  initVaultIx,
  makeConfig,
  makeSigner,
  newMasterSecret,
  pickLeaf,
  planAction,
  preflightAction,
  vaultOf,
} from "../sdk/client";
import { relay } from "../sdk/relayer";
import { Action, authPath, encodeAction, messageDigest, sign } from "../sdk/wots";

async function main() {
  // "confirmed" blockhashes: a "processed" one is often unknown to the node that simulates.
  const env = anchor.AnchorProvider.env();
  const conn = new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed");
  const provider = new anchor.AnchorProvider(conn, env.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program<Noxvault>(idl as Noxvault, provider);
  const payer = provider.wallet.publicKey;
  // Public RPCs sometimes simulate against a lagging node; every step is retry-safe.
  const send = async (tx: Transaction, signers: Keypair[] = []): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await provider.sendAndConfirm(tx, signers, { commitment: "confirmed" });
      } catch (e) {
        if (attempt >= 4 || !/Blockhash not found|block height exceeded/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };

  const t0 = Date.now();
  const signer = makeSigner(newMasterSecret(), 0, TREE_PRIMARY);
  console.log(`tree built in ${Date.now() - t0} ms`);
  const config = makeConfig(signer);
  const vault = vaultOf(config);
  await send(
    new Transaction().add(
      await initVaultIx(program, payer, config),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: vault, lamports: 0.05 * LAMPORTS_PER_SOL })
    )
  );
  console.log("vault", vault.toBase58(), "initialized + funded");

  const withdraw = (amount: number, fee = 0n, feePayee = payer): Action => ({
    kind: "withdraw",
    mint: new Uint8Array(32),
    dest: payer.toBytes(),
    amount: BigInt(amount * LAMPORTS_PER_SOL),
    fee,
    feePayee: feePayee.toBytes(),
  });

  // 1. Pay fees ourselves.
  let state = (await fetchState(program, vault))!;
  let { leaf } = pickLeaf(state, signer, await findSignedMessages(program, vault, signer));
  const params = { program, payer, vault, signer, leaf, action: withdraw(0.01) };
  const pre = await preflightAction(params);
  if (pre.errors.length) throw new Error(pre.errors.join("; "));
  for (const t of (await planAction(params)).transactions) console.log(t.label, await send(new Transaction().add(...t.instructions)));

  // 2. Through the relayer module, with a separate fee-paying key.
  const relayer = Keypair.generate();
  await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: relayer.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL })));
  const rp = new anchor.Program<Noxvault>(idl as Noxvault, new anchor.AnchorProvider(conn, new anchor.Wallet(relayer), { commitment: "confirmed" }));
  state = (await fetchState(program, vault))!;
  ({ leaf } = pickLeaf(state, signer, await findSignedMessages(program, vault, signer)));
  const action = withdraw(0.01, 1_000_000n, relayer.publicKey);
  const digest = messageDigest(program.programId.toBytes(), vault.toBytes(), 0, leaf, encodeAction(action));
  const relayed = await relay(
    rp,
    relayer,
    { vault, tree: 0, leaf, pkSeed: signer.seeds.pkSeed, authPath: authPath(signer.pub, leaf), signature: sign(signer.seeds, leaf, digest), action },
    { minFee: 500_000n }
  );
  console.log("relayed", relayed.length, "transactions");

  const signed = await findSignedMessages(program, vault, signer);
  state = (await fetchState(program, vault))!;
  console.log(`history: ${signed.length} signed messages; actions on chain: ${state.actions}; vault balance ${(await conn.getBalance(vault)) / LAMPORTS_PER_SOL} SOL`);
  const again = await preflightAction({ ...params, leaf: signed[0].leaf, action: withdraw(0.001) });
  console.log("reusing a key refused:", again.errors.some((e) => /already/.test(e)));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
