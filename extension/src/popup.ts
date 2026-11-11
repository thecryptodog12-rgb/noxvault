// Popup UI: vault list, vault detail, deposit (QR), add/import, settings. Plain DOM, no framework.
// Reads what the service worker stored; asks it to refresh. Everything signed happens on
// nox-vault.com: the buttons here only open the right page. Never asks for a phrase.
import { fmtTokenAmount } from "./lib/alerts";
import { CLUSTER_LABEL, explorerUrl, parseAddress, rpcOriginPattern, shortAddr, siteLinks } from "./lib/net";
import { qrSvg } from "./lib/qr";
import { ruleLines } from "./lib/rules";
import { clocks, countdown, headline } from "./lib/status";
import { MAX_WATCHED, load, save, type StoreShape } from "./lib/store";
import { watchKey, type ClusterId, type VaultStatus, type Watched } from "./lib/types";

type View = { name: "list" } | { name: "add" } | { name: "settings" } | { name: "detail"; key: string } | { name: "deposit"; key: string };

const $view = document.getElementById("view")!;
const $pill = document.getElementById("net-pill")!;
const $refresh = document.getElementById("refresh-btn")!;
const $toast = document.getElementById("toast")!;

let view: View = { name: "list" };
let data: Pick<StoreShape, "watched" | "settings" | "status"> = { watched: [], settings: { cluster: "devnet", customRpc: "", intervalMin: 2, notify: true }, status: {} };
let confirmRemove = false;
let formError = "";

const now = () => Math.floor(Date.now() / 1000);
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const solNum = (lamports: number) => (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });
const ago = (t: number) => {
  const s = now() - t;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};

function toast(msg: string) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => ($toast.hidden = true), 1600);
}

function open(url: string) {
  void chrome.tabs.create({ url });
}

function send<T = { ok: boolean; error?: string }>(msg: unknown): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

async function refresh(only?: string[]) {
  $refresh.classList.add("spin");
  try {
    await send({ type: "refresh", only });
  } finally {
    $refresh.classList.remove("spin");
  }
}

const visible = () => data.watched.filter((w) => w.cluster === data.settings.cluster);
const findWatched = (key: string) => data.watched.find((w) => watchKey(w) === key);

// ---------- views ----------

const hexSvg = `<svg class="hex" viewBox="0 0 32 32" fill="none"><path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25L16 2.5Z" stroke="#2ee6d6" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 8.5 22.5 16 16 23.5 9.5 16 16 8.5Z" stroke="#2ee6d6" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

function chipFor(st: VaultStatus | undefined): string {
  if (!st) return `<span class="chip dim">CHECKING…</span>`;
  if (st.notFound) return `<span class="chip dim">NOT A VAULT HERE</span>`;
  if (!st.snap) return `<span class="chip dim">RPC ERROR</span>`;
  const h = headline(st.snap, now());
  return `<span class="chip ${h.tone === "ok" ? "" : h.tone}">${esc(h.label)}</span>`;
}

function listView(): string {
  const ws = visible();
  if (!ws.length) {
    return `<div class="empty">${hexSvg}<h2>Watch a vault</h2><p>Add a vault address to see its balance, rules and any pending withdrawal, and get an alert the moment money tries to leave.</p>
      <div class="stack"><button class="btn primary block" data-act="add">+ Add vault address</button>
      <button class="btn block" data-act="import">Import from nox-vault.com</button>
      <button class="btn ghost block" data-open="${esc(siteLinks("").create)}">No vault yet? Create one on nox-vault.com ↗</button></div></div>`;
  }
  let total = 0;
  let urgent = 0;
  const cards = ws
    .map((w) => {
      const k = watchKey(w);
      const st = data.status[k];
      const s = st?.snap;
      if (s) total += s.lamports;
      const h = s ? headline(s, now()) : null;
      if (h && h.tone === "bad") urgent++;
      else if (h && s?.pending) urgent++;
      const p = s?.pending;
      const line2 = s
        ? p
          ? `<span class="${h!.tone}">${esc(h!.detail.split(",")[0])}</span><span class="dim">·</span><span class="tick ${h!.tone}" data-at="${p.executableAt}"></span>`
          : s.lockdownUntil > now()
            ? `<span class="bad">locked</span><span class="dim">·</span><span class="tick bad" data-at="${s.lockdownUntil}"></span>`
            : `<span class="dim">${s.tokens.length ? `${s.tokens.length} token${s.tokens.length > 1 ? "s" : ""} · ` : ""}checked ${esc(ago(st!.checkedAt))}</span>`
        : `<span class="dim">${st?.error ? esc(st.error) : st?.notFound ? "no Noxvault state on this network" : "reading chain…"}</span>`;
      return `<button class="card ${h ? `t-${h.tone}` : ""}" data-detail="${esc(k)}">
        <div class="row between"><div><div class="name">${esc(w.label || "Vault")}</div><div class="addr">${esc(shortAddr(w.address))}</div></div>
        <div style="text-align:right"><div class="bal">${s ? esc(solNum(s.lamports)) : "—"} <span class="dim" style="font-weight:400;font-size:11px">SOL</span></div>${chipFor(st)}</div></div>
        <div class="line2">${line2}</div></button>`;
    })
    .join("");
  const banner = urgent
    ? `<div class="alert bad" style="margin-bottom:10px"><div class="t">⚠ ${urgent} VAULT${urgent > 1 ? "S" : ""} NEED${urgent > 1 ? "" : "S"} ATTENTION</div><p style="margin:4px 0 0">Money is trying to leave or a vault is locked. Open it to see what and how long you have.</p></div>`
    : "";
  return `${banner}<div class="total"><div class="lbl">Watched · ${esc(CLUSTER_LABEL[data.settings.cluster])}</div><div class="num">${esc(solNum(total))}<small>SOL</small></div></div>
    <div class="h">Vaults <span class="grow"></span><span>${ws.length}</span></div>${cards}
    <div class="grid2" style="margin-top:10px"><button class="btn" data-act="add">+ Add vault</button><button class="btn" data-act="import">Import from site</button></div>`;
}

function detailView(key: string): string {
  const w = findWatched(key);
  if (!w) return listView();
  const st = data.status[key];
  const s = st?.snap;
  const links = siteLinks(w.address);
  const head = `<button class="btn ghost back" data-act="home">← Vaults</button>`;
  const actions = `<div class="grid2">
      <button class="btn primary" data-deposit="${esc(key)}">Deposit</button>
      <button class="btn" data-open="${esc(links.owner)}">Withdraw ↗</button>
      <button class="btn" data-open="${esc(links.view)}">Public page ↗</button>
      <button class="btn" data-open="${esc(explorerUrl(w.address, w.cluster, data.settings.customRpc))}">Explorer ↗</button>
    </div>
    <div class="note" style="margin-top:8px">Withdrawing and cancelling are signed on nox-vault.com with your phrase. This extension only watches.</div>`;
  if (!s) {
    return `${head}<div class="hero"><div class="name">${esc(w.label || "Vault")}</div><div class="mono-addr">${esc(w.address)}</div></div>
      <div class="panel">${st?.notFound ? "No Noxvault state at this address on this network." : st?.error ? `<span class="bad">${esc(st.error)}</span>` : "Reading chain…"}</div>
      <div style="margin-top:10px">${actions}</div>${removeBlock(key)}`;
  }
  const t = now();
  const h = headline(s, t);
  let alert = "";
  if (s.lockdownUntil > t) {
    alert = `<div class="alert bad"><div class="t">🚨 LOCKDOWN</div><div class="big tick" data-at="${s.lockdownUntil}"></div>
      <p>The duress phrase was used. Withdrawals are refused until the lockdown ends. Only the recovery key can end it early: check on the owner first.</p>
      <button class="btn danger block" data-open="${esc(links.recovery)}">Open recovery on nox-vault.com ↗</button></div>`;
  }
  if (s.pending) {
    const p = s.pending;
    const amt = p.kind === "migrate" ? "All funds" : fmtTokenAmount(p.mint, p.amount, s.tokens);
    alert += `<div class="alert ${p.executableAt <= t ? "bad" : "warnc"}" ${alert ? 'style="margin-top:8px"' : ""}>
      <div class="t">⚠ ${p.kind === "migrate" ? "PENDING MIGRATION" : "PENDING WITHDRAWAL"}</div>
      <div class="big">${esc(amt)}</div>
      <div class="muted" style="font-size:11px">to <span class="mono-addr">${esc(p.dest)}</span></div>
      <dl class="kv" style="margin:8px 0 0"><dt>Executes in</dt><dd class="tick ${p.executableAt <= t ? "bad" : "warn"}" data-at="${p.executableAt}"></dd></dl>
      <p>Not you? Cancel it before then with your recovery phrase (or owner phrase) on nox-vault.com.</p>
      <div class="grid2"><button class="btn danger" data-open="${esc(links.recovery)}">Cancel: recovery ↗</button><button class="btn warnb" data-open="${esc(links.owner)}">I'm the owner ↗</button></div></div>`;
  }
  const tokens = s.tokens.length
    ? `<div class="h">Tokens <span class="grow"></span></div><div class="panel tokens">${s.tokens
        .map((x) => `<div class="row between"><span class="muted">${esc(shortAddr(x.mint))}</span><span>${esc(x.ui)}</span></div>`)
        .join("")}</div>`
    : "";
  const cl = clocks(s, t);
  const clockPanel = cl.length
    ? `<div class="h">Clocks <span class="grow"></span></div><div class="panel"><dl class="kv">${cl
        .map((c) => `<dt>${esc(c.label)}</dt><dd><span class="tick ${c.tone === "dim" ? "" : c.tone}" data-at="${c.at}"></span><br><span class="dim" style="font-size:10px">${esc(c.text)}</span></dd>`)
        .join("")}</dl></div>`
    : "";
  const rules = `<div class="h">Rules <span class="grow"></span></div><div class="panel"><dl class="kv">${ruleLines(s.rules)
    .map((r) => `<dt>${esc(r.label)}</dt><dd class="${r.tone === "dim" ? "" : r.tone}">${esc(r.value)}</dd>`)
    .join("")}</dl></div>`;
  return `${head}<div class="hero"><div class="name">${esc(w.label || "Vault")}</div><div class="mono-addr">${esc(w.address)}</div>
      <div class="bal" style="margin-top:6px">${esc(solNum(s.lamports))}<small>SOL</small></div>
      <div style="margin-top:4px"><span class="chip ${h.tone === "ok" ? "" : h.tone}">${esc(h.label)}</span></div>
      <div class="dim" style="font-size:10.5px;margin-top:6px">${esc(CLUSTER_LABEL[w.cluster])} · checked ${esc(ago(st!.checkedAt))}${st?.error ? ` · <span class="bad">${esc(st.error)}</span>` : ""}</div></div>
    ${alert}
    <div style="margin-top:${alert ? 10 : 0}px">${actions}</div>
    ${tokens}${clockPanel}${rules}${removeBlock(key)}`;
}

function removeBlock(key: string): string {
  return `<div style="margin-top:14px;text-align:center"><button class="btn ghost" data-remove="${esc(key)}">${confirmRemove ? "Click again to stop watching" : "Stop watching this vault"}</button></div>`;
}

function depositView(key: string): string {
  const w = findWatched(key);
  if (!w) return listView();
  const links = siteLinks(w.address);
  return `<button class="btn ghost back" data-detail="${esc(key)}">← ${esc(w.label || shortAddr(w.address))}</button>
    <div class="h">Deposit to vault <span class="grow"></span></div>
    <div class="qr">${qrSvg(w.address)}</div>
    <div class="copybox"><code>${esc(w.address)}</code><button class="btn" data-copy="${esc(w.address)}">Copy</button></div>
    <div class="stack" style="margin-top:10px">
      <div class="note ${w.cluster === "mainnet-beta" ? "warn" : ""}">Send SOL or tokens to this address on <b>${esc(CLUSTER_LABEL[w.cluster])}</b>. Anyone can deposit; nothing needs signing by the vault. Noxvault runs on devnet and is unaudited: do not send funds you cannot lose.</div>
      <button class="btn block" data-open="${esc(links.fund)}">Deposit with a wallet on nox-vault.com ↗</button>
    </div>`;
}

function addView(): string {
  return `<button class="btn ghost back" data-act="home">← Vaults</button>
    <div class="h">Add a vault <span class="grow"></span></div>
    <form id="add-form" class="panel stack" autocomplete="off">
      <label class="field"><span>Vault address</span><input type="text" name="address" placeholder="e.g. B9fC…9Fty" spellcheck="false" required /></label>
      <label class="field"><span>Label (optional)</span><input type="text" name="label" maxlength="24" placeholder="Savings" /></label>
      <div class="dim" style="font-size:10.5px">Network: ${esc(CLUSTER_LABEL[data.settings.cluster])} (change in settings)</div>
      ${formError ? `<div class="err">${esc(formError)}</div>` : ""}
      <button class="btn primary block" type="submit">Watch vault</button>
    </form>
    <div class="h">Or <span class="grow"></span></div>
    <div class="panel stack">
      <button class="btn block" data-act="import">Import from nox-vault.com</button>
      <div class="note">Finds vaults you created on nox-vault.com in this browser. Chrome asks once for access to nox-vault.com; the extension reads only the vault addresses the site saved, never anything else.</div>
    </div>
    <div class="note warn" style="margin-top:10px">Only the public address goes here. Noxvault never asks for your phrase in this extension. If something asks for it here, it is not us.</div>`;
}

function settingsView(): string {
  const s = data.settings;
  const segs = (["devnet", "mainnet-beta", "custom"] as ClusterId[])
    .map((c) => `<button type="button" class="${s.cluster === c ? "on" : ""}" data-cluster="${c}">${esc(CLUSTER_LABEL[c])}</button>`)
    .join("");
  const ints = [1, 2, 5].map((m) => `<button type="button" class="${s.intervalMin === m ? "on" : ""}" data-interval="${m}">${m} min</button>`).join("");
  return `<button class="btn ghost back" data-act="home">← Vaults</button>
    <div class="h">Network <span class="grow"></span></div>
    <div class="panel stack">
      <div class="seg">${segs}</div>
      ${s.cluster === "mainnet-beta" ? `<div class="note warn">The Noxvault program is deployed on devnet only. Mainnet addresses will show as "not a vault" until a mainnet launch.</div>` : ""}
      ${
        s.cluster === "custom"
          ? `<form id="rpc-form" class="stack"><label class="field"><span>Custom RPC URL (https)</span><input type="url" name="rpc" value="${esc(s.customRpc)}" placeholder="https://devnet.helius-rpc.com/?api-key=…" spellcheck="false" /></label>
             ${formError ? `<div class="err">${esc(formError)}</div>` : ""}<button class="btn block" type="submit">Save &amp; allow this RPC</button>
             <div class="dim" style="font-size:10.5px">Chrome asks for access to that one host. Vaults added under "custom RPC" are read through it.</div></form>`
          : ""
      }
    </div>
    <div class="h">Alerts <span class="grow"></span></div>
    <div class="panel stack">
      <label class="switch"><span>Desktop notifications</span><input type="checkbox" id="notify" ${s.notify ? "checked" : ""} /></label>
      <div><div class="dim" style="font-size:10.5px;margin-bottom:4px">CHECK EVERY</div><div class="seg">${ints}</div></div>
      <div class="note">You get one notification per event: a new pending withdrawal or migration, a lockdown, an inactivity clock under 14, 3 or 1 days, a sealed letter opening within a week. The badge counts what still needs attention.</div>
    </div>
    <div class="h">Privacy <span class="grow"></span></div>
    <div class="panel stack muted" style="font-size:11px">
      <div>Watch-only. The extension stores vault addresses and labels in this browser and reads public data from the Solana RPC you pick. No accounts, no analytics, no servers of ours.</div>
      <div class="ok">Noxvault never asks for your phrase here.</div>
      <div class="dim">Noxvault · devnet · unaudited · v${esc(chrome.runtime.getManifest().version)}</div>
    </div>`;
}

function render() {
  if (view.name !== "detail") confirmRemove = false;
  const c = data.settings.cluster;
  $pill.textContent = `${c === "mainnet-beta" ? "mainnet" : c === "custom" ? "custom" : "devnet"} · unaudited`;
  switch (view.name) {
    case "list":
      $view.innerHTML = listView();
      break;
    case "detail":
      $view.innerHTML = detailView(view.key);
      break;
    case "deposit":
      $view.innerHTML = depositView(view.key);
      break;
    case "add":
      $view.innerHTML = addView();
      ($view.querySelector('input[name="address"]') as HTMLInputElement | null)?.focus();
      break;
    case "settings":
      $view.innerHTML = settingsView();
      break;
  }
  tick();
}

function tick() {
  const t = now();
  for (const el of $view.querySelectorAll<HTMLElement>("[data-at]")) el.textContent = countdown(Number(el.dataset.at) - t);
}

function go(v: View) {
  view = v;
  formError = "";
  $view.scrollTop = 0;
  render();
}

// ---------- actions ----------

async function addVault(address: string, label: string) {
  const a = parseAddress(address);
  if (!a) return void ((formError = "That is not a Solana address."), render());
  if (address.trim().split(/\s+/).length >= 12) return void ((formError = "That looks like a phrase. Never paste it here."), render());
  const { watched, settings } = await load("watched", "settings");
  const w: Watched = { address: a, cluster: settings.cluster, label: label.trim().slice(0, 24), addedAt: now() };
  if (watched.some((x) => watchKey(x) === watchKey(w))) return void ((formError = "Already watching that vault."), render());
  if (watched.length >= MAX_WATCHED) return void ((formError = `You can watch up to ${MAX_WATCHED} vaults.`), render());
  await save({ watched: [...watched, w] });
  data.watched = [...watched, w];
  go({ name: "detail", key: watchKey(w) });
  void refresh([watchKey(w)]);
}

function importFromSite() {
  // Must be called straight from the click (user gesture). If Chrome closes the popup for the
  // permission prompt, the service worker finishes the import on permissions.onAdded.
  chrome.permissions
    .request({ permissions: ["scripting"], origins: ["https://www.nox-vault.com/*", "https://nox-vault.com/*"] })
    .then(async (ok) => {
      if (!ok) return toast("Permission not granted");
      toast("Looking on nox-vault.com…");
      const r = await send<{ ok: boolean; found?: string[]; added?: number; error?: string }>({ type: "import" });
      if (!r.ok) return toast(r.error ?? "Import failed");
      toast(r.found?.length ? `Found ${r.found.length}, added ${r.added ?? 0}` : "No vaults saved on nox-vault.com in this browser");
      if (r.added) {
        if (data.settings.cluster !== "devnet") {
          data.settings = { ...data.settings, cluster: "devnet" };
          await save({ settings: data.settings });
        }
        go({ name: "list" });
      }
    })
    .catch((e) => toast(String(e?.message ?? e)));
}

async function setSettings(patch: Partial<StoreShape["settings"]>) {
  data.settings = { ...data.settings, ...patch };
  await save({ settings: data.settings });
  await send({ type: "settings" });
  render();
}

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act],[data-detail],[data-deposit],[data-open],[data-copy],[data-remove],[data-cluster],[data-interval]");
  if (!el) return;
  const d = el.dataset;
  if (d.open) return open(d.open);
  if (d.detail) return go({ name: "detail", key: d.detail });
  if (d.deposit) return go({ name: "deposit", key: d.deposit });
  if (d.copy) {
    void navigator.clipboard.writeText(d.copy).then(() => toast("Address copied"));
    return;
  }
  if (d.remove) {
    if (!confirmRemove) {
      confirmRemove = true;
      return render();
    }
    const key = d.remove;
    data.watched = data.watched.filter((w) => watchKey(w) !== key);
    delete data.status[key];
    void save({ watched: data.watched, status: data.status }).then(() => send({ type: "refresh", only: [] }));
    return go({ name: "list" });
  }
  if (d.cluster) return void setSettings({ cluster: d.cluster as ClusterId });
  if (d.interval) return void setSettings({ intervalMin: Number(d.interval) });
  switch (d.act) {
    case "home":
      return go({ name: "list" });
    case "add":
      return go({ name: "add" });
    case "settings":
      return go({ name: "settings" });
    case "import":
      return importFromSite();
    case "refresh": {
      const only = view.name === "detail" || view.name === "deposit" ? [view.key] : visible().map(watchKey);
      void refresh(only).then(() => toast("Up to date"));
      return;
    }
  }
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const fd = new FormData(f);
  if (f.id === "add-form") return void addVault(String(fd.get("address") ?? ""), String(fd.get("label") ?? ""));
  if (f.id === "rpc-form") {
    const url = String(fd.get("rpc") ?? "").trim();
    const pattern = rpcOriginPattern(url);
    if (!pattern) {
      formError = "Use an https:// RPC URL.";
      return render();
    }
    // Save first (no await) so the setting survives if the permission prompt closes the popup.
    data.settings = { ...data.settings, customRpc: url };
    void save({ settings: data.settings });
    chrome.permissions
      .request({ origins: [pattern] })
      .then(async (ok) => {
        formError = ok ? "" : "Chrome did not grant access to that host.";
        await send({ type: "settings" });
        if (ok) toast("RPC saved");
        render();
      })
      .catch((err) => ((formError = String(err?.message ?? err)), render()));
  }
});

document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "notify") void setSettings({ notify: t.checked });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let dirty = false;
  for (const k of ["watched", "settings", "status"] as const) {
    if (changes[k]) {
      (data as Record<string, unknown>)[k] = k === "settings" ? { ...data.settings, ...changes[k].newValue } : changes[k].newValue ?? (k === "watched" ? [] : {});
      dirty = true;
    }
  }
  // Do not re-render under the user's cursor while they type in a form.
  if (dirty && (view.name === "list" || view.name === "detail")) render();
});

setInterval(tick, 1000);

(async () => {
  data = await load("watched", "settings", "status");
  render();
  // Refresh what this popup shows when the last check is older than 30 s.
  const stale = visible().filter((w) => (data.status[watchKey(w)]?.checkedAt ?? 0) < now() - 30).map(watchKey);
  if (stale.length) void refresh(stale);
})();

