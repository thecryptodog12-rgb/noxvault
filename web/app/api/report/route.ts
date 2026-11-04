// The Solana Quantum Exposure Report snapshot as JSON, for journalists and embeds.
import { loadReport } from "@/lib/reportData";

export const dynamic = "force-static";

export async function GET() {
  const r = await loadReport();
  const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=300, s-maxage=3600" };
  if (!r) return Response.json({ error: "snapshot pending" }, { status: 503, headers });
  return Response.json(r, { headers });
}
