import { explainError } from "@nox/sdk/client";
import { decodeRelayRequest, relay, type RelayRequest } from "@nox/sdk/relayer";
import { HttpError, errorResponse, rateLimit, relayerContext } from "@/lib/server/relayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    rateLimit(req, "relay", 10, 60_000);
    const { relayer, program, policy } = relayerContext();
    let body: RelayRequest;
    try {
      body = (await req.json()) as RelayRequest;
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
    let signed;
    try {
      signed = decodeRelayRequest(body);
    } catch (e) {
      throw new HttpError(400, `Bad relay request: ${(e as Error).message}`);
    }
    // relay() verifies signature, Merkle path, unused leaf, fee and vault balance before spending.
    let signatures: string[];
    try {
      signatures = await relay(program, relayer, signed, policy);
    } catch (e) {
      // Program errors (fee cap, lockdown fee, restricted migration or budget, …) as sentences.
      throw new HttpError(422, explainError(e));
    }
    return Response.json({ signatures });
  } catch (e) {
    return errorResponse(e);
  }
}
