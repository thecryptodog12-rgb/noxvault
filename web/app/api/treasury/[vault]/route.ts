import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "@/lib/config";
import { loadTreasury } from "@/lib/treasury";

export const runtime = "nodejs";
export const revalidate = 60;

const CORS = { "access-control-allow-origin": "*", "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };

/** Public, read-only treasury summary for project sites, listings and bots. */
export async function GET(_req: Request, { params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  let key: PublicKey;
  try {
    key = new PublicKey(vault);
  } catch {
    return Response.json({ error: "not a Solana address" }, { status: 400, headers: CORS });
  }
  try {
    const t = await loadTreasury(new Connection(RPC_URL, "confirmed"), key);
    return Response.json(t, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: CORS });
  }
}
