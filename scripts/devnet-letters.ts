// Sealed letters against a live cluster (spec §12): create a vault, authorize a letter key,
// write a 2 KB letter, read it back, overwrite it, close it. Usage: pnpm exec tsx scripts/devnet-letters.ts
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  Noxvault, closeLetterIx, fetchLetter, fetchLetterKey, fetchState, findSignedMessages, idl, initVaultIx, makeConfig,
  makeSigner, newMasterSecret, pickLeaf, planAction, preflightAction, vaultOf, writeLetterIxs,
} from "../sdk/client";
import type { Action } from "../sdk/wots";

const ZERO = new Uint8Array(32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = anchor.AnchorProvider.env();
  const conn = new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed");
  const provider = new anchor.AnchorProvider(conn, env.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program<Noxvault>(idl as Noxvault, provider);
  const payer = provider.wallet.publicKey;
  const send = async (ixs: TransactionInstruction[], signers: Keypair[] = []) => {
    for (let a = 1; ; a++) {
      try {
        return await provider.sendAndConfirm(new Transaction().add(...ixs), signers, { commitment: "confirmed" });
      } catch (e) {
        if (a >= 4 || !/Blockhash not found|block height exceeded/.test(String(e))) throw e;
        await sleep(1500);
      }
    }
  };
  // Letter instructions are signed and paid by the letter key alone, as the web app does.
  const sendAsKey = async (ix: TransactionInstruction, k: Keypair) => {
    const tx = new Transaction().add(ix);
    tx.feePayer = k.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(k);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    const r = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (r?.meta?.err) throw new Error(JSON.stringify(r.meta.err));
    return sig;
  };
  const signer = makeSigner(newMasterSecret(), 0, 0);
  const config = makeConfig(signer);
  const vault = vaultOf(config);
  const key = Keypair.generate();
  await send([
    await initVaultIx(program, payer, config),
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: vault, lamports: 0.03 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: key.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
  ]);
  console.log("vault", vault.toBase58());
  const before = (await fetchState(program, vault))!.lastActive;

  const action: Action = { kind: "letterKey", key: key.publicKey.toBytes(), fee: 0n, feePayee: ZERO };
  const leaf = pickLeaf((await fetchState(program, vault))!, signer, await findSignedMessages(program, vault, signer)).leaf;
  const params = { program, payer, vault, signer, leaf, action };
  const pre = await preflightAction(params);
  if (pre.errors.length) throw new Error(pre.errors.join("; "));
  for (const t of (await planAction(params)).transactions) await send(t.instructions);
  const lk = await fetchLetterKey(program, vault);
  console.log("letter key set:", lk?.key.equals(key.publicKey));

  const big = Uint8Array.from({ length: 2000 }, (_, i) => i % 251);
  for (const ix of await writeLetterIxs(program, key.publicKey, vault, 0, { label: "for my heirs", unlockRound: 99_999_999n, ciphertext: big })) await sendAsKey(ix, key);
  let l = await fetchLetter(program, vault, 0);
  console.log("letter written:", l?.ciphertext.length, "bytes, intact:", !!l && l.ciphertext.every((b, i) => b === big[i]), "label:", l?.label);
  const small = Uint8Array.from({ length: 300 }, () => 7);
  for (const ix of await writeLetterIxs(program, key.publicKey, vault, 0, { label: "v2", unlockRound: 100_000_000n, ciphertext: small })) await sendAsKey(ix, key);
  l = await fetchLetter(program, vault, 0);
  console.log("overwritten:", l?.ciphertext.length, "bytes, round", l?.unlockRound.toString());
  const stranger = Keypair.generate();
  try {
    await sendAsKey(await closeLetterIx(program, stranger.publicKey, vault, 0), stranger);
    console.log("stranger close: NOT refused (bad)");
  } catch {
    console.log("stranger close refused: true");
  }
  await sendAsKey(await closeLetterIx(program, key.publicKey, vault, 0), key);
  console.log("closed:", (await fetchLetter(program, vault, 0)) === null);
  const st = (await fetchState(program, vault))!;
  console.log("vault balance", (await conn.getBalance(vault)) / LAMPORTS_PER_SOL, "lastActive moved only by the signed action:", st.lastActive >= before);
}
main().catch((e) => (console.error(e), process.exit(1)));
