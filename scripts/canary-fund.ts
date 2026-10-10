// Adds to the canary bounty and records it as the new baseline (docs/SPEC.md §7).
// Usage: pnpm exec tsx scripts/canary-fund.ts <sol>
import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { CANARY_ADDRESS, Noxvault, fetchCanary, idl, raiseBaselineIx } from "../sdk/client";

async function main() {
  const env = anchor.AnchorProvider.env();
  const conn = new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed");
  const provider = new anchor.AnchorProvider(conn, env.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program<Noxvault>(idl as Noxvault, provider);
  const sol = Number(process.argv[2] ?? "0.1");
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({ fromPubkey: provider.wallet.publicKey, toPubkey: CANARY_ADDRESS, lamports: Math.round(sol * LAMPORTS_PER_SOL) }),
      await raiseBaselineIx(program)
    )
  );
  const c = await fetchCanary(program);
  console.log(`canary bounty ${c!.balance / LAMPORTS_PER_SOL} SOL, baseline ${Number(c!.baseline) / LAMPORTS_PER_SOL} SOL, tripped ${c!.tripped}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
