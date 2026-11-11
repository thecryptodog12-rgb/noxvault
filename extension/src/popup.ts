// The extension's app page: the toolbar popup (380×600) and, opened with ?tab=1, the same app in a
// full tab for long flows. Routes, global event delegation and boot. Views live in src/ui/.
import { SESSION_KEY } from "./core/session";
import { watchKey } from "./lib/types";
import { activity, app, expandToTab, go, handler, now, reload, render, send, tick, toast, wipeView } from "./ui/core";
import { bindCreate, onCreateInput, refreshCreateButton } from "./ui/create";
import "./ui/onboard";
import "./ui/settings";
import "./ui/sign";
import { refreshWallet } from "./ui/wallet";
import { visible } from "./ui/vaults";

if (app.tab) document.body.classList.add("tab");

// Views that hold secrets or need the wallet unlocked; they close when it locks.
const NEEDS_UNLOCK = new Set(["create", "account", "ob-password", "ob-scan", "wsend", "wmove", "wimport", "wmanage"]);

document.addEventListener("click", (e) => {
  activity();
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
  if (!el || el.tagName === "FORM") return;
  const name = el.dataset.a!;
  if (name === "expand") return expandToTab(currentHash());
  if (name === "refresh") return void refreshNow();
  const h = handler(name);
  if (h) {
    if (el.tagName === "BUTTON" && (el as HTMLButtonElement).type !== "submit") e.preventDefault();
    void Promise.resolve(h(el, e)).catch((err) => toast(err instanceof Error ? err.message : String(err)));
  }
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  activity();
  const f = e.target as HTMLFormElement;
  const h = f.dataset.a ? handler(f.dataset.a) : undefined;
  if (h) void Promise.resolve(h(f, e)).catch((err) => toast(err instanceof Error ? err.message : String(err)));
});

document.addEventListener("input", (e) => {
  activity();
  const el = e.target as HTMLInputElement;
  if (app.view.name !== "create") return;
  if (el.dataset.bind) bindCreate(el.dataset.bind, el.value);
  if (el.dataset.aInput) onCreateInput(el.dataset.aInput, el.value);
  refreshCreateButton();
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (app.view.name === "create" && el.dataset.bind) {
    bindCreate(el.dataset.bind, el.value);
    // text inputs are already bound on "input"; re-rendering on their blur would eat the next click
    if (el.tagName === "SELECT") render();
  }
});
document.addEventListener("keydown", () => activity());

function currentHash(): string {
  const v = app.view;
  if (v.name === "vault" || v.name === "deposit" || v.name === "fund") return `vault=${encodeURIComponent(v.key)}`;
  if (v.name === "create") return "create";
  return "";
}

async function refreshNow() {
  const btn = document.getElementById("refresh-btn")!;
  btn.classList.add("spin");
  try {
    const v = app.view;
    if (["home", "wallets"].includes(v.name) && !(v.name === "home" && app.homeTab === "vaults")) refreshWallet();
    const only = v.key ? [v.key] : visible().map(watchKey);
    await send({ type: "refresh", only });
    if (v.name === "vault") v.loadedFor = undefined;
    toast("Up to date");
  } finally {
    btn.classList.remove("spin");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[SESSION_KEY]) {
    const unlocked = !!changes[SESSION_KEY].newValue;
    if (app.unlocked && !unlocked) {
      app.unlocked = false;
      if (NEEDS_UNLOCK.has(app.view.name) || (app.view.name === "sign" && app.view.stage !== "done")) {
        const next = app.view.key ? { name: "vault", key: app.view.key } : { name: "home" };
        wipeView(app.view);
        go({ name: "lock", next });
        return;
      }
      render();
    } else if (!app.unlocked && unlocked) {
      app.unlocked = true;
    }
    return;
  }
  if (area !== "local" || !app.data) return;
  let dirty = false;
  for (const k of ["watched", "settings", "status", "accounts", "activeAccount", "keyring", "wallets", "activeWallet"] as const) {
    if (changes[k]) {
      (app.data as Record<string, unknown>)[k] =
        k === "settings" ? { ...app.data.settings, ...changes[k].newValue } : changes[k].newValue ?? (k === "watched" || k === "accounts" || k === "wallets" ? [] : k === "status" ? {} : k === "keyring" ? null : "");
      dirty = true;
    }
  }
  // Do not re-render under the user's cursor while they type in a form.
  if (dirty && ["home", "vault", "wallets"].includes(app.view.name)) render();
});

setInterval(tick, 1000);

(async () => {
  await reload();
  const hash = new URLSearchParams(location.hash.slice(1));
  let target: { name: string; key?: string } = { name: "home" };
  const vk = hash.get("vault");
  if (vk && app.data.watched.some((w) => watchKey(w) === vk)) target = { name: "vault", key: vk };
  if (location.hash === "#create") target = { name: "create-boot" };

  if (!app.data.keyring) go(app.data.watched.length && target.name !== "home" ? target : app.data.wallets.length ? { name: "home" } : { name: "welcome" });
  else if (!app.unlocked) go({ name: "lock", next: target.name === "create-boot" ? { name: "home" } : target });
  else if (target.name === "create-boot") handler("create-start")!(document.body, new Event("boot"));
  else go(target);

  // Refresh what this page shows when the last check is older than 30 s.
  const stale = visible()
    .filter((w) => (app.data.status[watchKey(w)]?.checkedAt ?? 0) < now() - 30)
    .map(watchKey);
  if (stale.length) void send({ type: "refresh", only: stale }).catch(() => {});
})();
