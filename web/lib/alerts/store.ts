// Redis storage for alerts (Telegram bot and Web Push): Upstash Redis from the Vercel Marketplace
// (KV_REST_API_URL / KV_REST_API_TOKEN). Returns null when not configured. Both channels share
// one snapshot per vault (nox:tg:snap:<vault>); each keeps its own subscribers and sent markers.
import { Redis } from "@upstash/redis";
import type { VaultSnapshot, WatchStore } from "./logic";
import type { PushSub } from "./push";

const K = {
  chat: (chat: string) => `nox:tg:chat:${chat}`, // set of vaults a chat watches
  watchers: (vault: string) => `nox:tg:watchers:${vault}`, // set of chats watching a vault
  vaults: "nox:tg:vaults", // set of all watched vaults
  snap: (vault: string) => `nox:tg:snap:${vault}`,
  sent: (chat: string, vault: string, key: string) => `nox:tg:sent:${chat}:${vault}:${key}`,
};
/** Web Push keys. A subscription is stored under subId(endpoint), never under the endpoint itself. */
const P = {
  sub: (id: string) => `nox:push:sub:${id}`, // the subscription JSON
  subVaults: (id: string) => `nox:push:subvaults:${id}`, // set of vaults a device watches
  watchers: (vault: string) => `nox:push:watchers:${vault}`, // set of subscription ids watching a vault
  vaults: "nox:push:vaults", // set of all vaults with push watchers
  sent: (id: string, vault: string, key: string) => `nox:push:sent:${id}:${vault}:${key}`,
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
    if ((await this.r.scard(K.watchers(vault))) === 0) {
      await this.r.srem(K.vaults, vault);
      // the snapshot is shared with push subscribers
      if ((await this.r.scard(P.watchers(vault))) === 0) await this.r.del(K.snap(vault));
    }
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

/** Web Push subscribers: devices that turned on "Warn me on this device" for a vault. */
export class PushStore {
  constructor(private r: Redis) {}

  async list(id: string): Promise<string[]> {
    return ((await this.r.smembers(P.subVaults(id))) as string[]).sort();
  }

  async add(id: string, sub: PushSub, vault: string): Promise<void> {
    await Promise.all([this.r.set(P.sub(id), sub), this.r.sadd(P.subVaults(id), vault), this.r.sadd(P.watchers(vault), id), this.r.sadd(P.vaults, vault)]);
  }

  async remove(id: string, vault: string): Promise<boolean> {
    const n = await this.r.srem(P.subVaults(id), vault);
    await this.r.srem(P.watchers(vault), id);
    if ((await this.r.scard(P.watchers(vault))) === 0) {
      await this.r.srem(P.vaults, vault);
      if ((await this.r.scard(K.watchers(vault))) === 0) await this.r.del(K.snap(vault));
    }
    if ((await this.r.scard(P.subVaults(id))) === 0) await this.r.del(P.sub(id));
    return n > 0;
  }

  async vaults(): Promise<string[]> {
    return (await this.r.smembers(P.vaults)) as string[];
  }

  async watchers(vault: string): Promise<string[]> {
    return ((await this.r.smembers(P.watchers(vault))) as unknown[]).map(String);
  }

  async subscription(id: string): Promise<PushSub | null> {
    return (await this.r.get<PushSub>(P.sub(id))) ?? null;
  }

  /** Same contract as AlertStore.claim: true only the first time, so each device gets each alert once. */
  async claim(id: string, vault: string, key: string): Promise<boolean> {
    return (await this.r.set(P.sent(id, vault, key), 1, { nx: true, ex: SENT_TTL_SECS })) === "OK";
  }

  async release(id: string, vault: string, key: string): Promise<void> {
    await this.r.del(P.sent(id, vault, key));
  }

  /** Removes a device entirely (its subscription expired: the push service answered 404 or 410). */
  async drop(id: string): Promise<void> {
    for (const v of await this.list(id)) await this.remove(id, v);
    await this.r.del(P.sub(id));
  }

  /** The browser replaced a subscription (pushsubscriptionchange): move its vaults to the new one. */
  async rotate(oldId: string, newId: string, sub: PushSub): Promise<string[]> {
    const vaults = await this.list(oldId);
    for (const v of vaults) await this.add(newId, sub, v);
    if (oldId !== newId) await this.drop(oldId);
    return vaults;
  }
}
