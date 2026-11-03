// Minimal Telegram Bot API client (plain fetch, no SDK).

export interface TgUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; text?: string };
}

export type SendResult = { ok: true } | { ok: false; status: number; description: string; gone: boolean };

/** Sends plain text (no parse mode, so nothing in a message can inject formatting or links). */
export async function sendMessage(token: string, chatId: string | number, text: string): Promise<SendResult> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { description?: string };
  const description = body.description ?? res.statusText;
  // 403: the user blocked the bot / the bot was removed; 400 "chat not found": the chat is gone.
  const gone = res.status === 403 || (res.status === 400 && /chat not found/i.test(description));
  return { ok: false, status: res.status, description, gone };
}

/** Compares secrets in constant time. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
