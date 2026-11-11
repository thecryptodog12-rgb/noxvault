// The unlocked state. While unlocked, each account's 32-byte master secret is kept in
// chrome.storage.session: in memory only, never written to disk, cleared when the browser closes,
// readable only by the extension's own pages and service worker (TRUSTED_CONTEXTS, the default).
// Auto-lock: the service worker checks every minute and removes it after `autoLockMin` idle.
// No chrome.* call at import time, so pure helpers are testable.

export const SESSION_KEY = "unlocked";

export interface Unlocked {
  /** accountId → master secret, hex. */
  masters: Record<string, string>;
  /** v0.3: wallet account id → its 32-byte ed25519 seed, hex (derived and imported wallets). */
  wallets?: Record<string, string>;
  /** ms */
  unlockedAt: number;
  /** ms; refreshed by the UI while it is used */
  lastActive: number;
}

/** Whether an unlocked session has been idle too long. */
export function lockDue(u: Pick<Unlocked, "lastActive">, autoLockMin: number, nowMs: number): boolean {
  return nowMs - u.lastActive >= Math.max(1, autoLockMin) * 60_000;
}

export async function readUnlocked(): Promise<Unlocked | null> {
  const got = (await chrome.storage.session.get(SESSION_KEY)) as { [SESSION_KEY]?: Unlocked };
  return got[SESSION_KEY] ?? null;
}

export async function writeUnlocked(masters: Record<string, string>, wallets: Record<string, string> = {}): Promise<void> {
  const t = Date.now();
  await chrome.storage.session.set({ [SESSION_KEY]: { masters, wallets, unlockedAt: t, lastActive: t } satisfies Unlocked });
}

/** Adds / replaces wallet seeds in the unlocked session (no-op while locked). */
export async function putWalletSeeds(add: Record<string, string>): Promise<void> {
  const u = await readUnlocked();
  if (u) await chrome.storage.session.set({ [SESSION_KEY]: { ...u, wallets: { ...(u.wallets ?? {}), ...add }, lastActive: Date.now() } });
}

/** Marks the wallet as in use (resets the auto-lock timer). No-op while locked. */
export async function touch(): Promise<void> {
  const u = await readUnlocked();
  if (u) await chrome.storage.session.set({ [SESSION_KEY]: { ...u, lastActive: Date.now() } });
}

export async function lock(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/**
 * The master secret of an account while unlocked and not idle-expired; null otherwise. Callers
 * should drop their copy (`.fill(0)`) when done.
 */
export async function masterFor(accountId: string, autoLockMin: number): Promise<Uint8Array | null> {
  const u = await readUnlocked();
  if (!u) return null;
  if (lockDue(u, autoLockMin, Date.now())) {
    await lock();
    return null;
  }
  const h = u.masters[accountId];
  return h ? fromHex(h) : null;
}

/** The ed25519 seed of a wallet account while unlocked; null otherwise. Caller zeroes it. */
export async function walletSeedFor(walletId: string, autoLockMin: number): Promise<Uint8Array | null> {
  const u = await readUnlocked();
  if (!u) return null;
  if (lockDue(u, autoLockMin, Date.now())) {
    await lock();
    return null;
  }
  const h = u.wallets?.[walletId];
  return h ? fromHex(h) : null;
}
