// Send / cancel / co-sign: one view that drives src/core/signing.ts (the port of the site's
// ActionPanel). Stages: loading (tree + full history) → form (send) → review (preflight; the action
// is frozen for one one-time key) → sending → done. A recovery phrase typed for a cancel is used
// for that one action and wiped from memory when the view closes.
import { PublicKey } from "@solana/web3.js";
import {
  DURESS_TREE,
  RECOVERY_TREE,
  SOL_MINT,
  TIER_SENTINEL,
  explainError,
  fetchState,
  keysLeft,
  mintTokenProgram,
  treeOf,
  vaultApprovals,
  wordsToSecret,
  type Signer,
  type VaultStateView,
} from "../../../sdk/client";
import { equal, type Action } from "../../../sdk/wots";
import { fromBaseUnits, toBaseUnits } from "../../../web/lib/format";
import { describeAction, type RelayerInfo, type VaultAssets } from "../../../web/lib/unlock";
import { keypairSender } from "../core/feeAccount";
import { PendingStore } from "../core/pendingStore";
import { relayAction } from "../core/relayer";
import { discard, feeFor, loadHistory, maxAmount, prepare, relayerOk, sendFrozen, type Ctx, type FeeDeps, type Frozen, type Mode, type Preflight, type Step } from "../core/signing";
import { offWhitelist, withdrawTiming } from "../core/timing";
import { buildSignerUncached } from "../core/trees";
import { vaultAssets } from "../../../web/lib/unlock";
import { shortAddr } from "../lib/net";
import { watchKey, type Watched } from "../lib/types";
import { app, back, connFor, defineView, errText, esc, findVault, go, now, on, payerOf, programFor, relayerInfo, render, send, signerOf, signingProblem, solNum, stepsHtml, tierOf, toast } from "./core";

type Purpose = "send" | "cancel" | "cosign";
type Stage = "choose" | "phrase" | "loading" | "blocked" | "form" | "review" | "sending" | "done";

interface SignView {
  name: "sign";
  key: string;
  purpose: Purpose;
  stage: Stage;
  loadingText?: string;
  progress?: [number, number];
  err?: string;
  note?: string;
  // chain
  signer?: Signer | null;
  state?: VaultStateView;
  assets?: VaultAssets | null;
  leaf?: number;
  frozen?: Frozen | null;
  relayer?: RelayerInfo | null;
  relayerErr?: string | null;
  sentinelFree?: boolean;
  feeAddress?: string | null;
  feeBalance?: number | null;
  feeName?: string | null;
  // form
  asset: string;
  amount: string;
  dest: string;
  mode: Mode;
  preset?: Action | null;
  // review
  pre?: Preflight | null;
  consent?: boolean;
  draft?: { action: Action; tokenProgram?: PublicKey } | null;
  steps?: Step[];
  sendErr?: string;
  done?: string;
  executed?: boolean;
  after?: VaultStateView | null;
  recN?: string;
}

const sv = () => app.view as unknown as SignView;
const store = new PendingStore();
/** Below this much devnet SOL the wallet does not pay; the relayer does (the vault repays it). */
const WALLET_PAYS_MIN = 5_000_000;

function ctxOf(v: SignView): Ctx {
  const w = findVault(v.key)!;
  return { program: programFor(w.cluster), vault: new PublicKey(w.address), signer: v.signer!, store };
}

function feeDeps(v: SignView): FeeDeps {
  return {
    relayer: v.relayer ?? null,
    relayerErr: v.relayerErr,
    feePayer: v.feeAddress ? new PublicKey(v.feeAddress) : null,
    sentinelFree: !!v.sentinelFree,
    state: v.state!,
    tree: v.signer!.tree,
  };
}

function base(key: string, purpose: Purpose, stage: Stage, extra: Partial<SignView> = {}): SignView {
  return { name: "sign", key, purpose, stage, asset: SOL_MINT.toBase58(), amount: "", dest: "", mode: "relayer", ...extra };
}

// ---------- entry points ----------

on({
  "send-start": (el) => start(el.dataset.arg!, "send"),
  "cancel-start": (el) => {
    const key = el.dataset.arg!;
    const w = findVault(key);
    const snap = app.data.status[key]?.snap;
    const hasRecovery = snap?.rules.recoveryDelay != null;
    const ownerCan = !!w?.accountId && w.slot != null && w.slot < RECOVERY_TREE;
    if (w && signingProblem(w.cluster)) return toast(signingProblem(w.cluster)!);
    if (hasRecovery && !ownerCan) return go(base(key, "cancel", "phrase", { recN: String(w?.vaultNumber ?? 0) }) as never);
    if (!hasRecovery && ownerCan) return start(key, "cancel");
    if (!hasRecovery) return toast("This vault has no recovery key, and no phrase in this extension signs for it.");
    go(base(key, "cancel", "choose", { recN: String(w?.vaultNumber ?? 0) }) as never);
  },
  "cosign-start": (el) => start(el.dataset.arg!, "cosign", Number(el.dataset.i)),
  "sign-back": () => {
    const v = sv();
    go({ name: "vault", key: v.key });
  },
  "cancel-recovery": () => {
    const v = sv();
    v.stage = "phrase";
    render();
  },
  "cancel-owner": () => start(sv().key, "cancel"),
});

async function start(key: string, purpose: Purpose, approvalIndex?: number) {
  const w = findVault(key);
  if (!w) return;
  const problem = signingProblem(w.cluster);
  if (problem) return toast(problem);
  if (!app.unlocked) return go({ name: "lock", next: { name: "vault", key } });
  const v = base(key, purpose, "loading", { loadingText: "Building your one-time key tree…" });
  if (approvalIndex != null) {
    const list = await vaultApprovals(programFor(w.cluster), new PublicKey(w.address)).catch(() => []);
    v.preset = list[approvalIndex]?.action ?? null;
    if (!v.preset) return toast("That approval is gone");
  }
  go(v as never);
  try {
    const signer = await signerOf(w, (d, t) => {
      if (app.view !== (v as never)) return;
      v.progress = [d, t];
      render();
    });
    await begin(v, signer);
  } catch (e) {
    v.stage = "blocked";
    v.err = errText(e);
    if (app.view === (v as never)) render();
  }
}

/** Loads history, relayer, tier, fee account; then shows the frozen action, the form, or the review. */
async function begin(v: SignView, signer: Signer) {
  const w = findVault(v.key)!;
  v.signer = signer;
  v.stage = "loading";
  v.loadingText = "Reading this vault's full history…";
  v.progress = undefined;
  render();
  const program = programFor(w.cluster);
  const vault = new PublicKey(w.address);
  const state = await fetchState(program, vault);
  if (!state) throw new Error("This vault is not initialized yet.");
  if (!equal(treeOf(state.config, signer.tree).root, signer.pub.root)) throw new Error("This phrase does not sign for this vault (wrong phrase, vault number or slot).");
  v.state = state;
  const ctx = ctxOf(v);
  const [hist, rel, tier, assets] = await Promise.all([
    loadHistory(ctx, state),
    relayerInfo(),
    tierOf(w.cluster, vault),
    vaultAssets(connFor(w.cluster), vault).catch(() => null),
  ]);
  v.assets = assets;
  v.relayer = rel.info;
  v.relayerErr = rel.err;
  v.sentinelFree = !!tier && tier.tier === TIER_SENTINEL && !!rel.info?.sentinelFree;
  if (w.accountId) {
    try {
      const p = await payerOf(w.accountId);
      v.feeAddress = p.kp.publicKey.toBase58();
      v.feeName = p.wallet.name;
      v.feeBalance = await connFor(w.cluster).getBalance(p.kp.publicKey, "confirmed").catch(() => null);
    } catch {
      v.feeAddress = null;
    }
  }
  // v0.3: the selected wallet account pays when it holds enough SOL; the relayer is the fallback.
  v.mode = v.feeAddress && (v.feeBalance ?? 0) >= WALLET_PAYS_MIN ? "wallet" : rel.info ? "relayer" : "wallet";
  v.note = hist.note;
  if (hist.history.kind !== "ready") {
    v.stage = "blocked";
    v.err =
      hist.history.kind === "error"
        ? `Could not read this vault's transaction history (${hist.history.msg}). Signing is blocked: without it the extension cannot prove a one-time key never signed something else.`
        : hist.history.msg;
    return render();
  }
  v.leaf = hist.history.leaf;
  v.frozen = hist.frozen;
  if (v.frozen) {
    v.mode = v.frozen.mode;
    v.stage = "review";
    return render();
  }
  if (v.purpose === "send") {
    v.stage = "form";
    const wl = state.config.whitelist;
    if (!v.dest && wl.length) v.dest = new PublicKey(wl[0]).toBase58();
    return render();
  }
  // cancel / co-sign: the action is fixed; check it straight away.
  await review(v);
}

// ---------- the form ----------

function buildDraft(v: SignView): Promise<{ action: Action; tokenProgram?: PublicKey }> {
  return (async () => {
    const d = feeDeps(v);
    if (v.purpose === "cosign") return { action: v.preset! };
    if (v.purpose === "cancel") return { action: { kind: "cancel", ...feeFor(v.mode, "cancel", d) } as Action };
    const w = findVault(v.key)!;
    const isSolAsset = v.asset === SOL_MINT.toBase58();
    const holding = isSolAsset ? null : v.assets?.tokens.find((t) => t.mint.toBase58() === v.asset) ?? null;
    if (!isSolAsset && !holding) throw new Error("Pick an asset the vault holds");
    const units = toBaseUnits(v.amount, holding ? holding.decimals : 9);
    if (units <= 0n) throw new Error("Enter an amount above 0");
    let dest: PublicKey;
    try {
      dest = new PublicKey(v.dest.trim());
    } catch {
      throw new Error("Destination is not a valid address");
    }
    const mint = isSolAsset ? SOL_MINT : new PublicKey(v.asset);
    const tokenProgram = isSolAsset ? undefined : await mintTokenProgram(connFor(w.cluster), mint);
    return { action: { kind: "withdraw", mint: mint.toBytes(), dest: dest.toBytes(), amount: units, ...feeFor(v.mode, "withdraw", d) } as Action, tokenProgram };
  })();
}

async function review(v: SignView) {
  v.stage = "loading";
  v.loadingText = "Checking against the vault's rules and history…";
  render();
  try {
    v.draft = await buildDraft(v);
    v.consent = false;
    await runPrepare(v);
  } catch (e) {
    v.stage = v.purpose === "send" ? "form" : "blocked";
    v.err = errText(e);
  }
  if (app.view === (v as never)) render();
}

async function runPrepare(v: SignView) {
  const r = await prepare(ctxOf(v), {
    leaf: v.leaf!,
    action: v.draft!.action,
    preset: v.purpose === "cosign",
    tokenProgram: v.draft!.tokenProgram,
    mode: v.mode,
    deps: feeDeps(v),
    prev: v.pre ?? null,
    consent: !!v.consent,
  });
  v.pre = r.pre;
  if (r.frozen) v.frozen = r.frozen;
  v.stage = "review";
  if (r.reloadHistory) {
    const h = await loadHistory(ctxOf(v), v.state!);
    if (h.history.kind === "ready") {
      v.leaf = h.history.leaf;
      v.frozen = h.frozen;
    }
  }
}

on({
  "sign-form": (form) => {
    const v = sv();
    const fd = new FormData(form as HTMLFormElement);
    v.asset = String(fd.get("asset") ?? v.asset);
    v.amount = String(fd.get("amount") ?? "").trim();
    v.dest = String(fd.get("dest") ?? "").trim();
    v.mode = (String(fd.get("mode") ?? v.mode) as Mode) || v.mode;
    v.err = "";
    void review(v);
  },
  "sign-max": () => {
    const v = sv();
    const form = document.querySelector<HTMLFormElement>("form[data-a='sign-form']");
    if (form) {
      const fd = new FormData(form);
      v.asset = String(fd.get("asset") ?? v.asset);
      v.dest = String(fd.get("dest") ?? v.dest);
      v.mode = String(fd.get("mode") ?? v.mode) as Mode;
    }
    const holding = v.asset === SOL_MINT.toBase58() ? null : v.assets?.tokens.find((t) => t.mint.toBase58() === v.asset) ?? null;
    v.amount = maxAmount(
      { mode: v.mode, relayer: v.relayer ?? null, holding, lamports: v.assets?.lamports ?? 0, isDuress: v.signer?.tree === DURESS_TREE, duressLimit: v.state!.config.duressLimit },
      fromBaseUnits
    );
    render();
  },
  "sign-wl": (el) => {
    const v = sv();
    const form = document.querySelector<HTMLFormElement>("form[data-a='sign-form']");
    if (form) {
      const fd = new FormData(form);
      v.asset = String(fd.get("asset") ?? v.asset);
      v.amount = String(fd.get("amount") ?? v.amount);
      v.mode = String(fd.get("mode") ?? v.mode) as Mode;
    }
    v.dest = el.dataset.arg!;
    render();
  },
  "sign-consent": (el) => {
    sv().consent = (el as HTMLInputElement).checked;
    render();
  },
  "sign-edit": async () => {
    const v = sv();
    if (v.frozen) {
      const r = await discard(ctxOf(v), v.frozen);
      if (!r.ok) {
        v.note = r.note;
        return render();
      }
      v.frozen = null;
    }
    v.pre = null;
    v.stage = v.purpose === "send" ? "form" : "choose";
    if (v.purpose !== "send") return go({ name: "vault", key: v.key });
    render();
  },
  "sign-go": async () => {
    const v = sv();
    v.sendErr = "";
    try {
      if (!v.frozen) {
        await runPrepare(v);
        if (!v.frozen) return render();
      }
      await sendNow(v);
    } catch (e) {
      v.sendErr = explainError(e);
      v.stage = "review";
      render();
    }
  },
});

async function sendNow(v: SignView) {
  const f = v.frozen!;
  const w = findVault(v.key)!;
  if (f.mode === "relayer" && !relayerOk(f, feeDeps(v))) throw new Error(v.relayerErr || "The relayer cannot send this action (fee or payee does not match).");
  let payer: PublicKey | undefined;
  let sender;
  if (f.mode === "wallet") {
    if (!w.accountId) throw new Error("No wallet account pays for this vault");
    const { kp, wallet } = await payerOf(w.accountId);
    // A frozen action names its fee payee only when fee > 0 (relayer); with fee 0 any wallet may pay.
    payer = kp.publicKey;
    sender = keypairSender(kp);
    const bal = await connFor(w.cluster).getBalance(payer, "confirmed");
    if (bal < WALLET_PAYS_MIN) throw new Error(`${wallet.name} (${shortAddr(payer.toBase58())}) holds ${solNum(bal)} devnet SOL; it needs about 0.005 SOL for this (mostly rent it gets back). Fund it, or use the relayer.`);
  }
  v.stage = "sending";
  v.steps = [];
  render();
  const res = await sendFrozen(ctxOf(v), f, f.mode, {
    relay: relayAction,
    payer,
    send: sender,
    onSteps: (s) => {
      v.steps = s;
      if (app.view === (v as never)) render();
    },
  });
  v.done = res.done;
  v.executed = res.executed;
  v.steps = res.steps;
  v.after = await fetchState(programFor(w.cluster), new PublicKey(w.address)).catch(() => null);
  v.stage = "done";
  wipeSigner(v);
  void send({ type: "refresh", only: [watchKey(w)] });
  render();
}

function wipeSigner(v: SignView) {
  if (v.signer && (v.signer.tree === RECOVERY_TREE || v.purpose === "cancel")) {
    v.signer.seeds.skSeed.fill(0);
  }
  v.signer = null;
}

// ---------- recovery phrase for one cancel ----------

on({
  "rec-submit": async (form) => {
    const v = sv();
    const f = form as HTMLFormElement;
    const ta = f.elements.namedItem("words") as HTMLTextAreaElement;
    const words = ta.value;
    ta.value = ""; // never kept in the DOM
    const n = Number(String(new FormData(f).get("n") ?? "0"));
    v.recN = String(n);
    v.err = "";
    let master: Uint8Array | null = null;
    try {
      if (!Number.isInteger(n) || n < 0) throw new Error("Vault number must be 0 or more");
      master = wordsToSecret(words);
      const w = findVault(v.key)!;
      const state = await fetchState(programFor(w.cluster), new PublicKey(w.address));
      if (!state) throw new Error("No initialized Noxvault at this address");
      if (state.config.trees[RECOVERY_TREE].height === 0) throw new Error("This vault has no recovery key");
      v.stage = "loading";
      v.loadingText = "Building the recovery tree (16 keys)…";
      render();
      // Built in the worker WITHOUT the tree cache: nothing about this phrase is stored.
      const signer = await buildSignerUncached(master, n, RECOVERY_TREE, (d, t) => ((v.progress = [d, t]), app.view === (v as never) && render()));
      master.fill(0);
      master = null;
      if (!equal(state.config.trees[RECOVERY_TREE].root, signer.pub.root)) {
        signer.seeds.skSeed.fill(0);
        throw new Error(`This phrase (vault number ${n}) is not the recovery key of ${shortAddr(w.address)}. Check the words, or try another vault number.`);
      }
      await begin(v, signer);
    } catch (e) {
      v.stage = "phrase";
      v.err = errText(e);
      render();
    } finally {
      master?.fill(0);
    }
  },
});

// ---------- render ----------

const solAmt = (lamports: bigint) => `${solNum(lamports)} SOL`;

function actionLines(v: SignView, a: Action): string {
  const w = findVault(v.key)!;
  const rows: [string, string, string?][] = [];
  if (a.kind === "withdraw") {
    const isSolA = equal(a.mint, SOL_MINT.toBytes());
    const holding = isSolA ? null : v.assets?.tokens.find((t) => equal(t.mint.toBytes(), a.mint));
    rows.push(["Amount", isSolA ? solAmt(a.amount) : `${holding ? fromBaseUnits(a.amount, holding.decimals) : a.amount.toString()} of ${shortAddr(new PublicKey(a.mint).toBase58())}`]);
    rows.push(["To", new PublicKey(a.dest).toBase58(), "mono"]);
  } else {
    rows.push(["Action", describeAction(a)]);
  }
  rows.push(["From vault", `${w.label || "Vault"} · ${shortAddr(w.address)}`]);
  const relayerPays = v.relayer && equal(a.feePayee, new PublicKey(v.relayer.relayer).toBytes());
  rows.push([
    "Fee",
    relayerPays
      ? a.fee > 0n
        ? `${solAmt(a.fee)} from the vault to the relayer (no wallet needed)`
        : "free (relayer)"
      : `network fees from ${v.feeName ?? "your wallet"} (${solNum(v.feeBalance ?? 0)} SOL)`,
  ]);
  rows.push(["One-time key", `#${v.frozen?.leaf ?? v.leaf} of ${1 << v.signer!.pub.height}${v.state ? ` · ${keysLeft(v.state, v.signer!.tree)} left` : ""}${v.signer!.tree === RECOVERY_TREE ? " (recovery)" : ""}`]);
  return `<dl class="kv wide">${rows.map(([k, val, cls]) => `<dt>${esc(k)}</dt><dd class="${cls === "mono" ? "mono-addr" : ""}">${esc(val)}</dd>`).join("")}</dl>`;
}

function timingBox(v: SignView, a: Action): string {
  if (!v.state) return "";
  const t = withdrawTiming(v.state, v.signer!.tree, a, now());
  let html = "";
  if (a.kind === "withdraw" && offWhitelist(v.state, a.dest))
    html += `<div class="alert bad"><div class="t">⚠ NOT ON THE WHITELIST</div><p style="margin:4px 0 0">${esc(new PublicKey(a.dest).toBase58())} is not one of this vault's whitelisted addresses. Check every character. If you did not type it yourself, stop.</p></div>`;
  if (!t) {
    if (a.kind === "cancel") html += `<div class="note">${v.state.pending ? "Stops the pending payout. It never executes." : "Ends the lockdown / clears what is pending."}</div>`;
    return html;
  }
  if (t.kind === "instant") html += `<div class="note ok-note"><b>Instant.</b> Executes as soon as it is approved (${esc(t.why)}).</div>`;
  if (t.kind === "wait")
    html += `<div class="alert warnc"><div class="t">⏳ WAITS ${esc(Math.round(t.secs / 3600))} H, THEN EXECUTES</div><p style="margin:4px 0 0">This becomes a pending payout (${esc(t.why)}). It can execute after ${esc(new Date(t.at * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}; until then your recovery phrase can cancel it.</p></div>`;
  if (t.kind === "refused") html += `<div class="alert bad"><div class="t">REFUSED</div><p style="margin:4px 0 0">The vault's rules refuse this destination: ${esc(t.why)}.</p></div>`;
  if (v.state.config.threshold > 1 && v.signer!.tree < RECOVERY_TREE) html += `<div class="note">This vault needs ${v.state.config.threshold} signers: it executes once enough of them approve this exact action.</div>`;
  return html;
}

defineView("sign", () => {
  const v = sv();
  const w = findVault(v.key);
  if (!w) return back("Vaults", "home");
  const title = v.purpose === "send" ? "Send" : v.purpose === "cancel" ? "Cancel pending payout" : "Approve (co-sign)";
  const head = `${back(w.label || shortAddr(w.address), "sign-back")}<div class="h">${esc(title)} <span class="grow"></span></div>`;
  const note = v.note ? `<div class="note warn" style="margin-bottom:8px">${esc(v.note)}</div>` : "";
  switch (v.stage) {
    case "choose":
      return `${head}<div class="panel stack">
        <p class="muted" style="margin:0">Who cancels it?</p>
        <button class="btn danger block" data-a="cancel-recovery">With the recovery phrase</button>
        <button class="btn block" data-a="cancel-owner">With my owner phrase (uses one of my one-time keys)</button>
        <div class="note warn">If someone else started this payout, they may have your owner phrase. Cancel with the recovery phrase, then move your funds.</div></div>`;
    case "phrase":
      return `${head}<form class="panel stack" data-a="rec-submit" autocomplete="off">
        <label class="field"><span>Recovery phrase (24 words)</span><textarea name="words" rows="4" class="secret" autocapitalize="off" spellcheck="false" autofocus></textarea></label>
        <label class="field"><span>Vault number</span><input type="text" name="n" inputmode="numeric" value="${esc(v.recN ?? "0")}"/></label>
        ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
        <button class="btn danger block" type="submit">Check and continue</button>
        <div class="dim small">Used for this one cancel only. It is never stored and is wiped from memory when you leave this screen.</div></form>`;
    case "loading":
      return `${head}<div class="panel stack"><div>${esc(v.loadingText ?? "Working…")}</div>${
        v.progress ? `<div class="bar"><i style="width:${Math.round((v.progress[0] * 100) / (v.progress[1] || 1))}%"></i></div><div class="dim small">${v.progress[0]} / ${v.progress[1]} keys</div>` : `<div class="bar indet"><i></i></div>`
      }</div>`;
    case "blocked":
      return `${head}${note}<div class="alert bad"><div class="t">CANNOT SIGN</div><p style="margin:4px 0 0">${esc(v.err ?? "")}</p></div><button class="btn block" style="margin-top:10px" data-a="sign-back">Back</button>`;
    case "form": {
      const s = v.state!;
      const tokens = v.assets?.tokens.filter((t) => t.amount > 0n) ?? [];
      const wl = s.config.whitelist.map((k) => new PublicKey(k).toBase58());
      return `${head}${note}<form class="panel stack" data-a="sign-form" autocomplete="off">
        <label class="field"><span>Asset</span><select name="asset">
          <option value="${SOL_MINT.toBase58()}" ${v.asset === SOL_MINT.toBase58() ? "selected" : ""}>SOL · ${esc(solNum(v.assets?.lamports ?? 0))} in vault</option>
          ${tokens.map((t) => `<option value="${esc(t.mint.toBase58())}" ${v.asset === t.mint.toBase58() ? "selected" : ""}>${esc(shortAddr(t.mint.toBase58()))} · ${esc(fromBaseUnits(t.amount, t.decimals))}</option>`).join("")}
        </select></label>
        <label class="field"><span>Amount</span><div class="row"><input type="text" name="amount" inputmode="decimal" value="${esc(v.amount)}" placeholder="0.0" autofocus/><button type="button" class="btn" data-a="sign-max">Max</button></div></label>
        <label class="field"><span>To</span><input type="text" name="dest" value="${esc(v.dest)}" placeholder="destination wallet address" spellcheck="false"/></label>
        ${wl.length ? `<div class="chips"><span class="dim small">whitelist:</span>${wl.map((a) => `<button type="button" class="chipbtn" data-a="sign-wl" data-arg="${esc(a)}">${esc(shortAddr(a))}</button>`).join("")}</div>` : ""}
        <label class="field"><span>Network fees</span><select name="mode">
          <option value="relayer" ${v.mode === "relayer" ? "selected" : ""} ${v.relayer ? "" : "disabled"}>Relayer: the vault pays ${v.sentinelFree ? "nothing (Sentinel)" : v.relayer ? `${solNum(BigInt(v.relayer.minFee))} SOL` : "(unavailable)"}</option>
          <option value="wallet" ${v.mode === "wallet" ? "selected" : ""} ${v.feeAddress ? "" : "disabled"}>${esc(v.feeName ?? "My wallet")} pays (${esc(solNum(v.feeBalance ?? 0))} SOL)</option>
        </select></label>
        ${v.err ? `<div class="err">${esc(v.err)}</div>` : ""}
        <button class="btn primary block" type="submit">Review</button>
        <div class="dim small">Next: the extension checks this against the vault's rules and history before anything is signed.</div>
      </form>`;
    }
    case "review": {
      const a = v.frozen?.action ?? v.draft?.action;
      if (!a) return `${head}<div class="panel">Nothing to review.</div>`;
      const pre = v.pre;
      const errors = pre?.errors ?? [];
      const warnings = pre?.warnings ?? [];
      const frozenNote = v.frozen
        ? `<div class="note">${
            v.frozen.source === "chain"
              ? "A one-time key already published part of a signature for exactly this action: only it can be completed with that key. Sending it again is harmless."
              : "Frozen for one-time key #" + v.frozen.leaf + ": a one-time key signs one message, ever."
          }</div>`
        : "";
      return `${head}${note}<div class="panel stack">${actionLines(v, a)}</div>
        <div class="stack" style="margin-top:8px">${timingBox(v, a)}
        ${errors.length ? `<div class="alert bad"><div class="t">CANNOT SIGN THIS</div><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
        ${warnings.length && !v.frozen ? `<div class="alert warnc"><div class="t">CHECK THIS</div><ul>${warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
           <label class="check"><input type="checkbox" data-a="sign-consent" ${v.consent ? "checked" : ""}/> <span>I understand</span></label></div>` : ""}
        ${frozenNote}
        ${v.sendErr ? `<div class="err">${esc(v.sendErr)}</div>` : ""}
        ${stepsHtml(v.steps ?? [], w.cluster)}
        <div class="grid2">
          <button class="btn" data-a="sign-edit" ${v.frozen?.source === "chain" ? "disabled" : ""}>${v.purpose === "send" ? "Edit" : "Back"}</button>
          <button class="btn ${v.purpose === "cancel" ? "danger" : "primary"}" data-a="sign-go" ${errors.length || (warnings.length && !v.consent && !v.frozen) ? "disabled" : ""}>${v.sendErr ? "Try again" : v.frozen?.source === "chain" ? "Complete it" : "Sign & send"}</button>
        </div></div>`;
    }
    case "sending":
      return `${head}<div class="panel stack"><div>Signing with one-time key #${esc(v.frozen?.leaf)} and sending… Keep this open.</div>${stepsHtml(v.steps ?? [], w.cluster)}<div class="bar indet"><i></i></div></div>`;
    case "done": {
      const p = v.after?.pending;
      const queued = v.purpose === "send" && p && v.executed;
      return `${head}<div class="alert ${queued ? "warnc" : "okc"}"><div class="t">${queued ? "⏳ PENDING" : "✓ DONE"}</div><p style="margin:4px 0 0">${esc(v.done ?? "")}</p>
          ${queued ? `<p style="margin:4px 0 0">It waits until <b>${esc(new Date(p!.executableAt * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}</b>. Until then the recovery phrase can cancel it.</p>` : ""}</div>
        ${stepsHtml(v.steps ?? [], w.cluster)}
        <button class="btn primary block" style="margin-top:10px" data-a="sign-back">Back to vault</button>`;
    }
  }
  return head;
});
