// A minimal in-memory chrome.storage (local + session) for tests. Values are JSON-cloned like the
// real API, so whatever a test finds in `dump()` is exactly what would reach disk / the session.
type Area = Record<string, unknown>;

function area(store: Area) {
  return {
    async get(keys?: string | string[] | null) {
      const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      const out: Area = {};
      for (const k of list) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
      return out;
    },
    async set(items: Area) {
      for (const [k, v] of Object.entries(items)) store[k] = JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
    async clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

export function installChrome() {
  const local: Area = {};
  const session: Area = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: area(local), session: area(session), onChanged: { addListener() {} } },
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}`, getManifest: () => ({ version: "0.2.0" }) },
  };
  return {
    local,
    session,
    /** Everything persisted to disk, as the text that would be written. */
    disk: () => JSON.stringify(local),
    mem: () => JSON.stringify(session),
  };
}
