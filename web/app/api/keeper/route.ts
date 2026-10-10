// GET /api/keeper — one keeper pass (docs/SPEC.md §8), run by the Vercel cron in vercel.json.
// Guarded by `Authorization: Bearer ${CRON_SECRET}` (Vercel sends that header to cron routes).
// Pays fees with the relayer key. It can only run what the on-chain rules already allow.
import { runKeeper } from "@/lib/keeper";
import { errorResponse, relayerContext } from "@/lib/server/relayer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set on this server" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { relayer, program } = relayerContext();
    const report = await runKeeper(program, relayer, { maxTx: Number(process.env.KEEPER_MAX_TX || 25) });
    return Response.json(report);
  } catch (e) {
    return errorResponse(e);
  }
}
