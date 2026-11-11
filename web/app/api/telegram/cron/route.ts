// GET /api/telegram/cron — one alert pass (docs/TELEGRAM_BOT.md, docs/ALERTS.md). Guarded by
// `Authorization: Bearer ${CRON_SECRET}` (Vercel sends that header to cron routes; the GitHub
// Actions workflow .github/workflows/alerts.yml sends it every 10 minutes).
// Sends each alert to Telegram chats and to Web Push devices watching the vault; each recipient
// gets each alert key once. Read-only on chain: it never sends a transaction.
import { alertsFor } from "@/lib/alerts/logic";
import { readSnapshot } from "@/lib/alerts/chain";
import { AlertStore, PushStore, redisFromEnv } from "@/lib/alerts/store";
import { safeEqual, sendMessage } from "@/lib/alerts/telegram";
import { pushPayload } from "@/lib/alerts/push";
import { sendPush, vapidFromEnv } from "@/lib/alerts/webpush";
import { ALERTS_SITE_URL } from "@/lib/alerts/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONCURRENCY = 4;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set on this server" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const token = process.env.TELEGRAM_BOT_TOKEN || null;
  const vapid = vapidFromEnv();
  if (!token && !vapid) return Response.json({ error: "Neither TELEGRAM_BOT_TOKEN nor the VAPID keys are set on this server" }, { status: 503 });
  const redis = redisFromEnv();
  if (!redis) return Response.json({ error: "KV_REST_API_URL / KV_REST_API_TOKEN are not set on this server" }, { status: 503 });

  const store = new AlertStore(redis);
  const push = new PushStore(redis);
  const [tgVaults, pushVaults] = await Promise.all([token ? store.vaults() : [], vapid ? push.vaults() : []]);
  const vaults = [...new Set([...tgVaults, ...pushVaults])];
  const now = Math.floor(Date.now() / 1000);
  const report = { vaults: vaults.length, read: 0, sent: 0, pushed: 0, failed: 0, errors: [] as string[] };

  async function one(vault: string) {
    try {
      const [prev, cur, chats, subs] = await Promise.all([
        store.snapshot(vault),
        readSnapshot(vault),
        token ? store.watchers(vault) : [],
        vapid ? push.watchers(vault) : [],
      ]);
      if (!cur) {
        report.errors.push(`${vault}: no Noxvault state`);
        return;
      }
      report.read++;
      for (const a of alertsFor(prev, cur, now, ALERTS_SITE_URL)) {
        for (const chat of chats) {
          if (!(await store.claim(chat, vault, a.key))) continue;
          const r = await sendMessage(token!, chat, a.text);
          if (r.ok) report.sent++;
          else {
            report.failed++;
            if (r.gone) await store.dropChat(chat);
            else await store.release(chat, vault, a.key); // retry next run
          }
        }
        for (const id of subs) {
          const sub = await push.subscription(id);
          if (!sub) {
            await push.remove(id, vault);
            continue;
          }
          if (!(await push.claim(id, vault, a.key))) continue;
          const r = await sendPush(vapid!, sub, pushPayload(a, vault));
          if (r.ok) report.pushed++;
          else {
            report.failed++;
            if (r.gone) await push.drop(id); // expired or revoked: never retry
            else await push.release(id, vault, a.key);
          }
        }
      }
      await store.saveSnapshot(cur);
    } catch (e) {
      report.errors.push(`${vault}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const queue = [...vaults];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let v = queue.shift(); v; v = queue.shift()) await one(v);
  }));
  return Response.json(report);
}
