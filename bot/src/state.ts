import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Persisted shape. `cursors[address]` is the newest signature already handled.
 * A missing key means "not initialised yet": the next poll only records the latest
 * signature. `null` means "initialised, but the address had no transactions".
 */
export interface StateData {
  version: 1;
  chats: Record<string, string[]>;
  cursors: Record<string, string | null>;
}

export type WatchResult = "added" | "exists" | "limit";

export class StateStore {
  private data: StateData = { version: 1, chats: {}, cursors: {} };
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly maxPerChat = 10) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.data = {
        version: 1,
        chats: raw.chats ?? {},
        cursors: raw.cursors ?? {},
      };
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
  }

  /** Atomic write: temp file in the same dir, then rename. Writes are serialised. */
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, snapshot, "utf8");
        await fs.rename(tmp, this.file);
      });
    return this.writing;
  }

  list(chatId: number | string): string[] {
    return [...(this.data.chats[String(chatId)] ?? [])];
  }

  async watch(chatId: number | string, address: string): Promise<WatchResult> {
    const key = String(chatId);
    const list = this.data.chats[key] ?? [];
    if (list.includes(address)) return "exists";
    if (list.length >= this.maxPerChat) return "limit";
    this.data.chats[key] = [...list, address];
    await this.save();
    return "added";
  }

  async unwatch(chatId: number | string, address: string): Promise<boolean> {
    const key = String(chatId);
    const list = this.data.chats[key] ?? [];
    if (!list.includes(address)) return false;
    const next = list.filter((a) => a !== address);
    if (next.length) this.data.chats[key] = next;
    else delete this.data.chats[key];
    this.dropOrphanCursors();
    await this.save();
    return true;
  }

  /** Remove every watch of a chat (e.g. the bot was blocked or kicked). */
  async removeChat(chatId: number | string): Promise<void> {
    delete this.data.chats[String(chatId)];
    this.dropOrphanCursors();
    await this.save();
  }

  /** All distinct watched addresses. */
  addresses(): string[] {
    return [...new Set(Object.values(this.data.chats).flat())];
  }

  /** Chats that watch `address`. */
  chatsFor(address: string): string[] {
    return Object.entries(this.data.chats)
      .filter(([, list]) => list.includes(address))
      .map(([chat]) => chat);
  }

  isInitialised(address: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data.cursors, address);
  }

  cursor(address: string): string | null | undefined {
    return this.data.cursors[address];
  }

  async setCursor(address: string, signature: string | null): Promise<void> {
    if (!this.addresses().includes(address)) return; // unwatched meanwhile
    this.data.cursors[address] = signature;
    await this.save();
  }

  private dropOrphanCursors(): void {
    const live = new Set(this.addresses());
    for (const a of Object.keys(this.data.cursors)) if (!live.has(a)) delete this.data.cursors[a];
  }

  snapshot(): StateData {
    return JSON.parse(JSON.stringify(this.data));
  }
}
