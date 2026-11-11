// PORT of the signing logic of web/components/vault/ActionPanel.tsx, without React. Every rule and
// every step is the site's, in the same order; only state handling differs (return values instead
// of setState) and "wallet" means this extension's fee account (feeAccount.ts) instead of a
// browser wallet. All WOTS / digest / approval / buffer logic is the SDK's (sdk/client.ts):
// findSignedMessages, pickLeaf, preflightAction, completesApproval, buildSteps, remainingSteps,
// packSteps. Safety rules, per leaf (from ActionPanel):
//  - the vault's whole history decides which leaf may sign what (findSignedMessages + pickLeaf);
//  - an unfinished signed message is resumed, never replaced;
//  - preflightAction runs before signing; the history is re-read right before freezing;
//  - the frozen action is persisted BEFORE anything is signed or sent; "attempted" is persisted
//    before anything can reach the network.
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import {
  RECOVERY_TREE,
  MAX_CANCEL_LOCK_SECS,
  MIN_CANCEL_LOCK_SECS,
  actionDigest,
  buildSteps,
  completesApproval,
  fetchState,
  findSignedMessages,
  inLockdown,
  leafUsed,
  mintTokenProgram,
  packSteps,
  pickLeaf,
  preflightAction,
  remainingSteps,
  type Noxvault,
  type SignedAction,
  type SignedMessage,
  type Signer,
  type VaultStateView,
} from "../../../sdk/client";
import { authPath, equal, sign, type Action, type Kind } from "../../../sdk/wots";
import { freeEmergencyAction } from "../../../sdk/relayer";
import { errMsg, hex } from "../../../web/lib/format";
import { actionFromJson, actionToJson, describeAction, isSol, sendIxs, type PendingAction, type RelayerInfo, type SendFn } from "../../../web/lib/unlock";
import type { PendingStore } from "./pendingStore";

export type KindName = Action["kind"];
/** "wallet": this extension's fee account pays; "relayer": nox-vault.com's relayer pays, repaid by the vault. */
export type Mode = PendingAction["mode"];
export type StepState = "todo" | "sending" | "done" | "failed";
export interface Step {
  label: string;
  st: StepState;
  sig?: string;
}

export interface Frozen {
  leaf: number;
  action: Action;
  mode: Mode;
  source: "chain" | "local";
}

export type History =
  | { kind: "error"; msg: string }
  | { kind: "ready"; signed: SignedMessage[]; leaf: number; resume?: SignedMessage }
  | { kind: "exhausted"; msg: string };

export interface Ctx {
  program: Program<Noxvault>;
  vault: PublicKey;
  signer: Signer;
  store: PendingStore;
}

const conn = (ctx: Ctx): Connection => ctx.program.provider.connection;

/**
 * ActionPanel `lockdownFree`: during a lockdown the signers' Ping and cancels carry fee 0; the
 * recovery phrase's Cancel and CancelLock are relayed free too (v4.2, emergencies).
 */
export function lockdownFree(state: VaultStateView, tree: number, kind: KindName, now?: number): boolean {
  return (tree < RECOVERY_TREE && inLockdown(state, now) && ["ping", "cancel", "cancelSchedule", "cancelBudget"].includes(kind)) || freeEmergencyAction(tree, kind);
}

/**
 * v4.2: the cancel a cancel screen signs. The recovery phrase may "cancel and freeze" (CancelLock)
 * for `days`; the owner's phrase, or a program that predates v4.2 (`supported` false), gets a plain
 * Cancel, with a note saying why.
 */
export function cancelKind(o: { tree: number; freeze: boolean; days: number; supported: boolean }): { kind: Kind; note?: string } {
  if (!o.freeze) return { kind: { kind: "cancel" } };
  if (o.tree !== RECOVERY_TREE) return { kind: { kind: "cancel" }, note: "Only the recovery phrase can freeze the vault; this is a plain cancel." };
  const secs = Math.round(o.days * 86_400);
  if (!Number.isFinite(secs) || secs < MIN_CANCEL_LOCK_SECS || secs > MAX_CANCEL_LOCK_SECS) throw new Error("Freeze for 1 to 90 days");
  if (!o.supported)
    return {
      kind: { kind: "cancel" },
      note: "The Noxvault program on this network does not support cancel and freeze yet (it arrives with the v4.2 upgrade), so this is a plain cancel. Whoever holds the main phrase can queue a new payout after it: move your funds to a new vault on nox-vault.com.",
    };
  return { kind: { kind: "cancelLock", secs: BigInt(secs) } };
}

// ---- the vault's history decides which leaf signs, and whether a message is already fixed ----

/** ActionPanel `loadHistory`. */
export async function loadHistory(ctx: Ctx, current: VaultStateView): Promise<{ history: History; frozen: Frozen | null; note?: string }> {
  const { program, vault, signer, store } = ctx;
  const vaultStr = vault.toBase58();
  const tree = signer.tree;
  let signed: SignedMessage[];
  try {
    signed = await findSignedMessages(program, vault, signer);
  } catch (e) {
    return { history: { kind: "error", msg: errMsg(e) }, frozen: null };
  }
  const fresh = (await fetchState(program, vault).catch(() => null)) ?? current;
  let pick: { leaf: number; resume?: SignedMessage };
  try {
    pick = pickLeaf(fresh, signer, signed);
  } catch (e) {
    return { history: { kind: "exhausted", msg: errMsg(e) }, frozen: null };
  }
  const history: History = { kind: "ready", signed, leaf: pick.leaf, resume: pick.resume };

  const local = await store.loadPending(vaultStr, tree);
  if (pick.resume) {
    // Chain wins: this leaf published part of a signature for exactly this message.
    const a = pick.resume.action;
    let note: string | undefined;
    if (local && !(local.leaf === pick.resume.leaf && local.digest === hex(pick.resume.digest)))
      note = "This extension remembered a different action, but the chain shows a one-time key already published part of a signature for the one below. Only that one can be completed with it.";
    const m: Mode = a.fee > 0n ? "relayer" : "wallet";
    await store.savePending({ v: 2, vault: vaultStr, tree, leaf: pick.resume.leaf, action: actionToJson(a), digest: hex(pick.resume.digest), mode: m, createdAt: local?.createdAt ?? Date.now() });
    return { history, frozen: { leaf: pick.resume.leaf, action: a, mode: m, source: "chain" }, note };
  }
  if (local && !leafUsed(fresh, tree, local.leaf) && (local.leaf === pick.leaf || (await store.wasAttempted(vaultStr, tree, local.leaf)))) {
    // A send for it may still be in flight: keep it locked to the same message.
    return { history, frozen: { leaf: local.leaf, action: actionFromJson(local.action), mode: local.mode, source: "local" } };
  }
  if (local && leafUsed(fresh, tree, local.leaf)) {
    await store.clearPending(vaultStr, tree);
    await store.clearAttempted(vaultStr, tree, local.leaf);
  }
  return { history, frozen: null };
}

// ---- fees ----

export interface FeeDeps {
  relayer: RelayerInfo | null;
  relayerErr?: string | null;
  /** The fee account (pays network fees in "wallet" mode). */
  feePayer: PublicKey | null;
  /** Vault is Sentinel tier and the relayer relays Sentinel vaults for free. */
  sentinelFree: boolean;
  state: VaultStateView;
  tree: number;
}

/** ActionPanel `feeFor`. */
export function feeFor(m: Mode, k: KindName, d: FeeDeps): { fee: bigint; feePayee: Uint8Array } {
  if (m === "relayer") {
    if (!d.relayer) throw new Error(d.relayerErr || "Relayer info not loaded yet");
    // Sentinel vaults relay for free, and so do the signers' Ping and cancels in a lockdown
    // (the program refuses any fee there): fee 0, the relayer is still named as payee.
    return { fee: d.sentinelFree || lockdownFree(d.state, d.tree, k) ? 0n : BigInt(d.relayer.minFee), feePayee: new PublicKey(d.relayer.relayer).toBytes() };
  }
  if (!d.feePayer) throw new Error("Unlock the wallet: the fee account pays the network fees");
  return { fee: 0n, feePayee: d.feePayer.toBytes() };
}

/** ActionPanel `relayerOk`: whether the frozen action can go through the relayer. */
export function relayerOk(f: Frozen | null, d: Pick<FeeDeps, "relayer" | "sentinelFree" | "state" | "tree">): boolean {
  return (
    !!f &&
    !!d.relayer &&
    equal(f.action.feePayee, new PublicKey(d.relayer.relayer).toBytes()) &&
    (f.action.fee >= BigInt(d.relayer.minFee) || d.sentinelFree || lockdownFree(d.state, d.tree, f.action.kind))
  );
}

// ---- check, then freeze the message for this leaf ----

export interface Preflight {
  errors: string[];
  warnings: string[];
  key: string;
}

export interface PrepareInput {
  leaf: number;
  /** A new action (fee already set by feeFor), or a co-sign `preset` (fixed by whoever opened the approval). */
  action: Action;
  preset?: boolean;
  tokenProgram?: PublicKey;
  mode: Mode;
  deps: FeeDeps;
  /** The previous preflight result and whether the user consented to its warnings. */
  prev: Preflight | null;
  consent: boolean;
}

/** ActionPanel `prepare`. Returns the preflight, and the frozen action when it may be sent. */
export async function prepare(ctx: Ctx, p: PrepareInput): Promise<{ pre: Preflight; frozen?: Frozen; reloadHistory?: boolean }> {
  const { program, vault, signer, store } = ctx;
  const tree = signer.tree;
  const { leaf } = p;
  let action = p.action;
  let tokenProgram = p.tokenProgram;
  let useMode = p.mode;
  if (p.preset) {
    // Co-signing: the action (including its fee) is fixed by whoever opened the approval.
    if (action.kind === "withdraw" && !isSol(action.mint)) tokenProgram = await mintTokenProgram(conn(ctx), new PublicKey(action.mint));
    const r = p.deps.relayer;
    useMode = r && equal(action.feePayee, new PublicKey(r.relayer).toBytes()) && (action.fee > 0n || p.deps.sentinelFree || lockdownFree(p.deps.state, tree, action.kind)) ? "relayer" : "wallet";
  }
  const payer = (useMode === "relayer" ? (p.deps.relayer ? new PublicKey(p.deps.relayer.relayer) : null) : p.deps.feePayer) ?? p.deps.feePayer;
  if (!payer) throw new Error(useMode === "relayer" ? "Relayer unavailable" : "Unlock the wallet");
  const digest = actionDigest(program.programId, vault, tree, leaf, action);
  const preKey = `${leaf}:${hex(digest)}`;
  let res: { errors: string[]; warnings: string[] };
  try {
    res = await preflightAction({ program, payer, vault, signer, leaf, action, tokenProgram });
    // Re-read the history right before freezing: nothing may have been signed meanwhile.
    const signed = await findSignedMessages(program, vault, signer);
    const fresh = await fetchState(program, vault);
    const other = signed.find((m) => fresh && !leafUsed(fresh, tree, m.leaf) && !(m.leaf === leaf && equal(m.digest, digest)));
    if (other) res.errors.push(`One-time key #${other.leaf} already signed "${describeAction(other.action)}". Finish that first.`);
  } catch (e) {
    res = { errors: [`Could not read this vault's history, so it is not safe to sign (${errMsg(e)}).`], warnings: [] };
  }
  const same = p.prev?.key === preKey;
  const pre = { ...res, key: preKey };
  if (res.errors.length) return { pre, reloadHistory: res.errors.some((e) => /already signed/.test(e)) };
  if (res.warnings.length && !(same && p.consent)) return { pre };
  const pending: PendingAction = { v: 2, vault: vault.toBase58(), tree, leaf, action: actionToJson(action), digest: hex(digest), mode: useMode, createdAt: Date.now() };
  await store.savePending(pending); // persisted BEFORE anything is signed or sent
  return { pre, frozen: { leaf, action, mode: useMode, source: "local" } };
}

/** ActionPanel `discard`: only a local, never-attempted action that published nothing may be dropped. */
export async function discard(ctx: Ctx, f: Frozen): Promise<{ ok: boolean; note?: string }> {
  const { program, vault, signer, store } = ctx;
  const vaultStr = vault.toBase58();
  if (f.source !== "local" || (await store.wasAttempted(vaultStr, signer.tree, f.leaf))) return { ok: false, note: "Something was already sent for this action: it can only be completed." };
  try {
    const signed = await findSignedMessages(program, vault, signer);
    if (signed.some((m) => m.leaf === f.leaf)) return { ok: false, note: "Cannot discard: this one-time key already published part of a signature." };
  } catch (e) {
    return { ok: false, note: `Cannot discard: the vault's history could not be read (${errMsg(e)}).` };
  }
  await store.clearPending(vaultStr, signer.tree);
  return { ok: true };
}

// ---- send the frozen message ----

/** ActionPanel `signedFor`. */
export function signedFor(ctx: Ctx, f: Frozen): SignedAction {
  const { program, vault, signer } = ctx;
  const digest = actionDigest(program.programId, vault, signer.tree, f.leaf, f.action);
  return { vault, tree: signer.tree, leaf: f.leaf, pkSeed: signer.seeds.pkSeed, authPath: authPath(signer.pub, f.leaf), signature: sign(signer.seeds, f.leaf, digest), action: f.action };
}

export interface SendDeps {
  /** Relayer mode: posts the signed action (relayer.ts relayAction). */
  relay?: (s: SignedAction) => Promise<string[]>;
  /** Wallet mode: the fee account and its signer. */
  payer?: PublicKey;
  send?: SendFn;
  onSteps?: (steps: Step[]) => void;
}

export interface SendResult {
  executed: boolean;
  steps: Step[];
  done: string;
}

/** ActionPanel `finish`. */
async function finish(ctx: Ctx, f: Frozen, executed: boolean, steps: Step[]): Promise<SendResult> {
  await ctx.store.clearPending(ctx.vault.toBase58(), ctx.signer.tree);
  return {
    executed,
    steps,
    done: executed
      ? `Done: ${describeAction(f.action)}. One-time key #${f.leaf} is used and can never sign again.`
      : `Approval recorded with one-time key #${f.leaf}. It executes once enough signers approve the same action.`,
  };
}

/** ActionPanel `sendWallet`, with the fee account as the wallet. */
async function sendWallet(ctx: Ctx, f: Frozen, d: SendDeps): Promise<SendResult> {
  const { program, vault, signer, store } = ctx;
  const payer = d.payer;
  if (!payer || !d.send) throw new Error("Unlock the wallet: the fee account pays the network fees");
  const s = signedFor(ctx, f);
  const a = f.action;
  const tokenProgram = a.kind === "withdraw" && !isSol(a.mint) ? await mintTokenProgram(conn(ctx), new PublicKey(a.mint)) : undefined;
  const status = await completesApproval(program, vault, signer.tree, a);
  const all = await buildSteps(program, payer, s, { tokenProgram, execute: status.willExecute, creator: status.creator ?? payer });
  const todo = await remainingSteps(program, payer, s, all);
  if (!todo.length) return finish(ctx, f, status.willExecute, []);
  const txs = packSteps(payer, todo);
  const list: Step[] = txs.map((t) => ({ label: t.label, st: "todo" }));
  d.onSteps?.([...list]);
  for (let i = 0; i < txs.length; i++) {
    list[i].st = "sending";
    d.onSteps?.([...list]);
    await store.markAttempted(vault.toBase58(), signer.tree, f.leaf); // before anything can reach the network
    try {
      list[i].sig = await sendIxs(conn(ctx), payer, d.send, txs[i].instructions);
      list[i].st = "done";
      d.onSteps?.([...list]);
    } catch (e) {
      list[i].st = "failed";
      d.onSteps?.([...list]);
      throw e;
    }
  }
  return finish(ctx, f, status.willExecute, list);
}

/** ActionPanel `sendRelayer`. */
async function sendRelayer(ctx: Ctx, f: Frozen, d: SendDeps): Promise<SendResult> {
  const { program, vault, signer, store } = ctx;
  if (!d.relay) throw new Error("Relayer unavailable");
  const s = signedFor(ctx, f);
  d.onSteps?.([{ label: "relayer sends open + write + verify + approve (+ execute)", st: "sending" }]);
  await store.markAttempted(vault.toBase58(), signer.tree, f.leaf);
  const status = await completesApproval(program, vault, signer.tree, f.action).catch(() => ({ willExecute: true }));
  let steps: Step[];
  try {
    const sigs = await d.relay(s);
    steps = sigs.length ? sigs.map((sig, i) => ({ label: `transaction ${i + 1}`, st: "done" as const, sig })) : [{ label: "already done", st: "done" }];
    d.onSteps?.(steps);
  } catch (e) {
    d.onSteps?.([{ label: "relayer", st: "failed" }]);
    throw e;
  }
  return finish(ctx, f, status.willExecute, steps);
}

/** ActionPanel `send`. Errors are thrown; the caller shows explainError(e). */
export function sendFrozen(ctx: Ctx, f: Frozen, m: Mode, d: SendDeps): Promise<SendResult> {
  return m === "relayer" ? sendRelayer(ctx, f, d) : sendWallet(ctx, f, d);
}

/** ActionPanel `maxAmount`: max for SOL, everything minus the fee leaves exactly 0 (allowed). */
export function maxAmount(o: { mode: Mode; relayer: RelayerInfo | null; holding: { amount: bigint; decimals: number } | null; lamports: number; isDuress: boolean; duressLimit: bigint }, fromBaseUnits: (v: bigint, d: number) => string): string {
  const fee = o.mode === "relayer" && o.relayer ? BigInt(o.relayer.minFee) : 0n;
  if (o.holding) return fromBaseUnits(o.holding.amount, o.holding.decimals).replace(/,/g, "");
  let lamports = BigInt(o.lamports) - fee;
  if (o.isDuress) {
    const cap = o.duressLimit - fee;
    const free = BigInt(o.lamports) - 890_880n - fee;
    lamports = cap < free ? cap : free;
  }
  return lamports > 0n ? fromBaseUnits(lamports, 9).replace(/,/g, "") : "0";
}
