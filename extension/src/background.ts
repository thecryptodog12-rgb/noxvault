// Service worker: polls every watched vault on a chrome.alarms schedule, stores the snapshots for the
// popup, fires one desktop notification per new event and keeps the red badge in sync.
// It only makes read-only JSON-RPC calls. It never sees a phrase or a key.
import { badgeCount, dedupe, extAlerts } from "./lib/alerts";
import { readSnapshot } from "./lib/chain";
import { SITE, parseAddress, rpcFor, rpcOriginPattern } from "./lib/net";
import { MAX_WATCHED, load, save } from "./lib/store";
import { watchKey, type ExtAlert, type ExtSnapshot, type VaultStatus, type Watched } from "./lib/types";

const ALARM = "nox-poll";
const BAD = "#ff6b7a";

async function ensureAlarm(force = false) {
  const { settings } = await load("settings");
  const period = Math.min(5, Math.max(1, Math.round(settings.intervalMin)));
  const cur = await chrome.alarms.get(ALARM);
  if (force || !cur || cur.periodInMinutes !== period) {
    await chrome.alarms.clear(ALARM);
    await chrome.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: force ? 0.05 : period });
  }
}

const now = () => Math.floor(Date.now() / 1000);

let running: Promise<void> | null = null;
/** Polls all watched vaults (or the ones whose watchKey is in `only`). Runs one at a time. */
function poll(only?: string[]): Promise<void> {
  if (running) return running.then(() => poll(only));
  running = doPoll(only).finally(() => (running = null));
  return running;
}

async function doPoll(only?: string[]) {
  const { watched, settings, status, seen } = await load("watched", "settings", "status", "seen");
  const targets = watched.filter((w) => !only || only.includes(watchKey(w)));
  const alerts: ExtAlert[] = [];

  for (const [i, w] of targets.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 250)); // be gentle with public RPCs (6 reads per vault)
    const k = watchKey(w);
    const prev = status[k]?.snap ?? null;
    const rpc = rpcFor(w.cluster, settings.customRpc);
    let next: VaultStatus;
    try {
      if (w.cluster === "custom") {
        const pattern = rpcOriginPattern(rpc);
        if (!pattern) throw new Error("Set a custom RPC URL in settings.");
        if (!(await chrome.permissions.contains({ origins: [pattern] }))) throw new Error("Allow access to your custom RPC in settings.");
      }
      const snap = await readSnapshot(w.address, w.cluster, rpc);
      next = snap ? { checkedAt: now(), snap } : { checkedAt: now(), snap: null, notFound: true };
      if (snap) alerts.push(...extAlerts(prev, snap, now()));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Keep the last good snapshot so the popup still shows something; flag the error.
      next = { checkedAt: now(), snap: prev, error: /decode|offset|range/i.test(msg) ? "Could not decode this account (older vault version?)" : msg.slice(0, 160) };
    }
    status[k] = next;
    await save({ status }); // progressive: the popup re-renders as each vault lands
  }

  // Drop snapshots of vaults that are no longer watched.
  const { watched: current } = await load("watched"); // the popup may have removed one meanwhile
  const live = new Set(current.map(watchKey));
  for (const k of Object.keys(status)) if (!live.has(k)) delete status[k];

  const { fresh, seen: nextSeen } = dedupe(alerts, seen, now());
  await save({ status, seen: nextSeen });
  if (settings.notify) for (const a of fresh) await notify(a);
  await updateBadge();
}

async function notify(a: ExtAlert) {
  const id = `nox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const { notifUrls } = await load("notifUrls");
  notifUrls[id] = a.url;
  const keys = Object.keys(notifUrls);
  for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete notifUrls[k];
  await save({ notifUrls });
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title: a.title,
    message: a.message,
    contextMessage: a.urgent ? "Noxvault never asks for your phrase in this extension." : "Noxvault · devnet · unaudited",
    priority: a.urgent ? 2 : 0,
    requireInteraction: a.urgent,
  });
}

async function updateBadge() {
  const { watched, status } = await load("watched", "status");
  const snaps = watched.map((w) => status[watchKey(w)]?.snap as ExtSnapshot | null | undefined);
  const n = badgeCount(snaps, now());
  await chrome.action.setBadgeBackgroundColor({ color: BAD });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
  await chrome.action.setTitle({ title: n ? `Noxvault: ${n} alert${n > 1 ? "s" : ""} need attention` : "Noxvault" });
}

// ---------- import from nox-vault.com ----------

/** Runs in the nox-vault.com page. Reads ONLY the names of "nox3.config.<vault>" keys, which
 *  /create writes for vaults made on this browser. It never reads any value, so a phrase the site
 *  may keep in its own storage never reaches the extension. */
function listSiteVaults(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("nox3.config.")) out.push(k.slice("nox3.config.".length));
  }
  return out;
}

async function importFromSite(): Promise<string[]> {
  let tabs = await chrome.tabs.query({ url: ["https://www.nox-vault.com/*", "https://nox-vault.com/*"] });
  let created: number | undefined;
  if (!tabs.length) {
    const t = await chrome.tabs.create({ url: `${SITE}/mine`, active: false });
    created = t.id;
    await new Promise<void>((resolve) => {
      const done = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
        if (id === created && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(() => (chrome.tabs.onUpdated.removeListener(done), resolve()), 15_000);
    });
    tabs = [t];
  }
  const found = new Set<string>();
  try {
    for (const t of tabs) {
      if (t.id == null) continue;
      const res = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: listSiteVaults });
      for (const r of res) for (const v of (r.result as string[] | undefined) ?? []) found.add(v);
    }
  } finally {
    if (created != null) await chrome.tabs.remove(created).catch(() => {});
  }
  return [...found];
}

let importing: Promise<{ found: string[]; added: number }> | null = null;
/** Imports the site's vault list and watches the new ones on devnet (the site's network). */
function importAndAdd() {
  importing ??= (async () => {
    const found = (await importFromSite()).map(parseAddress).filter((a): a is string => !!a);
    const { watched } = await load("watched");
    const have = new Set(watched.map(watchKey));
    const add: Watched[] = found
      .map((address, i) => ({ address, cluster: "devnet" as const, label: `Vault ${watched.length + i + 1}`, addedAt: Math.floor(Date.now() / 1000) }))
      .filter((w) => !have.has(watchKey(w)))
      .slice(0, Math.max(0, MAX_WATCHED - watched.length));
    if (add.length) {
      await save({ watched: [...watched, ...add] });
      void poll(add.map(watchKey));
    }
    return { found, added: add.length };
  })().finally(() => (importing = null));
  return importing;
}

// ---------- wiring ----------

// If Chrome closed the popup while showing the permission prompt, finish the import here.
chrome.permissions.onAdded.addListener((p) => {
  if (p.permissions?.includes("scripting") && p.origins?.some((o) => o.includes("nox-vault.com"))) void importAndAdd();
});

chrome.runtime.onInstalled.addListener(() => void ensureAlarm(true));
chrome.runtime.onStartup.addListener(() => void ensureAlarm());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void poll();
});

chrome.notifications.onClicked.addListener(async (id) => {
  const { notifUrls } = await load("notifUrls");
  await chrome.tabs.create({ url: notifUrls[id] ?? `${SITE}/mine` });
  chrome.notifications.clear(id);
});

export type Msg = { type: "refresh"; only?: string[] } | { type: "settings" } | { type: "import" };

chrome.runtime.onMessage.addListener((msg: Msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "refresh":
        await poll(msg.only);
        return { ok: true };
      case "settings":
        await ensureAlarm(true);
        return { ok: true };
      case "import":
        return { ok: true, ...(await importAndAdd()) };
    }
  })()
    .then(reply)
    .catch((e) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async reply
});

// The worker restarts often; make sure the alarm exists and the badge is current each time.
void ensureAlarm();
void updateBadge();
