// POST /api/telegram — Telegram webhook (docs/TELEGRAM_BOT.md). Telegram signs each call with the
// secret given to setWebhook in X-Telegram-Bot-Api-Secret-Token; anything else is refused.
import { handleCommand } from "@/lib/alerts/logic";
import { parseAddress, readSnapshot } from "@/lib/alerts/chain";
import { AlertStore, redisFromEnv } from "@/lib/alerts/store";
import { safeEqual, sendMessage, type TgUpdate } from "@/lib/alerts/telegram";
import { ALERTS_SITE_URL } from "@/lib/alerts/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return Response.json({ error: "TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET are not set on this server" }, { status: 503 });
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return Response.json({ ok: true }); // never make Telegram retry a malformed update
  }
  const msg = update.message;
  if (!msg?.text) return Response.json({ ok: true });
  const chat = String(msg.chat.id);

  const redis = redisFromEnv();
  let reply: string | null;
  try {
    reply = await handleCommand(msg.text, chat, {
      store: redis ? new AlertStore(redis) : null,
      parseAddress,
      snapshot: (v) => readSnapshot(v),
      now: () => Math.floor(Date.now() / 1000),
      siteUrl: ALERTS_SITE_URL,
    });
  } catch (e) {
    console.error("telegram command failed", e);
    reply = "Something went wrong reading the chain or storage. Try again in a minute.";
  }
  // Plain text gets no reply, except the warning when it looks like a pasted phrase.
  if (reply) {
    const r = await sendMessage(token, chat, reply);
    if (!r.ok) console.error("telegram send failed", r.status, r.description);
  }
  return Response.json({ ok: true });
}
