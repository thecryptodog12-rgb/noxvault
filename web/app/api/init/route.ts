import { PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TIER_NAMES, fetchState, initVaultIx, tierNeeded, vaultOf, vaultTier } from "@nox/sdk/client";
import { HttpError, errorResponse, rateLimit, relayerContext } from "@/lib/server/relayer";
import { parseConfig } from "@/lib/server/parseConfig";
import type { ConfigJson } from "@/lib/configJson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_BALANCE = 0.02 * LAMPORTS_PER_SOL;

export async function POST(req: Request) {
  try {
    rateLimit(req, "init", 5, 60_000);
    const { relayer, program } = relayerContext();
    let body: ConfigJson;
    try {
      body = (await req.json()) as ConfigJson;
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
    const config = parseConfig(body);
    const conn = program.provider.connection;
    const vault = vaultOf(config, program.programId);
    if (await fetchState(program, vault)) return Response.json({ vault: vault.toBase58(), already: true });
    const balance = await conn.getBalance(vault, "confirmed");
    if (balance < MIN_BALANCE)
      throw new HttpError(402, `The vault must hold at least ${MIN_BALANCE / LAMPORTS_PER_SOL} SOL before the relayer initializes it (it holds ${balance / LAMPORTS_PER_SOL}).`);
    const need = tierNeeded(config);
    const tier = await vaultTier(program, vault);
    if (tier.tiersOn && tier.tier < need)
      throw new HttpError(402, `These settings need the ${TIER_NAMES[need]} tier: send more $NOX to the vault first (it holds ${tier.held} base units).`);
    // The program charges the creation fee to whoever pays for init: relaying a Free-tier init
    // would have the relayer pay it, which anyone could repeat to drain the relayer.
    if (tier.tiersOn && tier.tier < 1)
      throw new HttpError(402, "Free-tier vaults are initialized with your own wallet (it pays the creation fee). Hold Guardian-tier $NOX in the vault to have the relayer initialize it for free.");
    const tx = new Transaction().add(await initVaultIx(program, relayer.publicKey, config));
    tx.feePayer = relayer.publicKey;
    let sig = "";
    for (let attempt = 1; ; attempt++) {
      try {
        sig = await sendAndConfirmTransaction(conn, tx, [relayer], { commitment: "confirmed" });
        break;
      } catch (e) {
        if (attempt >= 3 || !/Blockhash not found|block height exceeded/.test(String(e))) throw e;
      }
    }
    return Response.json({ vault: vault.toBase58(), signature: sig });
  } catch (e) {
    return errorResponse(e);
  }
}
