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
  /** Account the UI shows. */
  activeAccount: string;
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
