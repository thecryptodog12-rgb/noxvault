// UI core shared by every view: app state, router, event registry, small DOM helpers, and the chain
// context (connection, program, relayer info, the signer of an owned vault). Plain DOM, no framework.
import { Connection, PublicKey, type Keypair } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { DURESS_TREE, inSlot, vaultTier, type Noxvault, type Signer, type TierView } from "../../../sdk/client";
import { readProgram } from "../../../sdk/integrate";
import type { RelayerInfo } from "../../../web/lib/unlock";
import { feeKeypair } from "../core/feeAccount";
import { fetchRelayerInfo } from "../core/relayer";
import { masterFor, readUnlocked, touch } from "../core/session";
import { getSigner } from "../core/trees";
import { connection } from "../lib/chain";
import { rpcFor } from "../lib/net";
import { load, type AccountMeta, type StoreShape } from "../lib/store";
import { watchKey, type ClusterId, type Watched } from "../lib/types";

export type Data = Pick<StoreShape, "watched" | "settings" | "status" | "accounts" | "activeAccount" | "keyring">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type View = { name: string; [k: string]: any };

export const app = {
  data: null as unknown as Data,
  unlocked: false,
  view: { name: "boot" } as View,
  /** Opened as a full tab (popup.html?tab=1) instead of the toolbar popup. */
  tab: new URLSearchParams(location.search).get("tab") === "1",
};

// ---------- helpers ----------

export const now = () => Math.floor(Date.now() / 1000);
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const solNum = (lamports: number | bigint) => (Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 6 });
export const ago = (t: number) => {
  const s = now() - t;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
};
export const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return /429|rate l|Too Many/i.test(m) ? "The RPC is busy (rate limited). Try again in a moment, or set your own RPC in Settings." : m;
};

const $toast = () => document.getElementById("toast")!;
export function toast(msg: string) {
  const t = $toast();
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => (t.hidden = true), 2200);
}

export function openUrl(url: string) {
  void chrome.tabs.create({ url });
}

export function send<T = { ok: boolean; error?: string }>(msg: unknown): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

/** Opens the same view in a full browser tab (long flows: create a vault). */
export function expandToTab(hash = "") {
  openUrl(chrome.runtime.getURL(`popup.html?tab=1${hash ? `#${hash}` : ""}`));
  if (!app.tab) window.close();
}

export const back = (label: string, act: string, arg = "") =>
  `<button class="btn ghost back" data-a="${esc(act)}" data-arg="${esc(arg)}">← ${esc(label)}</button>`;

export function stepsHtml(steps: { label: string; st: string; sig?: string }[], cluster: ClusterId): string {
  if (!steps.length) return "";
  return `<ol class="steps">${steps
    .map(
      (s) => `<li class="st-${esc(s.st)}"><span class="dot"></span><span>${esc(s.label)}</span>${
        s.sig ? `<button class="link" data-a="open-tx" data-arg="${esc(s.sig)}" data-cluster="${esc(cluster)}">tx ↗</button>` : ""
      }</li>`
    )
    .join("")}</ol>`;
}

export function txUrl(sig: string, cluster: ClusterId, customRpc = ""): string {
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(sig)}`;
  return cluster === "mainnet-beta" ? base : cluster === "devnet" ? `${base}?cluster=devnet` : `${base}?cluster=custom&customUrl=${encodeURIComponent(customRpc)}`;
}

// ---------- router ----------

type Renderer = () => string;
type Handler = (el: HTMLElement, ev: Event) => void | Promise<void>;
const views = new Map<string, Renderer>();
const afters = new Map<string, () => void>();
const handlers = new Map<string, Handler>();

export function defineView(name: string, render: Renderer, after?: () => void) {
  views.set(name, render);
  if (after) afters.set(name, after);
}
export function on(map: Record<string, Handler>) {
  for (const [k, f] of Object.entries(map)) handlers.set(k, f);
}
export const handler = (name: string) => handlers.get(name);

let rendering = false;
export function render() {
  if (rendering) return;
  rendering = true;
  try {
    const $v = document.getElementById("view")!;
    const r = views.get(app.view.name);
    $v.innerHTML = r ? r() : `<div class="panel">Unknown view ${esc(app.view.name)}</div>`;
    afters.get(app.view.name)?.();
    tick();
    document.body.dataset.view = app.view.name;
    paintHeader();
  } finally {
    rendering = false;
  }
}

export function go(v: View) {
  // Leaving a view drops its transient state (and any secret the view held).
  wipeView(app.view);
  app.view = v;
  document.getElementById("view")!.scrollTop = 0;
  render();
}

/** Zeroes byte arrays a view kept (masters, seeds) and drops references. */
export function wipeView(v: View) {
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (x instanceof Uint8Array) x.fill(0);
    if (x && typeof x === "object" && "seeds" in x && x.seeds?.skSeed instanceof Uint8Array) x.seeds.skSeed.fill(0);
  }
}

export function tick() {
  const t = now();
  for (const el of document.querySelectorAll<HTMLElement>("[data-at]")) el.textContent = countdownText(Number(el.dataset.at) - t);
}

function countdownText(secs: number): string {
  if (secs <= 0) return "now";
  const d = Math.floor(secs / 86_400), h = Math.floor((secs % 86_400) / 3600), m = Math.floor((secs % 3600) / 60), x = Math.floor(secs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(x)}s`;
  return `${m}m ${pad(x)}s`;
}

function paintHeader() {
  const c = app.data?.settings.cluster ?? "devnet";
  const pill = document.getElementById("net-pill");
  if (pill) pill.textContent = `${c === "mainnet-beta" ? "mainnet" : c === "custom" ? "custom" : "devnet"} · unaudited`;
  const lockBtn = document.getElementById("lock-btn");
  if (lockBtn) lockBtn.hidden = !app.unlocked;
  const exp = document.getElementById("expand-btn");
  if (exp) exp.hidden = app.tab;
}

// ---------- data ----------

export async function reload() {
  app.data = await load("watched", "settings", "status", "accounts", "activeAccount", "keyring");
  app.unlocked = !!(await readUnlocked());
}

export const activeAccount = (): AccountMeta | undefined => app.data.accounts.find((a) => a.id === app.data.activeAccount) ?? app.data.accounts[0];
export const findVault = (key: string): Watched | undefined => app.data.watched.find((w) => watchKey(w) === key);

let lastTouch = 0;
/** Keeps the auto-lock timer fresh while the user works (at most every 20 s). */
export function activity() {
  if (!app.unlocked || Date.now() - lastTouch < 20_000) return;
  lastTouch = Date.now();
  void touch();
}

// ---------- chain ----------

export function rpcOf(cluster: ClusterId): string {
  return rpcFor(cluster, app.data.settings.customRpc);
}

const programs = new Map<string, Program<Noxvault>>();
export function programFor(cluster: ClusterId): Program<Noxvault> {
  const rpc = rpcOf(cluster);
  let p = programs.get(rpc);
  if (!p) {
    p = readProgram(connection(rpc));
    programs.set(rpc, p);
  }
  return p;
}
export const connFor = (cluster: ClusterId): Connection => connection(rpcOf(cluster));

/** Signing is only offered where the program and the relayer run. */
export function signingProblem(cluster: ClusterId): string | null {
  if (cluster === "mainnet-beta") return "Noxvault is not live on mainnet yet. Switch to devnet in settings.";
  return null;
}

let relayerCache: { info: RelayerInfo | null; err: string | null; at: number } | null = null;
export async function relayerInfo(): Promise<{ info: RelayerInfo | null; err: string | null }> {
  if (relayerCache && Date.now() - relayerCache.at < 5 * 60_000 && relayerCache.info) return relayerCache;
  try {
    relayerCache = { info: await fetchRelayerInfo(), err: null, at: Date.now() };
  } catch (e) {
    relayerCache = { info: null, err: errText(e), at: Date.now() };
  }
  return relayerCache;
}

export async function tierOf(cluster: ClusterId, vault: PublicKey): Promise<TierView | null> {
  try {
    return await vaultTier(programFor(cluster), vault);
  } catch {
    return null;
  }
}

/** The unlocked master of an account; throws "locked" if the wallet locked meanwhile. Caller zeroes it. */
export async function needMaster(accountId: string): Promise<Uint8Array> {
  const m = await masterFor(accountId, app.data.settings.autoLockMin);
  if (!m) {
    app.unlocked = false;
    throw new Error("The wallet is locked. Unlock it and try again.");
  }
  return m;
}

export async function feeAccountOf(accountId: string): Promise<Keypair> {
  const m = await needMaster(accountId);
  try {
    return feeKeypair(m);
  } finally {
    m.fill(0);
  }
}

/** The signer (one-time key tree) this extension holds for an owned vault. Cached tree; a few seconds on first use. */
export async function signerOf(w: Watched, onProgress?: (d: number, t: number) => void): Promise<Signer> {
  if (!w.accountId || w.vaultNumber == null) throw new Error("This vault is watch-only: no phrase of yours signs for it.");
  const m = await needMaster(w.accountId);
  try {
    const slot = w.slot ?? 0;
    if (slot === DURESS_TREE) return await getSigner(m, w.vaultNumber, DURESS_TREE, onProgress);
    return inSlot(await getSigner(m, w.vaultNumber, 0, onProgress), slot);
  } finally {
    m.fill(0);
  }
}

export const pk = (s: string) => new PublicKey(s);
