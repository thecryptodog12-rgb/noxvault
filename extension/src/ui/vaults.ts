// Home (vault list), vault detail, deposit, add a watched address, rename / remove / export.
// The list and detail come from v0.1 (src/popup.ts of 0.1.0) and read what the service worker stored.
import { PublicKey } from "@solana/web3.js";
import { RECOVERY_TREE, fetchState, keysLeft, treeOf, vaultApprovals, type ApprovalView } from "../../../sdk/client";
import { describeAction } from "../../../web/lib/unlock";
import { fmtTokenAmount } from "../lib/alerts";
import { CLUSTER_LABEL, explorerUrl, parseAddress, shortAddr, siteLinks } from "../lib/net";
import { qrSvg } from "../lib/qr";
import { ruleLines } from "../lib/rules";
import { clocks, headline } from "../lib/status";
import { MAX_WATCHED, load, save } from "../lib/store";
import { watchKey, type VaultStatus, type Watched } from "../lib/types";
import { configToJson } from "../../../web/lib/configJson";
import { executePending, recentActivity, type Activity } from "../core/vaults";
import { activeAccount, ago, app, back, connFor, defineView, errText, esc, feeAccountOf, findVault, go, now, on, openUrl, programFor, render, send, solNum, toast, txUrl } from "./core";

const hexSvg = `<svg class="hex" viewBox="0 0 32 32" fill="none"><path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25L16 2.5Z" stroke="#2ee6d6" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 8.5 22.5 16 16 23.5 9.5 16 16 8.5Z" stroke="#2ee6d6" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

const ROLE_LABEL: Record<string, string> = { owner: "OWNER", cosigner: "CO-SIGNER", duress: "DURESS", watch: "WATCH" };

/** Vaults shown for the current network: the active account's own vaults, then watched addresses. */
export function visible(): Watched[] {
  const acct = activeAccount()?.id;
  return app.data.watched.filter((w) => w.cluster === app.data.settings.cluster && (!w.accountId || w.accountId === acct));
}

function chipFor(w: Watched, st: VaultStatus | undefined): string {
  if (!st) return `<span class="chip dim">CHECKING…</span>`;
  if (st.notFound) return w.config ? `<span class="chip warn">NOT INITIALIZED</span>` : `<span class="chip dim">NOT A VAULT HERE</span>`;
  if (!st.snap) return `<span class="chip dim">RPC ERROR</span>`;
  const h = headline(st.snap, now());
  return `<span class="chip ${h.tone === "ok" ? "" : h.tone}">${esc(h.label)}</span>`;
}

// ---------- home ----------

/** The Vaults tab of the home screen (and the whole home screen in watch-only mode). */
export function vaultsTab(opts: { banners?: boolean } = {}): string {
  const ws = visible();
  const acct = activeAccount();
  const accounts = app.data.accounts;
  const switcher =
    accounts.length > 1
      ? `<div class="seg acct">${accounts.map((a) => `<button class="${a.id === acct?.id ? "on" : ""}" data-a="acct-switch" data-arg="${esc(a.id)}">${esc(a.name)}</button>`).join("")}</div>`
      : "";
  const lockedBanner =
    opts.banners && app.data.keyring && !app.unlocked ?`<button class="alert warnc block-btn" data-a="go-lock"><div class="t">🔒 LOCKED</div><p style="margin:2px 0 0">Unlock to send, cancel or create. Alerts keep running.</p></button>` : "";
  const noWallet = opts.banners && !app.data.keyring
    ? `<div class="note warn" style="margin-bottom:10px">Watch-only. <button class="link" data-a="ob-welcome">Set up a wallet</button> to send and cancel from here.</div>`
    : "";
  const devnote = `<div class="netnote"><span class="chip warn">DEVNET · UNAUDITED</span><span class="dim small">Vaults are not live on mainnet yet.</span></div>`;
  if (!ws.length) {
    return `${switcher}${lockedBanner}${noWallet}${devnote}<div class="empty">${hexSvg}<h2>No vault yet</h2>
      <p>A vault is quantum-safe: no ed25519 key can move its funds. Its rules (delay, whitelist, recovery key) are fixed in its address forever.</p>
      <div class="stack"><button class="btn primary block" data-a="create-start">+ Create a vault</button>
      <button class="btn block" data-a="add">Watch an address</button>
      <button class="btn ghost block" data-a="import">Import watched vaults from nox-vault.com</button></div></div>`;
  }
  let total = 0;
  let urgent = 0;
  const cards = ws
    .map((w) => {
      const k = watchKey(w);
      const st = app.data.status[k];
      const s = st?.snap;
      if (s) total += s.lamports;
      const h = s ? headline(s, now()) : null;
      if (h && (h.tone === "bad" || s?.pending)) urgent++;
      const p = s?.pending;
      const low = s && w.role && w.role !== "watch" && s.rules.keysTotal && s.rules.keysLeft < 20;
      const line2 = s
        ? p
          ? `<span class="${h!.tone}">${esc(h!.detail.split(",")[0])}</span><span class="dim">·</span><span class="tick ${h!.tone}" data-at="${p.executableAt}"></span>`
          : s.lockdownUntil > now()
            ? `<span class="bad">locked</span><span class="dim">·</span><span class="tick bad" data-at="${s.lockdownUntil}"></span>`
            : `<span class="dim">${s.tokens.length ? `${s.tokens.length} token${s.tokens.length > 1 ? "s" : ""} · ` : ""}${low ? `<span class="warn">${s.rules.keysLeft} keys left</span> · ` : ""}checked ${esc(ago(st!.checkedAt))}</span>`
        : `<span class="dim">${st?.error ? esc(st.error) : st?.notFound ? (w.config ? "fund and initialize it" : "no Noxvault state on this network") : "reading chain…"}</span>`;
      return `<button class="card ${h ? `t-${h.tone}` : ""}" data-a="detail" data-arg="${esc(k)}">
        <div class="row between"><div><div class="name">${esc(w.label || "Vault")} <span class="role">${esc(ROLE_LABEL[w.role ?? "watch"])}</span></div><div class="addr">${esc(shortAddr(w.address))}</div></div>
        <div style="text-align:right"><div class="bal">${s ? esc(solNum(s.lamports)) : "—"} <span class="dim" style="font-weight:400;font-size:11px">SOL</span></div>${chipFor(w, st)}</div></div>
        <div class="line2">${line2}</div></button>`;
    })
    .join("");
  const banner = urgent
    ? `<div class="alert bad" style="margin-bottom:10px"><div class="t">⚠ ${urgent} VAULT${urgent > 1 ? "S" : ""} NEED${urgent > 1 ? "" : "S"} ATTENTION</div><p style="margin:4px 0 0">Money is trying to leave or a vault is locked. Open it to see what and how long you have.</p></div>`
    : "";
  const head = opts.banners
    ? `<div class="total"><div class="lbl">${esc(acct?.name ?? "Watched")} · ${esc(CLUSTER_LABEL[app.data.settings.cluster])}</div><div class="num">${esc(solNum(total))}<small>SOL</small></div></div>`
    : devnote;
  return `${switcher}${lockedBanner}${noWallet}${banner}${head}
    <div class="h">Vaults <span class="grow"></span><span>${esc(solNum(total))} SOL · ${ws.length}</span></div>${cards}
    <div class="grid2" style="margin-top:10px"><button class="btn primary" data-a="create-start">+ Create vault</button><button class="btn" data-a="add">Watch address</button></div>`;
}

on({
  home: () => go({ name: "home" }),
  "go-lock": () => go({ name: "lock", next: { name: "home" } }),
  "acct-switch": async (el) => {
    await save({ activeAccount: el.dataset.arg! });
    app.data.activeAccount = el.dataset.arg!;
    render();
  },
  detail: (el) => ((app.homeTab = "vaults"), go({ name: "vault", key: el.dataset.arg })),
  add: () => go({ name: "add" }),
  import: () => importFromSite(),
  "open-tx": (el) => openUrl(txUrl(el.dataset.arg!, (el.dataset.cluster as Watched["cluster"]) ?? "devnet", app.data.settings.customRpc)),
  open: (el) => openUrl(el.dataset.arg!),
  copy: (el) => void navigator.clipboard.writeText(el.dataset.arg!).then(() => toast("Copied")),
});

// ---------- vault detail ----------

interface DetailExtra {
  activity?: Activity[] | null;
  approvals?: ApprovalView[] | null;
  keys?: { left: number; total: number } | null;
  loading?: boolean;
}

defineView(
  "vault",
  () => {
    const v = app.view;
    const w = findVault(v.key);
    if (!w) return `${back("Vaults", "home")}<div class="panel">This vault is no longer in the list.</div>`;
    const st = app.data.status[v.key];
    const s = st?.snap;
    const links = siteLinks(w.address);
    const owned = !!w.accountId;
    const head = back("Vaults", "home");
    const x = v as unknown as DetailExtra;
    const t = now();
    const actions = `<div class="grid3">
        <button class="btn primary" data-a="send-start" data-arg="${esc(v.key)}" ${owned && s ? "" : "disabled"} title="${owned ? "" : "Watch-only: no phrase of yours signs for this vault"}">↑ Send</button>
        <button class="btn" data-a="deposit" data-arg="${esc(v.key)}">↓ Deposit</button>
        <button class="btn" data-a="more" data-arg="${esc(v.key)}">⋯ More</button>
      </div>
      ${app.data.keyring && w.cluster !== "mainnet-beta" ? `<button class="btn block" style="margin-top:8px" data-a="wmove-start" data-arg="${esc(v.key)}">↓ Deposit from wallet</button>` : ""}`;
    const more = v.more
      ? `<div class="panel stack" style="margin-top:8px">
          <form class="row" data-a="rename" autocomplete="off"><input type="text" name="label" maxlength="24" value="${esc(w.label)}"/><button class="btn" type="submit">Rename</button></form>
          <div class="grid2">
            <button class="btn" data-a="export-config" data-arg="${esc(v.key)}" ${w.config || s ? "" : "disabled"}>Export config</button>
            <button class="btn" data-a="open" data-arg="${esc(explorerUrl(w.address, w.cluster, app.data.settings.customRpc))}">Explorer ↗</button>
            <button class="btn" data-a="open" data-arg="${esc(links.view)}">Public page ↗</button>
            <button class="btn" data-a="open" data-arg="${esc(links.owner)}">Schedules, staking ↗</button>
          </div>
          <button class="btn ghost block" data-a="remove" data-arg="${esc(v.key)}">${v.confirmRemove ? "Click again to remove from this list" : "Remove from this list"}</button>
          <div class="dim small">Removing only forgets it here. ${owned ? "Your phrase still finds it (Settings → Find my vaults)." : ""}</div>
        </div>`
      : "";
    const roleLine = `<span class="role">${esc(ROLE_LABEL[w.role ?? "watch"])}</span>${w.vaultNumber != null ? ` <span class="dim small">· vault #${w.vaultNumber}</span>` : ""}`;
    if (!s) {
      const uninit = st?.notFound && w.config;
      return `${head}<div class="hero"><div class="name">${esc(w.label || "Vault")} ${roleLine}</div><div class="mono-addr">${esc(w.address)}</div></div>
        ${
          uninit
            ? `<div class="alert warnc"><div class="t">NOT INITIALIZED YET</div><p>Fund the address, then initialize it. Until then nothing can be signed.</p><button class="btn primary block" data-a="fund-open" data-arg="${esc(v.key)}">Fund &amp; initialize</button></div>`
            : `<div class="panel">${st?.notFound ? "No Noxvault state at this address on this network." : st?.error ? `<span class="bad">${esc(st.error)}</span>` : "Reading chain…"}</div>`
        }
        <div style="margin-top:10px">${actions}</div>${more}`;
    }
    const h = headline(s, t);
    let alert = "";
    if (s.lockdownUntil > t) {
      alert = `<div class="alert bad"><div class="t">🚨 LOCKDOWN</div><div class="big tick" data-at="${s.lockdownUntil}"></div>
        <dl class="kv" style="margin:6px 0 0"><dt>Frozen until</dt><dd>${esc(new Date(s.lockdownUntil * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}</dd></dl>
        <p>Either the duress phrase was used, or the recovery phrase cancelled a payout and froze the vault. Until it ends the main phrase alone can only Ping or cancel: nothing can be withdrawn with it, and its Pings do not count as activity. Only the recovery key can end it early: check on the owner first.</p>
        <p class="dim small">Main phrase stolen? Escape: on nox-vault.com sign a migration to a fresh vault with the main phrase and co-sign it with the recovery phrase; together they move everything at once.</p>
        ${s.rules.recoveryDelay != null ? `<button class="btn danger block" data-a="cancel-start" data-plain="1" data-arg="${esc(v.key)}">End lockdown with the recovery phrase</button>` : ""}</div>`;
    }
    if (s.pending) {
      const p = s.pending;
      const amt = p.kind === "migrate" ? "All funds" : fmtTokenAmount(p.mint, p.amount, s.tokens);
      const due = p.executableAt <= t;
      alert += `<div class="alert ${due ? "bad" : "warnc"}" ${alert ? 'style="margin-top:8px"' : ""}>
        <div class="t">⚠ ${p.kind === "migrate" ? "PENDING MIGRATION" : "PENDING WITHDRAWAL"}</div>
        <div class="big">${esc(amt)}</div>
        <div class="muted" style="font-size:11px">to <span class="mono-addr">${esc(p.dest)}</span></div>
        <dl class="kv" style="margin:8px 0 0"><dt>Executes in</dt><dd class="tick ${due ? "bad" : "warn"}" data-at="${p.executableAt}"></dd></dl>
        <p>${due ? "It can be executed now by anyone. Not you? Cancel it first." : "Not you? Cancel it before then with your recovery phrase (or your owner phrase)."}</p>
        <div class="grid2"><button class="btn danger" data-a="cancel-start" data-arg="${esc(v.key)}">Cancel it</button>${
          due ? `<button class="btn warnb" data-a="exec-pending" data-arg="${esc(v.key)}" ${v.busy ? "disabled" : ""}>${v.busy === "exec" ? "Executing…" : "Execute now"}</button>` : `<button class="btn" disabled>Executes when due</button>`
        }</div>
        ${v.execMsg ? `<div class="${v.execMsg.ok ? "ok" : "err"} small" style="margin-top:6px">${esc(v.execMsg.text)}</div>` : ""}</div>`;
    }
    const keys = x.keys ?? (owned ? null : { left: s.rules.keysLeft, total: s.rules.keysTotal });
    const keyWarn =
      owned && keys && keys.left < (w.slot === RECOVERY_TREE ? 4 : 20)
        ? `<div class="note warn" style="margin-top:8px">Only ${keys.left} one-time keys left for your phrase in this vault. Plan a migrate to a new vault (on nox-vault.com) before they run out.</div>`
        : "";
    const tokens = s.tokens.length
      ? `<div class="h">Tokens <span class="grow"></span></div><div class="panel tokens">${s.tokens
          .map((tk) => `<div class="row between"><span class="muted">${esc(shortAddr(tk.mint))}</span><span>${esc(tk.ui)}</span></div>`)
          .join("")}</div>`
      : "";
    const cl = clocks(s, t);
    const clockPanel = cl.length
      ? `<div class="h">Clocks <span class="grow"></span></div><div class="panel"><dl class="kv">${cl
          .map((c) => `<dt>${esc(c.label)}</dt><dd><span class="tick ${c.tone === "dim" ? "" : c.tone}" data-at="${c.at}"></span><br><span class="dim" style="font-size:10px">${esc(c.text)}</span></dd>`)
          .join("")}</dl></div>`
      : "";
    const rules = `<div class="h">Rules <span class="grow"></span></div><div class="panel"><dl class="kv">${ruleLines(s.rules)
      .map((r) => {
        if (r.label === "One-time keys" && owned && keys) return `<dt>Your one-time keys</dt><dd class="${keys.left < 20 ? "warn" : ""}">${keys.left} of ${keys.total} left</dd>`;
        return `<dt>${esc(r.label)}</dt><dd class="${r.tone === "dim" ? "" : r.tone}">${esc(r.value)}</dd>`;
      })
      .join("")}</dl></div>`;
    const approvals = x.approvals?.length
      ? `<div class="h">Waiting for co-signers <span class="grow"></span></div><div class="panel stack">${x.approvals
          .map(
            (a, i) => `<div><div>${esc(describeAction(a.action))}</div><div class="row between"><span class="dim small">signed by ${[0, 1, 2].filter((tr) => a.trees & (1 << tr)).length} of ${s.rules.threshold}</span>${
              owned && w.slot != null && w.slot < 3 && !(a.trees & (1 << w.slot)) ? `<button class="btn" data-a="cosign-start" data-arg="${esc(v.key)}" data-i="${i}">Approve</button>` : ""
            }</div></div>`
          )
          .join("")}</div>`
      : "";
    const activity =
      x.activity === undefined || x.activity === null
        ? `<div class="h">Activity <span class="grow"></span></div><div class="panel dim small">${x.loading ? "loading…" : "—"}</div>`
        : `<div class="h">Activity <span class="grow"></span></div><div class="panel act">${
            x.activity.length
              ? x.activity
                  .map(
                    (a) => `<button class="row between link-row" data-a="open-tx" data-arg="${esc(a.sig)}" data-cluster="${esc(w.cluster)}"><span class="${a.ok ? "" : "bad"}">${esc(a.sig.slice(0, 10))}…${a.ok ? "" : " failed"}</span><span class="dim">${a.at ? esc(ago(a.at)) : ""} ↗</span></button>`
                  )
                  .join("")
              : `<span class="dim">No transactions yet.</span>`
          }</div>`;
    return `${head}<div class="hero"><div class="name">${esc(w.label || "Vault")} ${roleLine}</div><div class="mono-addr">${esc(w.address)}</div>
        <div class="bal" style="margin-top:6px">${esc(solNum(s.lamports))}<small>SOL</small></div>
        <div style="margin-top:4px"><span class="chip ${h.tone === "ok" ? "" : h.tone}">${esc(h.label)}</span></div>
        <div class="dim" style="font-size:10.5px;margin-top:6px">${esc(CLUSTER_LABEL[w.cluster])} · checked ${esc(ago(st!.checkedAt))}${st?.error ? ` · <span class="bad">${esc(st.error)}</span>` : ""}</div></div>
      ${alert}
      <div style="margin-top:${alert ? 10 : 0}px">${actions}</div>${more}${keyWarn}
      ${tokens}${approvals}${clockPanel}${rules}${activity}`;
  },
  () => {
    const v = app.view as DetailExtra & { key: string; loadedFor?: string; name: string };
    if (v.loadedFor === v.key) return;
    v.loadedFor = v.key;
    void loadDetail(v);
  }
);

async function loadDetail(v: DetailExtra & { key: string }) {
  const w = findVault(v.key);
  const st = app.data.status[v.key];
  if (!w || !st?.snap) return;
  v.loading = true;
  const conn = connFor(w.cluster);
  const vault = new PublicKey(w.address);
  const program = programFor(w.cluster);
  const [act, approvals, state] = await Promise.all([
    recentActivity(conn, vault).catch(() => null),
    st.snap.rules.threshold > 1 ? vaultApprovals(program, vault).catch(() => null) : Promise.resolve([]),
    w.accountId && w.slot != null ? fetchState(program, vault).catch(() => null) : Promise.resolve(null),
  ]);
  v.loading = false;
  v.activity = act;
  v.approvals = approvals;
  if (state && w.slot != null) v.keys = { left: keysLeft(state, w.slot), total: 1 << treeOf(state.config, w.slot).height };
  if (app.view === (v as unknown)) render();
}

on({
  more: () => {
    app.view.more = !app.view.more;
    app.view.confirmRemove = false;
    render();
  },
  rename: async (form) => {
    const label = String(new FormData(form as HTMLFormElement).get("label") ?? "").trim().slice(0, 24);
    const { watched } = await load("watched");
    const i = watched.findIndex((w) => watchKey(w) === app.view.key);
    if (i < 0) return;
    watched[i] = { ...watched[i], label };
    await save({ watched });
    app.data.watched = watched;
    toast("Renamed");
    render();
  },
  remove: async (el) => {
    if (!app.view.confirmRemove) {
      app.view.confirmRemove = true;
      return render();
    }
    const key = el.dataset.arg!;
    app.data.watched = app.data.watched.filter((w) => watchKey(w) !== key);
    delete app.data.status[key];
    await save({ watched: app.data.watched, status: app.data.status });
    void send({ type: "refresh", only: [] });
    go({ name: "home" });
  },
  "export-config": async (el) => {
    const w = findVault(el.dataset.arg!);
    if (!w) return;
    let config = w.config;
    if (!config) {
      const state = await fetchState(programFor(w.cluster), new PublicKey(w.address)).catch(() => null);
      if (state) config = configToJson(state.config);
    }
    if (!config) return toast("No config to export");
    downloadJson(`noxvault-config-${w.address.slice(0, 8)}.json`, {
      app: "noxvault",
      kind: "vault-config",
      v: 1,
      vault: w.address,
      cluster: w.cluster,
      label: w.label,
      vaultNumber: w.vaultNumber ?? null,
      slot: w.slot ?? null,
      preset: w.preset ?? null,
      note: "Public data only: the vault's rules. It contains no phrase or key. With it, anyone can initialize this vault; only your phrase can sign for it.",
      config,
      exportedAt: new Date().toISOString(),
    });
  },
  "exec-pending": async (el) => {
    const v = app.view;
    const w = findVault(el.dataset.arg!);
    if (!w) return;
    v.busy = "exec";
    v.execMsg = null;
    render();
    try {
      if (!w.accountId) throw new Error("Watch-only vault: unlock an account to pay the network fee, or let the keeper run it.");
      const fee = await feeAccountOf(w.accountId);
      const bal = await connFor(w.cluster).getBalance(fee.publicKey, "confirmed");
      if (bal < 10_000) throw new Error(`Your wallet (${shortAddr(fee.publicKey.toBase58())}) has no devnet SOL for the network fee. Fund it, or wait: the site's keeper executes due payouts automatically.`);
      const sig = await executePending(programFor(w.cluster), fee, new PublicKey(w.address));
      v.execMsg = { ok: true, text: `Executed. tx ${sig.slice(0, 10)}…` };
      void send({ type: "refresh", only: [v.key] });
    } catch (e) {
      v.execMsg = { ok: false, text: errText(e) };
    } finally {
      v.busy = null;
      render();
    }
  },
  deposit: (el) => go({ name: "deposit", key: el.dataset.arg }),
});

export function downloadJson(name: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- deposit ----------

defineView("deposit", () => {
  const w = findVault(app.view.key);
  if (!w) return `${back("Vaults", "home")}`;
  const links = siteLinks(w.address);
  return `${back(w.label || shortAddr(w.address), "detail", app.view.key)}
    <div class="h">Deposit to vault <span class="grow"></span></div>
    <div class="qr">${qrSvg(w.address)}</div>
    <div class="copybox"><code>${esc(w.address)}</code><button class="btn" data-a="copy" data-arg="${esc(w.address)}">Copy</button></div>
    <div class="stack" style="margin-top:10px">
      ${app.data.keyring && w.cluster !== "mainnet-beta" ? `<button class="btn primary block" data-a="wmove-start" data-arg="${esc(app.view.key)}">Deposit from my wallet</button>` : ""}
      <div class="note ${w.cluster === "mainnet-beta" ? "warn" : ""}">Send SOL or tokens to this address on <b>${esc(CLUSTER_LABEL[w.cluster])}</b>. Anyone can deposit; nothing needs signing by the vault. Noxvault runs on devnet and is unaudited: do not send funds you cannot lose.</div>
      <button class="btn block" data-a="open" data-arg="${esc(links.fund)}">Deposit with a wallet on nox-vault.com ↗</button>
    </div>`;
});

// ---------- watch an address ----------

defineView("add", () => {
  const v = app.view;
  return `${back("Vaults", "home")}
    <div class="h">Watch a vault <span class="grow"></span></div>
    <form data-a="add-submit" class="panel stack" autocomplete="off">
      <label class="field"><span>Vault address</span><input type="text" name="address" placeholder="e.g. B9fC…9Fty" spellcheck="false" required autofocus/></label>
      <label class="field"><span>Label (optional)</span><input type="text" name="label" maxlength="24" placeholder="Savings" /></label>
      <div class="dim small">Network: ${esc(CLUSTER_LABEL[app.data.settings.cluster])} (change in settings)</div>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <button class="btn primary block" type="submit">Watch vault</button>
    </form>
    <div class="h">Or <span class="grow"></span></div>
    <div class="panel stack">
      <button class="btn block" data-a="import">Import from nox-vault.com</button>
      <div class="note">Finds vaults you created on nox-vault.com in this browser. Chrome asks once for access to nox-vault.com; the extension reads only the vault addresses the site saved, never anything else.</div>
    </div>
    <div class="note warn" style="margin-top:10px">Only the public address goes here. Your phrase goes only into the wallet setup screens of this extension.</div>`;
});

on({
  "add-submit": async (form) => {
    const fd = new FormData(form as HTMLFormElement);
    const address = String(fd.get("address") ?? "");
    const label = String(fd.get("label") ?? "");
    const v = app.view;
    const a = parseAddress(address);
    if (address.trim().split(/\s+/).length >= 12) {
      (form as HTMLFormElement).reset();
      v.err = "That looks like a phrase. Never paste it into an address field.";
      return render();
    }
    if (!a) return void ((v.err = "That is not a Solana address."), render());
    const { watched, settings } = await load("watched", "settings");
    const w: Watched = { address: a, cluster: settings.cluster, label: label.trim().slice(0, 24), addedAt: now(), role: "watch" };
    if (watched.some((x) => watchKey(x) === watchKey(w))) return void ((v.err = "Already in the list."), render());
    if (watched.length >= MAX_WATCHED) return void ((v.err = `Up to ${MAX_WATCHED} vaults.`), render());
    await save({ watched: [...watched, w] });
    app.data.watched = [...watched, w];
    go({ name: "vault", key: watchKey(w) });
    void send({ type: "refresh", only: [watchKey(w)] });
  },
});

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
      if (r.added) go({ name: "home" });
    })
    .catch((e) => toast(String(e?.message ?? e)));
}
