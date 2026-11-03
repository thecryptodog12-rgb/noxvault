import { MAX_ACTION_FEE } from "@nox/sdk/client";
import { relayFee } from "@nox/sdk/relayer";
import { errorResponse, relayerContext } from "@/lib/server/relayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { relayer, policy } = relayerContext();
    return Response.json({
      relayer: relayer.publicKey.toBase58(),
      minFee: relayFee(policy).toString(),
      // The program refuses any fee above this (docs/SPEC.md §4); the relayer never asks more.
      maxFee: MAX_ACTION_FEE.toString(),
      // Signer Ping and cancels during a lockdown must carry fee 0; this relayer sends them free.
      lockdownFree: true,
      sentinelFree: policy.sentinelFree !== false,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
