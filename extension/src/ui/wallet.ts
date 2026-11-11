// v0.3 wallet side, like Phantom: home (total value, account switcher, Receive / Send / Protect, tabs
// Wallet and Vaults), holdings with prices, activity, the quantum-exposure card on every wallet,
// wallet accounts (derive, import, watch, rename, export key), receive, send, "Protect it" (create a
// vault paid by the wallet) and "Deposit from wallet" (move funds from a wallet into a vault).
//
// Wallet accounts are ordinary ed25519 keys: NOT quantum-safe. Only vaults are. The UI says so.
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fetchState } from "../../../sdk/client";
import { riskOf, type Risk } from "../../../web/lib/exposure";
import { walletActivity, type WalletTx } from "../core/activity";
import { SOL_MINT, fmtPct, fmtUnits, fmtUsd, parseUnits, readHoldings, shownDecimals, unitsToInput, type Holding, type HoldingsResult } from "../core/holdings";
import { WrongPasswordError } from "../core/keyring";
import { KEEP_FOR_FEES, RENT_EMPTY, ataNeeds, checkRecipient, packLegs, prepare, recipientFacts, signAndSend, transferIxs, type AssetRef, type Prepared, type RecipientCheck, type TransferLeg } from "../core/transfer";
import { addDerivedWallet, addWatchWallet, exportWalletKey, importWallet, removeWallet, renameWallet } from "../core/wallet";
import { parseAddress, shortAddr } from "../lib/net";
import { qrSvg } from "../lib/qr";
import { load, save, type TokenMetaCache, type WalletMeta } from "../lib/store";
import { watchKey, type WalletCluster } from "../lib/types";
import { activeAccount, activeWallet, ago, app, back, defineView, errText, esc, findVault, go, handler, on, programFor, reload, render, send, toast, walletConn, walletKp } from "./core";
import { vaultsTab } from "./vaults";

// ---------- holdings cache (memory; public data) ----------

interface Hold {
  at: number;
  res?: HoldingsResult;
  err?: string;
  loading?: boolean;
  act?: WalletTx[] | null;
  actErr?: string;
  actLoading?: boolean;
}
const holds = new Map<string, Hold>();
const hkey = (address: string, c: WalletCluster) => `${c}:${address}`;
let metaCache: Record<string, TokenMetaCache> | null = null;

const net = () => app.data.settings.walletCluster;
const explorerTx = (sig: string, c: WalletCluster) => `https://explorer.solana.com/tx/${sig}${c === "devnet" ? "?cluster=devnet" : ""}`;
const explorerAddr = (a: string, c: WalletCluster) => `https://explorer.solana.com/address/${a}${c === "devnet" ? "?cluster=devnet" : ""}`;

export function invalidate(address: string, c: WalletCluster) {
  holds.delete(hkey(address, c));
}

/** Header refresh button / polling: re-read the active wallet (balances and activity). */
export function refreshWallet() {
  const w = activeWallet();
  if (!w) return;
  holds.delete(hkey(w.address, net()));
  render();
}

// Like Phantom: the open home screen re-reads balances every 30 s (only while visible).
setInterval(() => {
  if (document.hidden || app.view.name !== "home" || app.homeTab !== "wallet") return;
  const w = activeWallet();
  const h = w && holds.get(hkey(w.address, net()));
  if (w && h && !h.loading && Date.now() - h.at > 30_000) {
    h.act = undefined;
    void loadHoldings(w.address, net(), true).then(() => loadActivity(w.address, net()));
  }
}, 10_000);

const WALLET_RENDER = new Set(["home", "wallets", "wsend", "protect", "wmove"]);

export async function loadHoldings(address: string, c: WalletCluster, force = false): Promise<Hold> {
  const k = hkey(address, c);
  let h = holds.get(k);
  if (h && (h.loading || (!force && Date.now() - h.at < 30_000 && h.res))) return h;
  h = { ...(h ?? {}), at: Date.now(), loading: true };
  holds.set(k, h);
  try {
    if (!metaCache) metaCache = (await load("tokenMeta")).tokenMeta;
    const res = await readHoldings(walletConn(c), new PublicKey(address), c, metaCache);
    h.res = res;
    h.err = undefined;
    if (Object.keys(res.metaUpdates).length) {
      Object.assign(metaCache, res.metaUpdates);
      const entries = Object.entries(metaCache).sort((a, b) => b[1].at - a[1].at).slice(0, 600);
      metaCache = Object.fromEntries(entries);
      void save({ tokenMeta: metaCache });
    }
  } catch (e) {
    h.err = errText(e);
  } finally {
    h.loading = false;
    h.at = Date.now();
  }
  if (WALLET_RENDER.has(app.view.name)) render();
  return h;
}

async function loadActivity(address: string, c: WalletCluster) {
  const h = holds.get(hkey(address, c));
  if (!h || h.actLoading || h.act !== undefined) return;
  h.actLoading = true;
  try {
    h.act = await walletActivity(walletConn(c), new PublicKey(address), 8);
  } catch (e) {
    h.act = null;
    h.actErr = errText(e);
  } finally {
    h.actLoading = false;
  }
  if (app.view.name === "home") render();
}

// ---------- small renderers ----------

function avatar(symbol: string, logo?: string, cls = "tok-ava"): string {
  const ch = (symbol || "?").replace(/^\$/, "").slice(0, 1).toUpperCase() || "?";
  let hue = 0;
  for (const c of symbol) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const letter = `<span class="${cls} letter" style="background:hsl(${hue} 45% 22%);color:hsl(${hue} 80% 75%)">${esc(ch)}</span>`;
  if (!logo || !/^https:\/\//.test(logo)) return letter;
  return `<span class="${cls}"><img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-letter="${esc(ch)}"/></span>`;
}

// a token logo that fails to load becomes its letter (no inline handlers: CSP)
document.addEventListener(
  "error",
  (e) => {
    const t = e.target as HTMLElement;
    if (t?.tagName === "IMG" && t.dataset.letter) {
      const s = document.createElement("span");
      s.className = "letter-fallback";
      s.textContent = t.dataset.letter;
      t.replaceWith(s);
    }
  },
  true
);

const KIND_TAG: Record<WalletMeta["kind"], string> = { derived: "PHRASE", "legacy-fee": "FEE · V0.2", "imported-phrase": "IMPORTED", "imported-key": "IMPORTED KEY", watch: "WATCH" };
const tagOf = (w: WalletMeta) => (w.kind === "derived" ? `#${(w.index ?? 0) + 1}` : KIND_TAG[w.kind]);

function riskFor(res: HoldingsResult | undefined, c: WalletCluster): Risk {
  const real = res?.holdings.filter((h) => h.program !== "sol" && !h.spam && BigInt(h.raw) > 0n) ?? [];
  return riskOf({
    kind: "wallet",
    lamports: res?.lamports ?? 0,
    stakeWithdrawable: 0,
    stakeStakerOnly: 0,
    tokens: real.length,
    usd: c === "mainnet-beta" ? (res?.totalUsd ?? null) : null,
    delegations: res?.holdings.filter((h) => h.delegated).length ?? 0,
    escapeArmed: false,
    activity: null,
  });
}

function exposureCard(w: WalletMeta, res: HoldingsResult | undefined, c: WalletCluster): string {
  const r = riskFor(res, c);
  const tone = r.level === "high" ? "bad" : r.level === "medium" ? "warn" : "dim";
  return `<div class="expo t-${tone}">
    <div class="row between"><div class="t">⚛ QUANTUM-EXPOSED</div><span class="chip ${tone}">${esc(r.level === "none" ? "LOW" : r.level.toUpperCase())}</span></div>
    <div class="expo-h">This wallet is exposed: its address is its public key.</div>
    <div class="muted small">${esc(r.headline)} No quantum computer can do this today, but a large enough one could derive the private key from it. Vaults sign with hash-based one-time keys instead.</div>
    ${w.kind === "watch" ? "" : `<button class="btn primary block" style="margin-top:8px" data-a="w-protect">Protect it → move into a vault</button>`}
  </div>`;
}

function tokenRow(h: Holding, c: WalletCluster): string {
  const amt = fmtUnits(h.raw, h.decimals, shownDecimals(h.decimals));
  const right =
    c === "mainnet-beta"
      ? `<div class="tk-usd">${h.usd != null ? esc(fmtUsd(h.usd)) : `<span class="dim">—</span>`}</div><div class="chg ${h.change24h == null ? "" : h.change24h >= 0 ? "up" : "down"}">${esc(fmtPct(h.change24h))}</div>`
      : `<div class="tk-usd dim small">devnet</div>`;
  return `<button class="tok" data-a="w-send" data-arg="${esc(h.mint)}" title="${esc(h.mint)}">${avatar(h.symbol, h.logo)}
    <div class="tk-main"><div class="tk-name">${esc(h.name)}${h.program === "2022" ? ` <span class="role">2022</span>` : ""}${h.delegated ? ` <span class="role warnr">DELEGATED</span>` : ""}</div><div class="tk-amt">${esc(amt)} ${esc(h.symbol)}</div></div>
    <div class="tk-right">${right}</div></button>`;
}

function activityRow(t: WalletTx, res: HoldingsResult | undefined, c: WalletCluster): string {
  const sym = (mint: string) => res?.holdings.find((h) => h.mint === mint)?.symbol ?? shortAddr(mint);
  let what = "Interaction";
  let amt = "";
  if (t.kind === "failed") what = "Failed";
  else if (t.tokens.length === 1) {
    const d = t.tokens[0];
    amt = `${BigInt(d.delta) > 0n ? "+" : ""}${fmtUnits(d.delta, d.decimals, shownDecimals(d.decimals))} ${sym(d.mint)}`;
    what = t.kind === "sent" ? "Sent" : t.kind === "received" ? "Received" : "Interaction";
  } else if (t.solDelta !== 0) {
    amt = `${t.solDelta > 0 ? "+" : ""}${fmtUnits(BigInt(t.solDelta), 9, 6)} SOL`;
    what = t.kind === "sent" ? "Sent" : t.kind === "received" ? "Received" : "Interaction";
  }
  const icon = t.kind === "sent" ? "↑" : t.kind === "received" ? "↓" : t.kind === "failed" ? "×" : "•";
  const who = t.counterparty ? `${t.kind === "sent" ? "to" : "from"} ${shortAddr(t.counterparty)}` : t.tokens.length > 1 ? `${t.tokens.length} tokens` : "";
  return `<button class="actrow" data-a="open" data-arg="${esc(explorerTx(t.sig, c))}"><span class="ico k-${t.kind}">${icon}</span>
    <span class="grow1"><span class="a1">${esc(what)}</span><span class="dim small"> ${esc(who)}</span><br><span class="dim small">${t.at ? esc(ago(t.at)) : ""}</span></span>
    <span class="amt ${t.kind === "received" ? "ok" : ""}">${esc(amt)}</span></button>`;
}

// ---------- home ----------

defineView(
  "home",
  () => {
    const w = activeWallet();
    if (!w) return vaultsTab({ banners: true });
    const c = net();
    const h = holds.get(hkey(w.address, c));
    const res = h?.res;
    const locked = app.data.keyring && !app.unlocked ? `<button class="lockbar" data-a="go-lock">🔒 Locked · unlock to send or protect</button>` : "";
    const total =
      res == null
        ? `<div class="num">${h?.err ? "—" : "…"}</div>`
        : c === "mainnet-beta" && res.totalUsd != null
          ? `<div class="num">${esc(fmtUsd(res.totalUsd))}</div><div class="chg ${res.change24h == null ? "" : res.change24h >= 0 ? "up" : "down"}">${res.change24h == null ? "" : `${esc(fmtPct(res.change24h))} · 24h`}</div>`
          : `<div class="num">${esc(fmtUnits(BigInt(res.lamports), 9, 4))}<small>SOL</small></div>${c === "mainnet-beta" ? `<div class="dim small">prices unavailable${res.priceError ? `: ${esc(res.priceError.slice(0, 60))}` : ""}</div>` : `<div class="dim small">devnet · test SOL has no price</div>`}`;
    const vaultCount = app.data.watched.filter((x) => !x.accountId || x.accountId === activeAccount()?.id).length;
    const tabs = `<div class="tabs"><button class="${app.homeTab === "wallet" ? "on" : ""}" data-a="home-tab" data-arg="wallet">Wallet</button><button class="${app.homeTab === "vaults" ? "on" : ""}" data-a="home-tab" data-arg="vaults">Vaults${vaultCount ? ` <span class="count">${vaultCount}</span>` : ""}</button></div>`;
    const head = `${locked}<div class="acct-bar"><button class="acct-switch" data-a="wallets">${avatar(w.name, undefined, "w-ava")}<span class="nm"><b>${esc(w.name)}</b> <span class="dim">${esc(shortAddr(w.address))}</span></span><span class="caret">▾</span></button><button class="icon-btn" data-a="copy" data-arg="${esc(w.address)}" title="Copy address">⧉</button></div>
      <div class="total wtotal"><div class="lbl">${esc(w.kind === "watch" ? "watching" : "wallet")} · ${esc(c === "mainnet-beta" ? "mainnet" : "devnet")}</div>${total}</div>
      <div class="bigbtns"><button class="bb" data-a="w-receive"><span>↓</span>Receive</button><button class="bb" data-a="w-send" ${w.kind === "watch" ? "disabled" : ""}><span>↑</span>Send</button><button class="bb prot" data-a="w-protect" ${w.kind === "watch" ? "disabled" : ""}><span>⛨</span>Protect</button></div>
      ${tabs}`;
    if (app.homeTab === "vaults") return head + vaultsTab();
    const segs = (["mainnet-beta", "devnet"] as WalletCluster[]).map((x) => `<button class="${x === c ? "on" : ""}" data-a="w-net" data-arg="${x}">${x === "mainnet-beta" ? "mainnet" : "devnet"}</button>`).join("");
    const rows = res?.holdings ?? [];
    const shown = rows.filter((x) => !app.data.settings.hideSpam || !x.spam);
    const hidden = rows.length - shown.length;
    const list = res
      ? `<div class="toklist">${shown.map((x) => tokenRow(x, c)).join("")}</div>
         <div class="row between small" style="margin-top:6px"><label class="switch mini"><input type="checkbox" data-a="w-spam" ${app.data.settings.hideSpam ? "checked" : ""}/> <span>Hide zero &amp; spam${hidden ? ` (${hidden})` : ""}</span></label>${c === "mainnet-beta" ? `<span class="dim">prices: Jupiter</span>` : ""}</div>`
      : `<div class="panel dim small">${h?.err ? `<span class="bad">${esc(h.err)}</span> <button class="link" data-a="w-reload">retry</button>` : "Reading balances…"}</div>`;
    const act = h?.act;
    const activity = `<div class="h">Activity <span class="grow"></span></div><div class="panel act">${
      act === undefined || h?.actLoading ? `<span class="dim small">loading…</span>` : act === null ? `<span class="dim small">${esc(h?.actErr ?? "could not read")}</span>` : act.length ? act.map((t) => activityRow(t, res, c)).join("") : `<span class="dim small">No transactions yet on ${c === "mainnet-beta" ? "mainnet" : "devnet"}.</span>`
    }</div>`;
    return `${head}<div class="row between" style="margin:10px 0 8px"><div class="seg mini">${segs}</div><button class="link small" data-a="open" data-arg="${esc(explorerAddr(w.address, c))}">explorer ↗</button></div>
      ${exposureCard(w, res, c)}
      <div class="h">Holdings <span class="grow"></span>${res ? `<span>${rows.length - hidden}</span>` : ""}</div>${list}${activity}`;
  },
  () => {
    const w = activeWallet();
    if (!w || app.homeTab !== "wallet") return;
    const c = net();
    const h = holds.get(hkey(w.address, c));
    if (!h || (!h.loading && Date.now() - h.at > 30_000)) void loadHoldings(w.address, c).then(() => loadActivity(w.address, c));
    else if (h.res && h.act === undefined && !h.actLoading) void loadActivity(w.address, c);
  }
);

on({
  "home-tab": (el) => {
    app.homeTab = el.dataset.arg as "wallet" | "vaults";
    render();
  },
  "w-net": async (el) => {
    app.data.settings = { ...app.data.settings, walletCluster: el.dataset.arg as WalletCluster };
    await save({ settings: app.data.settings });
    render();
  },
  "w-spam": async (el) => {
    app.data.settings = { ...app.data.settings, hideSpam: (el as HTMLInputElement).checked };
    await save({ settings: app.data.settings });
    render();
  },
  "w-reload": () => {
    const w = activeWallet();
    if (w) {
      invalidate(w.address, net());
      render();
    }
  },
  "w-receive": () => go({ name: "receive" }),
  "w-select": async (el) => {
    const id = el.dataset.arg!;
    const w = app.data.wallets.find((x) => x.id === id);
    const patch: Record<string, string> = { activeWallet: id };
    if (w?.phraseId) patch.activeAccount = w.phraseId; // its phrase's vaults
    await save(patch);
    await reload();
    app.homeTab = "wallet";
    go({ name: "home" });
  },
  wallets: () => go({ name: "wallets" }),
});

// ---------- receive ----------

defineView("receive", () => {
  const w = activeWallet();
  if (!w) return back("Home", "home");
  return `${back("Home", "home")}<div class="h">Receive · ${esc(w.name)} <span class="grow"></span></div>
    <div class="qr">${qrSvg(w.address)}</div>
    <div class="copybox"><code>${esc(w.address)}</code><button class="btn" data-a="copy" data-arg="${esc(w.address)}">Copy</button></div>
    <div class="stack" style="margin-top:10px">
      <div class="note">Send SOL or any Solana token (SPL or Token-2022) to this address. It is the same address on mainnet and devnet; this screen does not choose a network, the sender does.</div>
      <div class="note warn">This is an ordinary wallet: its address is its public key, so it is not quantum-safe. For savings, use <button class="link" data-a="w-protect">Protect</button> to move funds into a vault (devnet for now).</div>
    </div>`;
});

// ---------- wallet accounts ----------

defineView(
  "wallets",
  () => {
    const v = app.view;
    const c = net();
    const rows = app.data.wallets
      .map((w) => {
        const h = holds.get(hkey(w.address, c));
        const bal = h?.res ? `${fmtUnits(BigInt(h.res.lamports), 9, 4)} SOL` : "…";
        const usd = c === "mainnet-beta" && h?.res?.totalUsd != null ? fmtUsd(h.res.totalUsd) : "";
        return `<div class="wrow ${w.id === app.data.activeWallet ? "on" : ""}"><button class="wsel" data-a="w-select" data-arg="${esc(w.id)}">${avatar(w.name, undefined, "w-ava")}
          <span class="grow1"><span class="nm">${esc(w.name)}</span> <span class="role">${esc(tagOf(w))}</span><br><span class="dim small">${esc(shortAddr(w.address))}</span> <span class="chip warn tiny">EXPOSED</span></span>
          <span class="r"><span>${esc(usd || bal)}</span>${usd ? `<br><span class="dim small">${esc(bal)}</span>` : ""}</span></button>
          <button class="icon-btn" data-a="wmanage-open" data-arg="${esc(w.id)}" title="Manage">⋯</button></div>`;
      })
      .join("");
    const phrase = activeWallet()?.phraseId ?? activeAccount()?.id;
    return `${back("Home", "home")}<div class="h">Wallet accounts · ${esc(c === "mainnet-beta" ? "mainnet" : "devnet")} <span class="grow"></span></div>
      <div class="stack">${rows || `<div class="panel dim">No wallet accounts.</div>`}</div>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <div class="grid2" style="margin-top:10px">
        <button class="btn primary" data-a="w-add" ${app.unlocked && phrase ? "" : "disabled"}>+ New account</button>
        <button class="btn" data-a="wimport-open" ${app.data.keyring ? "" : "disabled"}>Import wallet</button>
      </div>
      <button class="btn ghost block" style="margin-top:6px" data-a="wwatch-open">Watch an address (read-only)</button>
      <div class="note" style="margin-top:10px">New accounts come from your phrase on the standard path m/44'/501'/i'/0', so the same phrase shows the same addresses in Phantom or Solflare. They are ordinary ed25519 keys: <b>not quantum-safe</b>. Only vaults are.</div>`;
  },
  () => {
    const v = app.view;
    if (v.loaded) return;
    v.loaded = true;
    void (async () => {
      for (const w of app.data.wallets) {
        await loadHoldings(w.address, net()).catch(() => {});
      }
    })();
  }
);

on({
  "w-add": async () => {
    const phrase = activeWallet()?.phraseId ?? activeAccount()?.id;
    if (!phrase) return;
    try {
      const m = await addDerivedWallet(phrase, app.data.settings.autoLockMin);
      await reload();
      toast(`Added ${m.name} (m/44'/501'/${m.index}'/0')`);
      render();
    } catch (e) {
      app.view.err = errText(e);
      render();
    }
  },
  "wimport-open": () => go({ name: "wimport" }),
  "wwatch-open": () => go({ name: "wwatch" }),
  "wmanage-open": (el) => go({ name: "wmanage", id: el.dataset.arg }),
});

defineView("wimport", () => {
  const v = app.view;
  return `${back("Accounts", "wallets")}<div class="h">Import a Solana wallet <span class="grow"></span></div>
    <form class="panel stack" data-a="wimport-submit" autocomplete="off">
      <label class="field"><span>Secret phrase (12 / 24 words) or private key</span><textarea name="secret" rows="4" class="secret" autocapitalize="off" spellcheck="false" autofocus></textarea></label>
      <div class="row"><label class="field grow1"><span>Account index (phrase)</span><input type="text" name="index" value="0" inputmode="numeric"/></label><label class="field grow1"><span>Name</span><input type="text" name="name" maxlength="24" placeholder="Phantom"/></label></div>
      <label class="field"><span>Your password</span><input type="password" name="pw"/></label>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <button class="btn primary block" type="submit" ${v.busy ? "disabled" : ""}>${v.busy ? "Encrypting…" : "Import"}</button>
      <div class="dim small">From Phantom, Solflare, Backpack: their phrase with index 0 is their first account (m/44'/501'/0'/0'), 1 the second. A private key is Phantom's "Export private key" (base58) or a solana-keygen JSON array. It is checked here and stored encrypted with your password, like your phrase. No BIP39 passphrase support yet.</div>
    </form>`;
});

on({
  "wimport-submit": async (form) => {
    const v = app.view;
    const f = form as HTMLFormElement;
    const fd = new FormData(f);
    const secretEl = f.elements.namedItem("secret") as HTMLTextAreaElement;
    const pwEl = f.elements.namedItem("pw") as HTMLInputElement;
    const secret = secretEl.value;
    const pw = pwEl.value;
    v.busy = true;
    v.err = "";
    render();
    try {
      const m = await importWallet(secret, pw, String(fd.get("name") ?? ""), Number(String(fd.get("index") ?? "0").trim() || "0"));
      await reload();
      toast(`Imported ${m.name}`);
      app.homeTab = "wallet";
      go({ name: "home" });
    } catch (e) {
      v.busy = false;
      v.err = e instanceof WrongPasswordError ? "Wrong password." : errText(e);
      render(); // the form is re-rendered empty: the secret is not kept in the page
    }
  },
});

defineView("wwatch", () => {
  const v = app.view;
  return `${back("Accounts", "wallets")}<div class="h">Watch an address <span class="grow"></span></div>
    <form class="panel stack" data-a="wwatch-submit" autocomplete="off">
      <label class="field"><span>Solana address</span><input type="text" name="address" spellcheck="false" autofocus/></label>
      <label class="field"><span>Name</span><input type="text" name="name" maxlength="24" placeholder="Cold wallet"/></label>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
      <button class="btn primary block" type="submit">Watch</button>
      <div class="dim small">Read-only: holdings, prices, activity and its quantum exposure. No key, no sending.</div>
    </form>`;
});

on({
  "wwatch-submit": async (form) => {
    const fd = new FormData(form as HTMLFormElement);
    const raw = String(fd.get("address") ?? "");
    if (raw.trim().split(/\s+/).length >= 12) {
      (form as HTMLFormElement).reset();
      app.view.err = "That looks like a phrase. Never paste it into an address field.";
      return render();
    }
    const a = parseAddress(raw);
    if (!a) return void ((app.view.err = "That is not a Solana address."), render());
    try {
      await addWatchWallet(a, String(fd.get("name") ?? ""));
      await reload();
      app.homeTab = "wallet";
      go({ name: "home" });
    } catch (e) {
      app.view.err = errText(e);
      render();
    }
  },
});

defineView("wmanage", () => {
  const v = app.view;
  const w = app.data.wallets.find((x) => x.id === v.id);
  if (!w) return back("Accounts", "wallets");
  const what =
    w.kind === "derived"
      ? `Derived from your phrase, path m/44'/501'/${w.index ?? 0}'/0' (shows the same address in Phantom with this phrase).`
      : w.kind === "legacy-fee"
        ? "The v0.2 fee account of your phrase (SHA-256 derivation, only this extension knows it). Move its SOL to another account if you no longer need it."
        : w.kind === "imported-phrase"
          ? `Imported phrase, account index ${w.index ?? 0}. Stored encrypted with your password.`
          : w.kind === "imported-key"
            ? "Imported private key. Stored encrypted with your password."
            : "Watched address: no key here.";
  const canRemove = !(w.kind === "derived" && (w.index ?? 0) === 0);
  const imported = w.kind === "imported-phrase" || w.kind === "imported-key";
  const keyBox = v.secret
    ? `<div class="note warn"><b>Anyone with this key controls this wallet</b> on every network, now and forever. Never paste it into a website or a chat. Noxvault support will never ask for it.</div>
       <div class="reveal-wrap"><div class="keybox ${v.revealed ? "" : "blur"}">${esc(v.secret)}</div>${v.revealed ? "" : `<button class="btn primary reveal" data-a="wm-reveal">Reveal key</button>`}</div>
       <div class="grid2"><button class="btn" data-a="copy-secret" ${v.revealed ? "" : "disabled"}>Copy</button><button class="btn primary" data-a="wm-hide">Hide</button></div>`
    : w.kind === "watch"
      ? ""
      : `<form class="stack" data-a="wm-export" autocomplete="off"><input type="password" name="pw" placeholder="Password"/>
          <div class="note warn">Exporting shows the raw private key of this ordinary wallet (Phantom format). Only do this to move the wallet to another app you trust. This never shows a vault phrase.</div>
          <button class="btn danger block" type="submit">Show private key</button></form>`;
  return `${back("Accounts", "wallets")}<div class="h">${esc(w.name)} <span class="role">${esc(tagOf(w))}</span> <span class="grow"></span></div>
    <div class="panel stack">
      <form class="row" data-a="wm-rename" autocomplete="off"><input type="text" name="name" maxlength="24" value="${esc(w.name)}"/><button class="btn" type="submit">Rename</button></form>
      <div class="qr small">${qrSvg(w.address)}</div>
      <div class="copybox"><code>${esc(w.address)}</code><button class="btn" data-a="copy" data-arg="${esc(w.address)}">Copy</button></div>
      <div class="dim small">${esc(what)}</div>
    </div>
    ${w.kind === "watch" ? "" : `<div class="h">Private key <span class="grow"></span></div><div class="panel stack">${keyBox}${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}</div>`}
    ${
      canRemove
        ? `<div class="h">Remove <span class="grow"></span></div><form class="panel stack" data-a="wm-remove" autocomplete="off">
          ${imported ? `<input type="password" name="pw" placeholder="Password"/>` : ""}
          <button class="btn danger block" type="submit">${v.confirmRemove ? "Click again to remove" : "Remove from this extension"}</button>
          <div class="dim small">${imported ? "Deletes the imported key from the keyring. Make sure you have it elsewhere, or move its funds first." : w.kind === "watch" ? "Only forgets the address." : "Only hides it: your phrase still derives it."}</div>
          ${v.rmErr ? `<div class="err">${esc(v.rmErr)}</div>` : ""}</form>`
        : ""
    }`;
});

on({
  "wm-rename": async (form) => {
    await renameWallet(app.view.id, String(new FormData(form as HTMLFormElement).get("name") ?? ""));
    await reload();
    toast("Renamed");
    render();
  },
  "wm-export": async (form) => {
    const v = app.view;
    const pwEl = (form as HTMLFormElement).elements.namedItem("pw") as HTMLInputElement;
    const pw = pwEl.value;
    pwEl.value = "";
    v.err = "";
    try {
      v.secret = await exportWalletKey(pw, v.id);
      v.revealed = false;
    } catch (e) {
      v.err = e instanceof WrongPasswordError ? "Wrong password." : errText(e);
    }
    render();
  },
  "wm-reveal": () => {
    app.view.revealed = true;
    render();
  },
  "wm-hide": () => {
    app.view.secret = null;
    app.view.revealed = false;
    render();
  },
  "copy-secret": () => {
    const s = app.view.secret;
    if (!s) return;
    void navigator.clipboard.writeText(s).then(() => {
      toast("Copied. Clear your clipboard after pasting.");
      setTimeout(() => void navigator.clipboard.writeText("").catch(() => {}), 60_000);
    });
  },
  "wm-remove": async (form) => {
    const v = app.view;
    if (!v.confirmRemove) {
      v.confirmRemove = true;
      return render();
    }
    const pwEl = (form as HTMLFormElement).elements.namedItem("pw") as HTMLInputElement | null;
    const pw = pwEl?.value;
    if (pwEl) pwEl.value = "";
    try {
      await removeWallet(v.id, pw);
      await reload();
      toast("Removed");
      go({ name: "wallets" });
    } catch (e) {
      v.rmErr = e instanceof WrongPasswordError ? "Wrong password." : errText(e);
      render();
    }
  },
});

// ---------- send ----------

interface SendView {
  name: "wsend";
  stage: "form" | "review" | "sending" | "done";
  walletId: string;
  cluster: WalletCluster;
  mint: string;
  amount: string;
  dest: string;
  max?: boolean;
  err?: string;
  busy?: boolean;
  prep?: Prepared | null;
  check?: RecipientCheck;
  units?: bigint;
  rent?: number;
  destLabel?: string;
  sig?: string;
  /** the asset as it was reviewed (balances may refresh meanwhile) */
  snap?: Pick<Holding, "symbol" | "decimals" | "price" | "program">;
}
const sv = () => app.view as unknown as SendView;

on({
  "w-send": (el) => {
    const w = activeWallet();
    if (!w) return;
    if (w.kind === "watch") return toast("Watched address: no key to send with.");
    if (!app.unlocked) return go({ name: "lock", next: { name: "home" } });
    const mint = el.dataset.arg && el.dataset.arg !== "" ? el.dataset.arg : SOL_MINT;
    go({ name: "wsend", stage: "form", walletId: w.id, cluster: net(), mint, amount: "", dest: "" } as never);
  },
});

function holdingsOf(v: { walletId: string; cluster: WalletCluster }): HoldingsResult | undefined {
  const w = app.data.wallets.find((x) => x.id === v.walletId);
  return w ? holds.get(hkey(w.address, v.cluster))?.res : undefined;
}

defineView(
  "wsend",
  () => {
    const v = sv();
    const w = app.data.wallets.find((x) => x.id === v.walletId);
    if (!w) return back("Home", "home");
    const res = holdingsOf(v);
    const netName = v.cluster === "mainnet-beta" ? "mainnet" : "devnet";
    const head = `${back("Home", "home")}<div class="h">Send from ${esc(w.name)} · ${netName} <span class="grow"></span></div>`;
    const asset = v.stage === "form" ? res?.holdings.find((h) => h.mint === v.mint) : v.snap;
    if (v.stage === "form") {
      if (!res) return `${head}<div class="panel dim">Reading balances…</div>`;
      const opts = res.holdings
        .filter((h) => h.program === "sol" || (BigInt(h.raw) > 0n && (!h.spam || h.mint === v.mint)))
        .map((h) => `<option value="${esc(h.mint)}" ${h.mint === v.mint ? "selected" : ""}>${esc(h.symbol)} · ${esc(fmtUnits(h.accountRaw, h.decimals, shownDecimals(h.decimals)))}${h.spam ? " (unverified)" : ""}</option>`)
        .join("");
      const own = app.data.watched.filter((x) => x.accountId && (v.cluster === "devnet" ? x.cluster !== "mainnet-beta" : x.cluster === "mainnet-beta"));
      return `${head}<form class="panel stack" data-a="ws-form" autocomplete="off">
        <label class="field"><span>Asset</span><select name="asset">${opts}</select></label>
        <label class="field"><span>Amount</span><div class="row"><input type="text" name="amount" inputmode="decimal" value="${esc(v.max ? "max" : v.amount)}" placeholder="0.0"/><button type="button" class="btn" data-a="ws-max">Max</button></div></label>
        ${asset?.price && v.cluster === "mainnet-beta" ? `<div class="dim small">1 ${esc(asset.symbol)} ≈ ${esc(fmtUsd(asset.price))}</div>` : ""}
        <label class="field"><span>To</span><input type="text" name="dest" value="${esc(v.dest)}" placeholder="recipient Solana address" spellcheck="false"/></label>
        ${own.length ? `<div class="chips"><span class="dim small">my vaults:</span>${own.map((x) => `<button type="button" class="chipbtn" data-a="ws-to" data-arg="${esc(x.address)}">${esc(x.label || shortAddr(x.address))}</button>`).join("")}</div>` : ""}
        ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
        <button class="btn primary block" type="submit" ${v.busy ? "disabled" : ""}>${v.busy ? "Checking & simulating…" : "Review"}</button>
        <div class="dim small">Next: the recipient is checked and the transaction is simulated before anything is signed. No swaps yet.</div>
      </form>`;
    }
    if (!asset || !v.prep || v.units == null) return `${head}<div class="panel">Something changed. <button class="link" data-a="ws-edit">Back</button></div>`;
    const amt = `${fmtUnits(v.units, asset.decimals)} ${asset.symbol}`;
    const usd = asset.price != null && v.cluster === "mainnet-beta" ? fmtUsd((Number(v.units) / 10 ** asset.decimals) * asset.price) : "";
    const solOut = (asset.program === "sol" ? Number(v.units) : 0) + v.prep.fee + (v.rent ?? 0);
    if (v.stage === "review") {
      const warn = v.check?.warnings ?? [];
      const info = v.check?.info ?? [];
      return `${head}<div class="hero"><div class="dim small">You send</div><div class="bal">${esc(amt)}</div>${usd ? `<div class="dim">${esc(usd)}</div>` : ""}</div>
        <div class="panel"><dl class="kv wide">
          <dt>From</dt><dd>${esc(w.name)} · ${esc(shortAddr(w.address))}</dd>
          <dt>To</dt><dd class="mono-addr">${esc(v.dest)}${v.destLabel ? `<br><span class="ok">${esc(v.destLabel)}</span>` : ""}</dd>
          <dt>Network</dt><dd class="${v.cluster === "mainnet-beta" ? "warn" : ""}">${netName}</dd>
          <dt>Network fee</dt><dd>${esc(fmtUnits(BigInt(v.prep.fee), 9))} SOL <span class="dim small">(${v.prep.units.toLocaleString("en-US")} CU · priority ${v.prep.cuPrice.toLocaleString("en-US")} µlamports/CU)</span></dd>
          ${v.rent ? `<dt>Account rent</dt><dd>${esc(fmtUnits(BigInt(v.rent), 9))} SOL <span class="dim small">creates the recipient's token account</span></dd>` : ""}
          <dt>Total SOL out</dt><dd><b>${esc(fmtUnits(BigInt(solOut), 9))} SOL</b></dd>
          <dt>Simulation</dt><dd class="ok">passed</dd>
        </dl></div>
        ${info.map((t) => `<div class="note ok-note" style="margin-top:8px">${esc(t)}</div>`).join("")}
        ${warn.map((t) => `<div class="alert warnc" style="margin-top:8px"><p style="margin:0;color:var(--bone)">⚠ ${esc(t)}</p></div>`).join("")}
        ${v.cluster === "mainnet-beta" ? `<div class="note warn" style="margin-top:8px">Real funds on mainnet. Transfers cannot be undone. Unaudited software.</div>` : ""}
        ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
        <div class="grid2" style="margin-top:10px"><button class="btn" data-a="ws-edit">Edit</button><button class="btn primary ${warn.length ? "warnb" : ""}" data-a="ws-go">Confirm &amp; send</button></div>`;
    }
    if (v.stage === "sending") return `${head}<div class="panel stack"><div>Signing and sending ${esc(amt)}…</div><div class="bar indet"><i></i></div></div>`;
    return `${head}<div class="alert okc"><div class="t">✓ SENT</div><div class="big">${esc(amt)}</div><p>to ${esc(shortAddr(v.dest))}${v.destLabel ? ` (${esc(v.destLabel)})` : ""}, confirmed.</p>
        <button class="link" data-a="open" data-arg="${esc(explorerTx(v.sig!, v.cluster))}">${esc(v.sig!.slice(0, 16))}… ↗</button></div>
      <button class="btn primary block" style="margin-top:10px" data-a="home">Done</button>`;
  },
  () => {
    const v = sv();
    const w = app.data.wallets.find((x) => x.id === v.walletId);
    if (w && v.stage === "form" && !holdingsOf(v)) void loadHoldings(w.address, v.cluster);
  }
);

function readForm(): void {
  const v = sv();
  const f = document.querySelector<HTMLFormElement>("form[data-a='ws-form']");
  if (!f) return;
  const fd = new FormData(f);
  v.mint = String(fd.get("asset") ?? v.mint);
  const a = String(fd.get("amount") ?? "").trim();
  if (a.toLowerCase() !== "max") {
    v.amount = a;
    v.max = false;
  }
  v.dest = String(fd.get("dest") ?? "").trim();
}

on({
  "ws-max": () => {
    readForm();
    const v = sv();
    v.max = true;
    render();
  },
  "ws-to": (el) => {
    readForm();
    sv().dest = el.dataset.arg!;
    render();
  },
  "ws-edit": () => {
    const v = sv();
    v.stage = "form";
    v.prep = null;
    v.err = "";
    render();
  },
  "ws-form": async () => {
    readForm();
    const v = sv();
    v.err = "";
    v.busy = true;
    render();
    try {
      await reviewSend(v);
      v.stage = "review";
    } catch (e) {
      v.err = errText(e);
    }
    v.busy = false;
    render();
  },
  "ws-go": async () => {
    const v = sv();
    const w = app.data.wallets.find((x) => x.id === v.walletId)!;
    v.err = "";
    try {
      const kp = await walletKp(w.id);
      if (kp.publicKey.toBase58() !== w.address) throw new Error("Key does not match this account");
      v.stage = "sending";
      render();
      v.sig = await signAndSend(walletConn(v.cluster), v.prep!, kp);
      v.stage = "done";
      invalidate(w.address, v.cluster);
      void send({ type: "refresh" }).catch(() => {});
    } catch (e) {
      v.stage = "review";
      const m = errText(e);
      v.err = /Blockhash not found|block height exceeded|expired/i.test(m) ? "The review expired before it was sent (nothing was sent). Press Edit, then Review again." : m;
    }
    render();
  },
});

/** Validates the form, checks the recipient, builds and simulates the transaction. */
async function reviewSend(v: SendView): Promise<void> {
  const w = app.data.wallets.find((x) => x.id === v.walletId)!;
  if (v.dest.split(/\s+/).length >= 12) {
    v.dest = "";
    throw new Error("That looks like a phrase. Never paste it into an address field.");
  }
  const toStr = parseAddress(v.dest);
  if (!toStr) throw new Error("That is not a Solana address.");
  // fresh balances: the review must match the chain
  const h = await loadHoldings(w.address, v.cluster, true);
  const asset = h.res?.holdings.find((x) => x.mint === v.mint);
  if (!asset) throw new Error(h.err ?? "That asset is no longer in this wallet.");
  const conn = walletConn(v.cluster);
  const from = new PublicKey(w.address);
  const to = new PublicKey(toStr);
  const ref: AssetRef = { mint: asset.mint, decimals: asset.decimals, program: asset.program, account: asset.account || undefined };
  const have = BigInt(asset.accountRaw);
  // a "max" SOL send is first simulated with half the balance (to learn the exact fee), then rebuilt
  let units = v.max ? (asset.program === "sol" ? have / 2n : have) : parseUnits(v.amount, asset.decimals);
  if (units <= 0n) throw new Error("Enter an amount above 0.");
  if (!v.max && units > have) throw new Error(`You have ${fmtUnits(have, asset.decimals)} ${asset.symbol}${asset.raw !== asset.accountRaw ? " in one token account" : ""}.`);
  const own = app.data.watched.find((x) => x.address === toStr && !!x.accountId);
  const devnetSide = v.cluster === "devnet";
  const facts = await recipientFacts(conn, from, to, !!own && devnetSide, async (k) => (devnetSide ? !!(await fetchState(programFor("devnet"), k)) : false));
  let rent = 0;
  const legs: TransferLeg[] = [{ asset: ref, amount: units }];
  if (asset.program !== "sol") {
    const need = await ataNeeds(conn, ref, to);
    legs[0].createAta = need.create;
    rent = need.rent;
  }
  let prep = await prepare(conn, from, transferIxs(from, to, legs), { mainnet: v.cluster === "mainnet-beta", rent });
  if (v.max && asset.program === "sol") {
    // everything minus the exact fee: the account ends at 0 (allowed), never between 0 and the rent minimum
    units = BigInt(asset.accountRaw) - BigInt(prep.fee);
    if (units <= 0n) throw new Error("Not enough SOL to cover the network fee.");
    legs[0].amount = units;
    prep = await prepare(conn, from, transferIxs(from, to, legs), { mainnet: v.cluster === "mainnet-beta", rent, cuPrice: prep.cuPrice, units: prep.units });
  } else if (asset.program === "sol") {
    const left = BigInt(asset.accountRaw) - units - BigInt(prep.fee);
    if (left < 0n) throw new Error("Not enough SOL for this amount plus the network fee. Use Max.");
    if (left > 0n && left < BigInt(RENT_EMPTY)) throw new Error(`That would leave ${fmtUnits(left, 9)} SOL, below the rent minimum (0.00089 SOL). Use Max to send everything, or send a little less.`);
  } else if (h.res!.lamports < prep.fee + rent) throw new Error(`This needs ${fmtUnits(BigInt(prep.fee + rent), 9)} SOL for the fee${rent ? " and the recipient's token account" : ""}; the wallet has ${fmtUnits(BigInt(h.res!.lamports), 9)} SOL.`);
  const check = checkRecipient(facts, ref, units);
  if (check.error) throw new Error(check.error);
  v.check = check;
  v.prep = prep;
  v.units = units;
  v.rent = rent;
  v.dest = toStr;
  v.snap = { symbol: asset.symbol, decimals: asset.decimals, price: asset.price, program: asset.program };
  v.destLabel = own ? `your vault "${own.label || shortAddr(own.address)}"` : facts.isVault ? "a Noxvault vault (not yours)" : app.data.wallets.find((x) => x.address === toStr)?.name;
}

// ---------- Protect: create a vault paid by this wallet ----------

on({
  "w-protect": () => {
    const w = activeWallet();
    if (!w || w.kind === "watch") return toast("Choose a wallet with a key to protect.");
    go({ name: "protect", walletId: w.id });
  },
});

defineView(
  "protect",
  () => {
    const v = app.view;
    const w = app.data.wallets.find((x) => x.id === v.walletId);
    if (!w) return back("Home", "home");
    const mainnet = net() === "mainnet-beta";
    const dev = holds.get(hkey(w.address, "devnet"))?.res;
    const devSol = dev ? dev.lamports : null;
    const low = devSol != null && devSol < 0.03 * LAMPORTS_PER_SOL;
    return `${back("Home", "home")}<div class="h">Protect ${esc(w.name)} <span class="grow"></span></div>
      <div class="expo t-warn"><div class="t">⚛ WHY</div><div class="expo-h">A wallet's address is its public key.</div>
        <div class="muted small">A large enough quantum computer could compute the private key from it and take everything. A Noxvault vault has no such key: every withdrawal needs a hash-based one-time signature from your phrase, checked on chain, plus the rules you pick (delay, whitelist, recovery phrase).</div></div>
      <ol class="steps pro" style="margin-top:10px">
        <li><span class="dot"></span><span>Pick a preset (Personal, Anti-theft, Team…)</span></li>
        <li><span class="dot"></span><span>Your phrase builds the vault's one-time keys</span></li>
        <li><span class="dot"></span><span>${esc(w.name)} pays the creation fee + rent and initializes it (no relayer)</span></li>
        <li><span class="dot"></span><span>Move SOL / tokens from ${esc(w.name)} into the vault</span></li>
      </ol>
      ${
        mainnet
          ? `<div class="alert warnc" style="margin-top:10px"><div class="t">DEVNET ONLY FOR NOW</div><p>Noxvault is not live on mainnet yet. The vault is created on devnet, paid with this same address's devnet SOL. Your mainnet funds are not touched.</p><button class="btn block" data-a="protect-devnet">Switch the wallet view to devnet</button></div>`
          : ""
      }
      <div class="panel" style="margin-top:10px"><dl class="kv"><dt>Devnet balance</dt><dd class="${low ? "warn" : ""}">${devSol == null ? "…" : `${fmtUnits(BigInt(devSol), 9, 4)} SOL`}</dd><dt>Needed</dt><dd>≈ 0.02 SOL + what you move</dd></dl>
        ${low ? `<div class="note warn" style="margin-top:8px">Fund ${esc(shortAddr(w.address))} with devnet SOL first (faucet.solana.com, or send from another devnet wallet).</div><button class="btn ghost block" data-a="copy" data-arg="${esc(w.address)}">Copy address</button>` : ""}</div>
      <button class="btn primary block" style="margin-top:10px" data-a="protect-go" ${low || devSol == null ? "disabled" : ""}>Choose a preset →</button>
      <div class="dim small" style="margin-top:6px">devnet · unaudited · test SOL only</div>`;
  },
  () => {
    const v = app.view;
    const w = app.data.wallets.find((x) => x.id === v.walletId);
    if (w && !v.loaded) {
      v.loaded = true;
      void loadHoldings(w.address, "devnet", true);
    }
  }
);

/** The wallet that "Protect it" started from; the create flow picks it up. */
export let protectFrom: string | null = null;
export const takeProtect = () => {
  const p = protectFrom;
  protectFrom = null;
  return p;
};

on({
  "protect-devnet": async () => {
    app.data.settings = { ...app.data.settings, walletCluster: "devnet" };
    await save({ settings: app.data.settings });
    render();
  },
  "protect-go": () => {
    if (!app.unlocked) return go({ name: "lock", next: { name: "protect", walletId: app.view.walletId } });
    protectFrom = app.view.walletId;
    // the vault's wallet pays from its own phrase's account when possible: show that phrase's vaults
    return handler("create-start")!(document.body, new Event("protect"));
  },
});

// ---------- move funds from a wallet into a vault ----------

interface MoveRow {
  mint: string;
  symbol: string;
  name: string;
  logo?: string;
  decimals: number;
  program: Holding["program"];
  account: string;
  have: string;
  amount: string;
  on: boolean;
}
interface MoveView {
  name: "wmove";
  key: string;
  walletId: string;
  stage: "loading" | "form" | "review" | "sending" | "done";
  rows?: MoveRow[];
  lamports?: number;
  plan?: { legs: TransferLeg[]; prep: Prepared }[];
  sigs?: string[];
  err?: string;
  busy?: boolean;
  fresh?: boolean;
  initSig?: string;
}
const mv =() => app.view as unknown as MoveView;

on({
  "wmove-start": (el) => {
    const w = activeWallet();
    const payer = w && w.kind !== "watch" ? w : app.data.wallets.find((x) => x.kind !== "watch");
    if (!payer) return toast("Add a wallet account first.");
    if (!app.unlocked) return go({ name: "lock", next: { name: "vault", key: el.dataset.arg } });
    go({ name: "wmove", key: el.dataset.arg, walletId: payer.id, stage: "loading", fresh: el.dataset.fresh === "1" } as never);
  },
});

export function startMove(key: string, walletId: string, fresh: boolean, initSig?: string) {
  go({ name: "wmove", key, walletId, stage: "loading", fresh, initSig } as never);
}

async function loadMove(v: MoveView) {
  const w = app.data.wallets.find((x) => x.id === v.walletId)!;
  const h = await loadHoldings(w.address, "devnet", true);
  if (app.view !== (v as never)) return;
  if (!h.res) {
    v.err = h.err ?? "Could not read the wallet";
    v.stage = "form";
    v.rows = [];
    return render();
  }
  const toks = h.res.holdings.filter((x) => x.program !== "sol" && BigInt(x.accountRaw) > 0n && !x.spam);
  const solMax = Math.max(0, h.res.lamports - KEEP_FOR_FEES - toks.length * 2_100_000);
  v.lamports = h.res.lamports;
  v.rows = h.res.holdings
    .filter((x) => x.program === "sol" || (BigInt(x.accountRaw) > 0n && !x.spam))
    .map((x) => ({
      mint: x.mint,
      symbol: x.symbol,
      name: x.name,
      logo: x.logo,
      decimals: x.decimals,
      program: x.program,
      account: x.account,
      have: x.accountRaw,
      amount: x.program === "sol" ? unitsToInput(BigInt(solMax), 9) : unitsToInput(x.accountRaw, x.decimals),
      on: x.program === "sol" ? solMax > 0 : true,
    }));
  v.stage = "form";
  render();
}

defineView(
  "wmove",
  () => {
    const v = mv();
    const vault = findVault(v.key);
    const w = app.data.wallets.find((x) => x.id === v.walletId);
    if (!vault || !w) return back("Home", "home");
    const head = `${back(vault.label || "Vault", "detail", v.key)}<div class="h">Deposit from wallet <span class="grow"></span></div>
      ${v.fresh && v.stage !== "done" ? `<div class="alert okc" style="margin-bottom:8px"><div class="t">✓ VAULT CREATED</div><p style="margin:4px 0 0">Paid by ${esc(w.name)}. Now move funds in: from here on they need your one-time keys and the vault's rules to leave.</p>${v.initSig ? `<button class="link" data-a="open" data-arg="${esc(explorerTx(v.initSig, "devnet"))}" id="init-sig" data-sig="${esc(v.initSig)}">init ${esc(v.initSig.slice(0, 12))}… ↗</button>` : ""}</div>` : ""}
      <div class="row between small" style="margin-bottom:8px"><span><span class="dim">from</span> ${esc(w.name)} ${esc(shortAddr(w.address))}</span><span><span class="dim">to</span> ${esc(vault.label || shortAddr(vault.address))}</span></div>`;
    if (v.stage === "loading") return `${head}<div class="panel dim">Reading ${esc(w.name)}'s devnet balances…</div>`;
    if (v.stage === "form") {
      const rows = (v.rows ?? [])
        .map(
          (r, i) => `<div class="mvrow"><label class="check"><input type="checkbox" data-a="mv-on" data-i="${i}" ${r.on ? "checked" : ""}/></label>${avatar(r.symbol, r.logo)}
          <div class="grow1"><div class="tk-name">${esc(r.symbol)} <span class="dim small">have ${esc(fmtUnits(r.have, r.decimals, shownDecimals(r.decimals)))}</span></div>
          <input type="text" class="mvamt" data-i="${i}" value="${esc(r.amount)}" inputmode="decimal" ${r.on ? "" : "disabled"}/></div></div>`
        )
        .join("");
      return `${head}<div class="panel stack">${rows || `<div class="dim">This wallet holds nothing on devnet.</div>`}</div>
        <div class="dim small" style="margin-top:6px">Pre-filled with your balances. SOL keeps ${fmtUnits(BigInt(KEEP_FOR_FEES), 9)} SOL back for fees${(v.rows ?? []).length > 1 ? " and the vault's token accounts (rent ≈ 0.002 SOL each)" : ""}.</div>
        ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
        <button class="btn primary block" style="margin-top:10px" data-a="mv-review" ${v.busy ? "disabled" : ""}>${v.busy ? "Simulating…" : "Review deposit"}</button>`;
    }
    if (v.stage === "review" || v.stage === "sending") {
      const legs = (v.plan ?? []).flatMap((p) => p.legs);
      const fees = (v.plan ?? []).reduce((n, p) => n + p.prep.fee, 0);
      const rent = (v.plan ?? []).reduce((n, p) => n + p.prep.rent, 0);
      return `${head}<div class="panel"><dl class="kv wide">${legs
        .map((l) => {
          const r = v.rows!.find((x) => x.mint === l.asset.mint)!;
          return `<dt>${esc(r.symbol)}</dt><dd><b>${esc(fmtUnits(l.amount, r.decimals))}</b>${l.createAta ? ` <span class="dim small">+ creates the vault's token account</span>` : ""}</dd>`;
        })
        .join("")}
        <dt>Network fees</dt><dd>${esc(fmtUnits(BigInt(fees), 9))} SOL · ${v.plan!.length} transaction${v.plan!.length > 1 ? "s" : ""}</dd>
        ${rent ? `<dt>Token accounts</dt><dd>${esc(fmtUnits(BigInt(rent), 9))} SOL rent (held by the vault's token accounts)</dd>` : ""}
        <dt>Simulation</dt><dd class="ok">passed</dd></dl></div>
        <div class="note" style="margin-top:8px">Into your vault ${esc(vault.address)} on devnet. Afterwards these funds need your one-time keys and follow the vault's rules.</div>
        ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
        <div class="grid2" style="margin-top:10px"><button class="btn" data-a="mv-edit" ${v.stage === "sending" ? "disabled" : ""}>Edit</button><button class="btn primary" data-a="mv-go" ${v.stage === "sending" ? "disabled" : ""}>${v.stage === "sending" ? "Sending…" : "Confirm & move"}</button></div>
        ${v.sigs?.length ? `<div class="dim small" style="margin-top:6px">${v.sigs.length} of ${v.plan!.length} confirmed</div>` : ""}`;
    }
    return `${head}<div class="alert okc" id="move-done"><div class="t">✓ MOVED INTO THE VAULT</div><p>${(v.sigs ?? []).length} transaction${(v.sigs ?? []).length > 1 ? "s" : ""} confirmed.</p>
        ${(v.sigs ?? []).map((s) => `<button class="link" data-a="open" data-arg="${esc(explorerTx(s, "devnet"))}">${esc(s.slice(0, 16))}… ↗</button>`).join("<br>")}</div>
      <button class="btn primary block" style="margin-top:10px" data-a="detail" data-arg="${esc(v.key)}">Open vault</button>`;
  },
  () => {
    const v = mv();
    if (v.stage === "loading" && !(v as unknown as { started?: boolean }).started) {
      (v as unknown as { started?: boolean }).started = true;
      void loadMove(v);
    }
  }
);

document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (app.view.name !== "wmove" || !el.classList.contains("mvamt")) return;
  const r = mv().rows?.[Number(el.dataset.i)];
  if (r) r.amount = el.value;
});

on({
  "mv-on": (el) => {
    const r = mv().rows?.[Number(el.dataset.i)];
    if (r) r.on = (el as HTMLInputElement).checked;
    render();
  },
  "mv-edit": () => {
    const v = mv();
    v.stage = "form";
    v.plan = undefined;
    v.err = "";
    render();
  },
  "mv-review": async () => {
    const v = mv();
    v.err = "";
    v.busy = true;
    render();
    try {
      await planMove(v);
      v.stage = "review";
    } catch (e) {
      v.err = errText(e);
    }
    v.busy = false;
    render();
  },
  "mv-go": async () => {
    const v = mv();
    const w = app.data.wallets.find((x) => x.id === v.walletId)!;
    const vault = findVault(v.key)!;
    v.err = "";
    v.stage = "sending";
    v.sigs = [];
    render();
    try {
      const kp = await walletKp(w.id);
      if (kp.publicKey.toBase58() !== w.address) throw new Error("Key does not match this account");
      for (const p of v.plan!) {
        v.sigs.push(await signAndSend(walletConn("devnet"), p.prep, kp));
        render();
      }
      v.stage = "done";
      invalidate(w.address, "devnet");
      void send({ type: "refresh", only: [watchKey(vault)] }).catch(() => {});
    } catch (e) {
      const m = errText(e);
      v.err = `${v.sigs.length ? `${v.sigs.length} of ${v.plan!.length} transactions went through; ` : ""}${/Blockhash not found|expired/i.test(m) ? "the review expired. Press Edit and review again." : m}`;
      v.stage = v.sigs.length ? "done" : "review";
    }
    render();
  },
});

async function planMove(v: MoveView): Promise<void> {
  const w = app.data.wallets.find((x) => x.id === v.walletId)!;
  const vault = findVault(v.key)!;
  const conn = walletConn("devnet");
  const from = new PublicKey(w.address);
  const to = new PublicKey(vault.address);
  const legs: TransferLeg[] = [];
  for (const r of v.rows ?? []) {
    if (!r.on || !r.amount.trim()) continue;
    const units = parseUnits(r.amount, r.decimals);
    if (units === 0n) continue;
    if (units > BigInt(r.have)) throw new Error(`${r.symbol}: you have ${fmtUnits(r.have, r.decimals)}.`);
    const ref: AssetRef = { mint: r.mint, decimals: r.decimals, program: r.program, account: r.account || undefined };
    const leg: TransferLeg = { asset: ref, amount: units };
    if (r.program !== "sol") leg.createAta = (await ataNeeds(conn, ref, to)).create;
    legs.push(leg);
  }
  if (!legs.length) throw new Error("Choose at least one amount above 0.");
  const plan: { legs: TransferLeg[]; prep: Prepared }[] = [];
  for (const part of packLegs(legs)) {
    let rent = 0;
    for (const l of part) if (l.createAta) rent += (await ataNeeds(conn, l.asset, to)).rent;
    plan.push({ legs: part, prep: await prepare(conn, from, transferIxs(from, to, part), { mainnet: false, rent }) });
  }
  const solOut = legs.filter((l) => l.asset.program === "sol").reduce((n, l) => n + Number(l.amount), 0);
  const cost = plan.reduce((n, p) => n + p.prep.fee + p.prep.rent, 0);
  const left = (v.lamports ?? 0) - solOut - cost;
  if (left < 0) throw new Error(`Not enough SOL: fees and token accounts need ${fmtUnits(BigInt(cost), 9)} SOL. Move less SOL.`);
  if (left > 0 && left < RENT_EMPTY) throw new Error("That would leave the wallet below the rent minimum (0.00089 SOL). Move a little less SOL.");
  v.plan = plan;
}

document.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (app.view.name === "wsend" && el.name === "asset") {
    readForm();
    sv().max = false;
    render();
  }
});
