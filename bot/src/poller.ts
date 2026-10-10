import type { Config } from "./config.js";
import type { Rpc } from "./rpc.js";
import { sleep } from "./rpc.js";
import type { StateStore } from "./state.js";
import { formatMessage, summarize, toTxView } from "./summarize.js";

/** Max new signatures handled per address per cycle; anything older is skipped. */
const PAGE = 25;

export type Notify = (chatId: string, html: string) => Promise<void>;

export class Poller {
  private stopped = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly cfg: Config,
    private readonly rpc: Rpc,
    private readonly state: StateStore,
    private readonly notify: Notify,
  ) {}

  start(): void {
    const loop = async () => {
      if (this.stopped) return;
      const t0 = Date.now();
      try {
        await this.cycle();
      } catch (e) {
        console.error("[poll] cycle failed:", e);
      }
      if (this.stopped) return;
      const wait = Math.max(1000, this.cfg.pollSeconds * 1000 - (Date.now() - t0));
      this.timer = setTimeout(loop, wait);
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One pass over all watched addresses, sequentially. */
  async cycle(): Promise<void> {
    for (const address of this.state.addresses()) {
      if (this.stopped) return;
      try {
        await this.pollAddress(address);
      } catch (e) {
        console.error(`[poll] ${address}:`, (e as any)?.message ?? e);
      }
    }
  }

  async pollAddress(address: string): Promise<void> {
    if (!this.state.isInitialised(address)) {
      // First poll after /watch: only remember where we are, no backfill.
      const [latest] = await this.rpc.signatures(address, { limit: 1 });
      await this.state.setCursor(address, latest?.signature ?? null);
      return;
    }

    const until = this.state.cursor(address) ?? undefined;
    const sigs = await this.rpc.signatures(address, { until, limit: PAGE });
    if (!sigs.length) return;
    if (until && sigs.length === PAGE) {
      console.warn(`[poll] ${address}: ${PAGE}+ new txs, older ones in this burst are skipped`);
    }

    // RPC returns newest first; notify oldest first and advance the cursor as we go.
    for (const info of [...sigs].reverse()) {
      const tx = await this.rpc.transaction(info.signature);
      if (!tx) {
        // Not retrievable yet — stop here and retry next cycle from the same cursor.
        console.warn(`[poll] ${info.signature}: transaction not available yet`);
        return;
      }
      const summary = summarize(toTxView(info.signature, tx), address, this.cfg.programId);
      const html = formatMessage(summary, this.cfg.network);
      for (const chat of this.state.chatsFor(address)) {
        await this.notify(chat, html);
        await sleep(50);
      }
      await this.state.setCursor(address, info.signature);
    }
  }
}
