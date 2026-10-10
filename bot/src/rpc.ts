import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type VersionedTransactionResponse,
} from "@solana/web3.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e);
  return /429|Too Many Requests|rate limit|fetch failed|ECONNRESET|ETIMEDOUT|503|502|504/i.test(msg);
}

/** Retries rate-limit / transient errors with exponential backoff (1s, 2s, 4s, … max 30s). */
export async function withBackoff<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries || !isRetryable(e)) throw e;
      console.warn(`[rpc] ${label}: ${String((e as any)?.message ?? e).slice(0, 120)} — retry in ${delay}ms`);
      await sleep(delay + Math.floor(Math.random() * 250));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

/** Thin read-only RPC wrapper. Spaces calls by `delayMs` so a public RPC isn't hammered. */
export class Rpc {
  readonly conn: Connection;
  private last = 0;

  constructor(url: string, private readonly delayMs = 250) {
    // We do our own 429 handling, so turn off web3.js' built-in retry loop.
    this.conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  }

  private async pace(): Promise<void> {
    const wait = this.last + this.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  async signatures(address: string, opts: { until?: string; limit: number }): Promise<ConfirmedSignatureInfo[]> {
    return withBackoff(async () => {
      await this.pace();
      return this.conn.getSignaturesForAddress(new PublicKey(address), opts, "confirmed");
    }, `getSignaturesForAddress ${address.slice(0, 6)}`);
  }

  async transaction(signature: string): Promise<VersionedTransactionResponse | null> {
    return withBackoff(async () => {
      await this.pace();
      return this.conn.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    }, `getTransaction ${signature.slice(0, 8)}`);
  }
}
