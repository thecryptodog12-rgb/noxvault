// POST /api/push — Web Push subscriptions for vault alerts (docs/ALERTS.md).
// Body: { action: "subscribe", vault, subscription } | { action: "unsubscribe", vault, endpoint }
//     | { action: "status", endpoint } | { action: "rotate", oldEndpoint, subscription }
// The endpoint URL is the device's secret: whoever has it can manage that device's alerts.
// Read-only on chain: it never sends a transaction and never sees a phrase or key.
import { MAX_WATCH } from "@/lib/alerts/logic";
import { parseAddress, readSnapshot } from "@/lib/alerts/chain";
import { PushStore, redisFromEnv } from "@/lib/alerts/store";
import { isPushEndpoint, parseSubscription, subId, welcomePayload } from "@/lib/alerts/push";
import { sendPush, vapidFromEnv } from "@/lib/alerts/webpush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const vapid = vapidFromEnv();
  if (!vapid) return bad("Push alerts are not configured on this server yet (VAPID keys).", 503);
  const redis = redisFromEnv();
  if (!redis) return bad("Alerts storage is not configured on this server yet (KV_REST_API_URL / KV_REST_API_TOKEN).", 503);
  const store = new PushStore(redis);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Expected a JSON body.");
  }
  const endpointOf = (x: unknown) => (typeof x === "string" && isPushEndpoint(x) ? x : null);

  switch (body.action) {
    case "status": {
      const endpoint = endpointOf(body.endpoint);
      if (!endpoint) return bad("Not a push subscription endpoint.");
      return Response.json({ vaults: await store.list(subId(endpoint)) });
    }

    case "subscribe": {
      const sub = parseSubscription(body.subscription);
      if (!sub) return bad("Not a valid push subscription.");
      const vault = typeof body.vault === "string" ? parseAddress(body.vault) : null;
      if (!vault) return bad("That is not a Solana address.");
      const id = subId(sub.endpoint);
      const have = await store.list(id);
      if (!have.includes(vault)) {
        if (have.length >= MAX_WATCH) return bad(`This device already watches ${MAX_WATCH} vaults, the maximum. Turn one off first.`, 409);
        const snap = await readSnapshot(vault).catch(() => null);
        if (!snap) return bad("No Noxvault at that address (or the chain could not be read).", 404);
      }
      await store.add(id, sub, vault);
      // a confirmation, so the user sees right away that notifications reach this device
      const r = await sendPush(vapid, sub, welcomePayload(vault));
      if (!r.ok && r.gone) {
        await store.drop(id);
        return bad("The browser's push service refused this subscription. Turn alerts off and on again.", 410);
      }
      return Response.json({ vaults: await store.list(id), test: r.ok });
    }

    case "unsubscribe": {
      const endpoint = endpointOf(body.endpoint);
      const vault = typeof body.vault === "string" ? parseAddress(body.vault) : null;
      if (!endpoint || !vault) return bad("Need endpoint and vault.");
      const id = subId(endpoint);
      await store.remove(id, vault);
      return Response.json({ vaults: await store.list(id) });
    }

    case "rotate": {
      const oldEndpoint = endpointOf(body.oldEndpoint);
      const sub = parseSubscription(body.subscription);
      if (!oldEndpoint || !sub) return bad("Need oldEndpoint and a valid subscription.");
      const vaults = await store.rotate(subId(oldEndpoint), subId(sub.endpoint), sub);
      return Response.json({ vaults });
    }

    default:
      return bad("Unknown action.");
  }
}
