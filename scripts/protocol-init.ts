// Creates or updates the protocol parameters ($NOX mint, tiers, fee, treasury). Admin only.
// Usage: pnpm exec tsx scripts/protocol-init.ts <noxMint> <guardianTokens> <sentinelTokens> <createFeeSol> <treasury>
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Noxvault, fetchProtocol, idl, initProtocolIx, updateProtocolIx } from "../sdk/client";

async function main() {
  const [mintArg, g, s, fee, treasuryArg] = process.argv.slice(2);
  const env = anchor.AnchorProvider.env();
  const conn = new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed");
  const provider = new anchor.AnchorProvider(conn, env.wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new anchor.Program<Noxvault>(idl as Noxvault, provider);
  const noxMint = new PublicKey(mintArg);
  const owner = (await conn.getAccountInfo(noxMint))!.owner;
  const decimals = (await getMint(conn, noxMint, "confirmed", owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)).decimals;
  const units = (x: string) => BigInt(Math.round(Number(x) * 10 ** decimals));
  const params = { noxMint, guardian: units(g), sentinel: units(s), createFee: BigInt(Math.round(Number(fee) * 1e9)), treasury: new PublicKey(treasuryArg) };
  const admin = provider.wallet.publicKey;
  const ix = (await fetchProtocol(program)) ? await updateProtocolIx(program, admin, params) : await initProtocolIx(program, admin, params);
  await provider.sendAndConfirm(new Transaction().add(ix));
  console.log(await fetchProtocol(program));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
