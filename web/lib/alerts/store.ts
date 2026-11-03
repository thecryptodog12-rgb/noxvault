// Redis storage for the Telegram bot: Upstash Redis from the Vercel Marketplace
// (KV_REST_API_URL / KV_REST_API_TOKEN). Returns null when not configured.
import { Redis } from "@upstash/redis";
import type { VaultSnapshot, WatchStore } from "./logic";

const K = {
  chat: (chat: string) => `nox:tg:chat:${chat}`, // set of vaults a chat watches
  watchers: (vault: string) => `nox:tg:watchers:${vault}`, // set of chats watching a vault
  vaults: "nox:tg:vaults", // set of all watched vaults
  snap: (vault: string) => `nox:tg:snap:${vault}`,
  sent: (chat: string, vault: string, key: string) => `nox:tg:sent:${chat}:${vault}:${key}`,
};
/** How long a sent-alert marker lives. Every alert key embeds the event's own timestamp, so this only bounds storage. */
const SENT_TTL_SECS = 120 * 86_400;

export function redisFromEnv(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

export class AlertStore implements WatchStore {
  constructor(private r: Redis) {}

  async list(chat: string): Promise<string[]> {
    return ((await this.r.smembers(K.chat(chat))) as string[]).sort();
  }

  async add(chat: string, vault: string): Promise<void> {
    await Promise.all([this.r.sadd(K.chat(chat), vault), this.r.sadd(K.watchers(vault), chat), this.r.sadd(K.vaults, vault)]);
  }

  async remove(chat: string, vault: string): Promise<boolean> {
    const n = await this.r.srem(K.chat(chat), vault);
    await this.r.srem(K.watchers(vault), chat);
    if ((await this.r.scard(K.watchers(vault))) === 0) await Promise.all([this.r.srem(K.vaults, vault), this.r.del(K.snap(vault))]);
    return n > 0;
  }

  async vaults(): Promise<string[]> {
    return (await this.r.smembers(K.vaults)) as string[];
  }

  async watchers(vault: string): Promise<string[]> {
    return ((await this.r.smembers(K.watchers(vault))) as unknown[]).map(String);
  }

  async snapshot(vault: string): Promise<VaultSnapshot | null> {
    // @upstash/redis parses JSON values automatically
    return (await this.r.get<VaultSnapshot>(K.snap(vault))) ?? null;
  }

  async saveSnapshot(s: VaultSnapshot): Promise<void> {
    await this.r.set(K.snap(s.vault), s);
  }

  /** Claims an alert for a chat; true only the first time (SET NX), so each alert is sent once. */
  async claim(chat: string, vault: string, key: string): Promise<boolean> {
    return (await this.r.set(K.sent(chat, vault, key), 1, { nx: true, ex: SENT_TTL_SECS })) === "OK";
  }

  /** Gives a claim back after a failed send, so the next run retries it. */
  async release(chat: string, vault: string, key: string): Promise<void> {
    await this.r.del(K.sent(chat, vault, key));
  }

  /** Removes a chat entirely (it blocked the bot or was deleted). */
  async dropChat(chat: string): Promise<void> {
    for (const v of await this.list(chat)) await this.remove(chat, v);
  }
}
