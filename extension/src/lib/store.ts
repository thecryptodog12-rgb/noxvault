// chrome.storage.local layout. Public data, plus ONE secret in encrypted form: `keyring` (the
// account phrases, AES-256-GCM under a key derived from the user's password; src/core/keyring.ts).
// Never a phrase, master secret or private key in plaintext: those live only in memory and in
// chrome.storage.session while unlocked (src/core/session.ts).
import type { EncryptedKeyring } from "../core/keyring";
import type { PendingAction } from "../../../web/lib/unlock";
import { DEFAULT_SETTINGS, type Settings, type VaultStatus, type Watched } from "./types";

/** Public facts about an account (one phrase). The phrase itself is only inside `keyring`. */
export interface AccountMeta {
  id: string;
  name: string;
  /** 6 hex chars of a domain-separated hash of the master: tells accounts apart, reveals nothing useful. */
  fingerprint: string;
  /** The account's fee account: an ordinary Solana address derived from the phrase (src/core/feeAccount.ts). */
  feeAddress: string;
  createdAt: number;
  /** v0.3: set once this phrase's wallet accounts were set up. Absent on phrases added by v0.2 (their fee account is then listed as a wallet). */
  walletsInit?: boolean;
}

/**
 * v0.3 wallet account: an ordinary ed25519 Solana key (NOT quantum-safe) or a watched address. Public
 * facts only; the key is derived from a phrase in the keyring (derived, legacy-fee) or stored encrypted
 * in the keyring (imported-*). A watch account has no key at all.
 */
export interface WalletMeta {
  id: string;
  name: string;
  address: string;
  kind: "derived" | "legacy-fee" | "imported-phrase" | "imported-key" | "watch";
  /** derived / legacy-fee: the keyring account (phrase) it comes from. */
  phraseId?: string;
  /** derived / imported-phrase: the account index i of m/44'/501'/i'/0'. */
  index?: number;
  createdAt: number;
}

/** Cached token facts per `${cluster}:${mint}` (public data). */
export interface TokenMetaCache {
  name: string;
  symbol: string;
  logo?: string;
  /** unix s */
  at: number;
}

export interface StoreShape {
  watched: Watched[];
  settings: Settings;
  status: Record<string, VaultStatus>;
  /** alert id → unix time first notified */
  seen: Record<string, number>;
  /** notification id → url to open on click */
  notifUrls: Record<string, string>;
  /** The encrypted phrases; null until onboarding. */
  keyring: EncryptedKeyring | null;
  accounts: AccountMeta[];
  /** Account (phrase) whose vaults the UI shows. */
  activeAccount: string;
  /** v0.3 wallet accounts and the selected one. */
  wallets: WalletMeta[];
  activeWallet: string;
  tokenMeta: Record<string, TokenMetaCache>;
  /** Wrong unlock attempts in a row, and until when unlocking is paused (unix s). */
  unlockFails: { count: number; until: number };
  /** The action frozen for a one-time key, per `${vault}.${tree}` (web/lib/unlock.ts PendingAction). Public data. */
  pendingActions: Record<string, PendingAction>;
  /** `${vault}.${tree}.${leaf}` → ms when its first transaction / relay request was sent. */
  attempted: Record<string, number>;
}

const DEFAULTS: StoreShape = {
  watched: [],
  settings: DEFAULT_SETTINGS,
  status: {},
  seen: {},
  notifUrls: {},
  keyring: null,
  accounts: [],
  activeAccount: "",
  wallets: [],
  activeWallet: "",
  tokenMeta: {},
  unlockFails: { count: 0, until: 0 },
  pendingActions: {},
  attempted: {},
};

export async function load<K extends keyof StoreShape>(...keys: K[]): Promise<Pick<StoreShape, K>> {
  const got = (await chrome.storage.local.get(keys)) as Partial<StoreShape>;
  const out = {} as Pick<StoreShape, K>;
  for (const k of keys) {
    const v = got[k];
    out[k] = (k === "settings" ? { ...DEFAULT_SETTINGS, ...(v as Settings | undefined) } : v ?? structuredClone(DEFAULTS[k])) as StoreShape[K];
  }
  return out;
}

export async function save(patch: Partial<StoreShape>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export const MAX_WATCHED = 25;
