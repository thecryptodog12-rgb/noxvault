import { errorResponse, relayerContext } from "@/lib/server/relayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { relayer, policy } = relayerContext();
    return Response.json({
      relayer: relayer.publicKey.toBase58(),
      minFee: policy.minFee.toString(),
      sentinelFree: policy.sentinelFree !== false,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
