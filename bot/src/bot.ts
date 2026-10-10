import { Bot, GrammyError } from "grammy";
import { PublicKey } from "@solana/web3.js";
import type { Config } from "./config.js";
import type { StateStore } from "./state.js";
import { short } from "./summarize.js";
import { HELP, SEED_WARNING } from "./texts.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function parseAddress(input: string): string | null {
  const s = input.trim();
  if (!BASE58.test(s)) return null;
  try {
    return new PublicKey(s).toBase58() === s ? s : null;
  } catch {
    return null;
  }
}

/** 12+ lowercase words in a row — likely someone pasting a mnemonic. */
export function looksLikeSeed(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 12 && words.every((w) => /^[a-z]{3,8}$/.test(w));
}

export function createBot(cfg: Config, state: StateStore): Bot {
  const bot = new Bot(cfg.telegramToken);
  const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP, html));

  bot.command("watch", async (ctx) => {
    const address = parseAddress(ctx.match ?? "");
    if (!address) return ctx.reply("Usage: /watch &lt;vault address&gt; (a base58 Solana address)", html);
    const res = await state.watch(ctx.chat.id, address);
    if (res === "exists") return ctx.reply(`Already watching <code>${address}</code>.`, html);
    if (res === "limit") return ctx.reply(`This chat already watches ${cfg.maxWatchesPerChat} addresses. /unwatch one first.`);
    return ctx.reply(
      `👀 Watching <code>${address}</code> on ${cfg.network}.\nYou'll get a message for every new transaction from now on.`,
      html,
    );
  });

  bot.command("unwatch", async (ctx) => {
    const address = parseAddress(ctx.match ?? "");
    if (!address) return ctx.reply("Usage: /unwatch &lt;vault address&gt;", html);
    const ok = await state.unwatch(ctx.chat.id, address);
    return ctx.reply(ok ? `Stopped watching <code>${short(address)}</code>.` : "That address isn't on this chat's list.", html);
  });

  bot.command("list", (ctx) => {
    const list = state.list(ctx.chat.id);
    if (!list.length) return ctx.reply("Nothing watched yet. Use /watch &lt;vault address&gt;.", html);
    return ctx.reply(
      `Watching ${list.length}/${cfg.maxWatchesPerChat}:\n` + list.map((a) => `• <code>${a}</code>`).join("\n"),
      html,
    );
  });

  bot.on("message:text", async (ctx) => {
    if (looksLikeSeed(ctx.message.text)) await ctx.reply(SEED_WARNING, html);
  });

  bot.catch((err) => console.error("[bot] handler error:", err.error));
  return bot;
}

/** Sends a notification; drops a chat's watches if the bot was blocked/kicked. */
export function makeNotifier(bot: Bot, state: StateStore) {
  return async (chatId: string, text: string): Promise<void> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await bot.api.sendMessage(chatId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
        return;
      } catch (e) {
        if (e instanceof GrammyError) {
          if (e.error_code === 429) {
            const after = (e.parameters?.retry_after ?? 5) * 1000;
            await new Promise((r) => setTimeout(r, after));
            continue;
          }
          if (e.error_code === 403 || (e.error_code === 400 && /chat not found/i.test(e.description))) {
            console.warn(`[bot] chat ${chatId} unreachable (${e.description}); removing its watches`);
            await state.removeChat(chatId);
            return;
          }
        }
        console.error(`[bot] send to ${chatId} failed:`, (e as any)?.message ?? e);
        return;
      }
    }
  };
}
