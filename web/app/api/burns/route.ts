import { Connection } from "@solana/web3.js";
import { NOX_BURN_WALLET, NOX_MAINNET_RPC_URL, NOX_TOKEN } from "@/lib/config";
import { loadBurns, type BurnResponse } from "@/lib/burns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
const TTL_MS = 60_000;

// One history scan per minute per server instance, whatever the traffic.
let cached: { at: number; body: BurnResponse } | null = null;
let inflight: Promise<BurnResponse> | null = null;

/** $NOX burns by the published burn wallet (lib/burns.ts explains how they are counted). */
export async function GET() {
  const missing: ("mint" | "wallet")[] = [];
  if (!NOX_TOKEN) missing.push("mint");
  if (!NOX_BURN_WALLET) missing.push("wallet");
  if (missing.length) return Response.json({ configured: false, missing } satisfies BurnResponse, { headers: HEADERS });

  if (cached && Date.now() - cached.at < TTL_MS) return Response.json(cached.body, { headers: HEADERS });
  inflight ??= loadBurns(new Connection(process.env.NOX_BURN_RPC_URL || NOX_MAINNET_RPC_URL, "confirmed"), NOX_TOKEN, NOX_BURN_WALLET)
    .then((r): BurnResponse => {
      cached = { at: Date.now(), body: r };
      return r;
    })
    .catch((e): BurnResponse => ({ configured: true, error: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      inflight = null;
    });
  const body = await inflight;
  const failed = "error" in body;
  return Response.json(body, { status: failed ? 502 : 200, headers: failed ? { "cache-control": "no-store" } : HEADERS });
}
