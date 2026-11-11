// chrome.storage.local layout. Only public data lives here: vault addresses, labels, settings,
// the last on-chain snapshot per vault, and which alerts were already shown. Never a phrase or key.
import { DEFAULT_SETTINGS, type Settings, type VaultStatus, type Watched } from "./types";

export interface StoreShape {
  watched: Watched[];
  settings: Settings;
  status: Record<string, VaultStatus>;
  /** alert id → unix time first notified */
  seen: Record<string, number>;
  /** notification id → url to open on click */
  notifUrls: Record<string, string>;
}

const DEFAULTS: StoreShape = { watched: [], settings: DEFAULT_SETTINGS, status: {}, seen: {}, notifUrls: {} };

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
