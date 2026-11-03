// GET /api/telegram/cron — one alert pass (docs/TELEGRAM_BOT.md). Guarded by
// `Authorization: Bearer ${CRON_SECRET}` (Vercel sends that header to cron routes).
// Read-only on chain: it never sends a transaction.
import { alertsFor } from "@/lib/alerts/logic";
import { readSnapshot } from "@/lib/alerts/chain";
import { AlertStore, redisFromEnv } from "@/lib/alerts/store";
import { safeEqual, sendMessage } from "@/lib/alerts/telegram";
import { ALERTS_SITE_URL } from "@/lib/alerts/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONCURRENCY = 4;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set on this server" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Response.json({ error: "TELEGRAM_BOT_TOKEN is not set on this server" }, { status: 503 });
  const redis = redisFromEnv();
  if (!redis) return Response.json({ error: "KV_REST_API_URL / KV_REST_API_TOKEN are not set on this server" }, { status: 503 });

  const store = new AlertStore(redis);
  const vaults = await store.vaults();
  const now = Math.floor(Date.now() / 1000);
  const report = { vaults: vaults.length, read: 0, sent: 0, failed: 0, errors: [] as string[] };

  async function one(vault: string) {
    try {
      const [prev, cur, chats] = await Promise.all([store.snapshot(vault), readSnapshot(vault), store.watchers(vault)]);
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
