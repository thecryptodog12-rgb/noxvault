// Offline signing helpers: building actions from form input, human-readable summaries, QR
// part framing, and the online checks /submit runs on a signed request it did not make.
import { BorshInstructionCoder, type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import {
  SOL_MINT,
  TREE_PRIMARY,
  actionDigest,
  fetchState,
  leafUsed,
  withRetry,
  type Noxvault,
  type SignedAction,
  type VaultStateView,
} from "@nox/sdk/client";
import { decodeRelayRequest, type RelayRequest } from "@nox/sdk/relayer";
import { STEPS, chain, digits, encodeAction, equal, recoverRoot, type Action } from "@nox/sdk/wots";
import { fromBaseUnits, toBaseUnits } from "./format";

export const ACTION_KINDS = ["withdraw", "stake", "unstake", "collectStake", "cancel", "ping"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const KIND_LABEL: Record<ActionKind, string> = {
  withdraw: "Withdraw",
  stake: "Stake",
  unstake: "Unstake",
  collectStake: "Collect stake",
  cancel: "Cancel pending withdrawal",
  ping: "Ping (prove you are alive)",
};

// ---------- form → action ----------

export interface ActionForm {
  kind: ActionKind;
  asset: "sol" | "token";
  mint: string;
  decimals: string;
  dest: string;
  amount: string; // SOL, or token units with `decimals`
  seed: string;
  vote: string;
  fee: string; // SOL
  feePayee: string;
}

export const EMPTY_FORM: ActionForm = {
  kind: "withdraw",
  asset: "sol",
  mint: "",
  decimals: "6",
  dest: "",
  amount: "",
  seed: "0",
  vote: "",
  fee: "0",
  feePayee: "",
};

function key(label: string, v: string): Uint8Array {
  try {
    return new PublicKey(v.trim()).toBytes();
  } catch {
    throw new Error(`${label}: not a valid address`);
  }
}

function seedOf(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Stake slot must be 0–255");
  return n;
}

/** Turns form input into an Action. Throws a readable error on bad input. */
export function actionFromForm(f: ActionForm): Action {
  const fee = toBaseUnits(f.fee || "0", 9);
  const feePayee = fee > 0n ? key("Fee payee", f.feePayee) : new Uint8Array(32);
  switch (f.kind) {
    case "withdraw": {
      const sol = f.asset === "sol";
      const decimals = sol ? 9 : Number(f.decimals);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Decimals must be 0–18");
      const amount = toBaseUnits(f.amount, decimals);
      if (amount === 0n) throw new Error("Amount must be more than 0");
      return {
        kind: "withdraw",
        mint: sol ? SOL_MINT.toBytes() : key("Mint", f.mint),
        dest: key("Destination", f.dest),
        amount,
        fee,
        feePayee,
      };
    }
    case "stake": {
      const amount = toBaseUnits(f.amount, 9);
      if (amount === 0n) throw new Error("Amount must be more than 0");
      return { kind: "stake", seed: seedOf(f.seed), vote: key("Vote account", f.vote), amount, fee, feePayee };
    }
    case "unstake":
    case "collectStake":
      return { kind: f.kind, seed: seedOf(f.seed), fee, feePayee };
    case "cancel":
    case "ping":
      return { kind: f.kind, fee, feePayee };
  }
}

// ---------- summary ----------

export interface SummaryRow {
  k: string;
  v: string;
  strong?: boolean;
}

const b58 = (b: Uint8Array) => new PublicKey(b).toBase58();
const solStr = (l: bigint) => `${fromBaseUnits(l, 9)} SOL`;

/**
 * A plain-language description of what a signed action does. `decimals` formats token amounts
 * (unknown → raw base units).
 */
export function summarize(vault: string, tree: number, leaf: number, a: Action, decimals?: number): { headline: string; rows: SummaryRow[] } {
  const rows: SummaryRow[] = [
    { k: "vault", v: vault },
    { k: "key", v: `${tree === TREE_PRIMARY ? "primary" : "recovery"} tree, one-time key #${leaf}` },
  ];
  let headline = "";
  switch (a.kind) {
    case "withdraw": {
      const sol = equal(a.mint, SOL_MINT.toBytes());
      const amt = sol
        ? solStr(a.amount)
        : decimals !== undefined
          ? `${fromBaseUnits(a.amount, decimals)} tokens (${a.amount} base units)`
          : `${a.amount} base units`;
      headline = `Withdraw ${amt} to ${b58(a.dest)}`;
      rows.push({ k: "action", v: "withdraw", strong: true });
      rows.push({ k: "asset", v: sol ? "SOL" : `token ${b58(a.mint)}` });
      rows.push({ k: "amount", v: amt, strong: true });
      rows.push({ k: "to", v: b58(a.dest), strong: true });
      break;
    }
    case "stake":
      headline = `Stake ${solStr(a.amount)} with vote account ${b58(a.vote)} (slot #${a.seed})`;
      rows.push({ k: "action", v: "stake", strong: true });
      rows.push({ k: "amount", v: solStr(a.amount), strong: true });
      rows.push({ k: "validator", v: b58(a.vote), strong: true });
      rows.push({ k: "stake slot", v: `#${a.seed}` });
      break;
    case "unstake":
      headline = `Unstake stake slot #${a.seed}`;
      rows.push({ k: "action", v: "unstake (deactivate)", strong: true });
      rows.push({ k: "stake slot", v: `#${a.seed}`, strong: true });
      break;
    case "collectStake":
      headline = `Collect deactivated stake from slot #${a.seed} back into the vault`;
      rows.push({ k: "action", v: "collect stake", strong: true });
      rows.push({ k: "stake slot", v: `#${a.seed}`, strong: true });
      break;
    case "cancel":
      headline = "Cancel the vault's pending withdrawal";
      rows.push({ k: "action", v: "cancel pending withdrawal", strong: true });
      break;
    case "ping":
      headline = "Ping: mark the owner as active (resets the recovery timer)";
      rows.push({ k: "action", v: "ping", strong: true });
      break;
  }
  rows.push({
    k: "fee",
    v: a.fee > 0n ? `${solStr(a.fee)} from the vault to ${b58(a.feePayee)}` : "none (whoever submits pays network fees)",
  });
  return { headline, rows };
}

// ---------- QR framing ----------
//
// A part is "NOX1:<id>:<i>/<n>:<chunk>", id = first 8 hex of sha256(full text), so parts of two
// different requests never mix.

const PART_RE = /^NOX1:([0-9a-f]{8}):(\d+)\/(\d+):([\s\S]*)$/;

export function textId(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text)).slice(0, 4), (x) => x.toString(16).padStart(2, "0")).join("");
}

export function splitForQr(text: string, maxChars: number): string[] {
  const n = Math.max(1, Math.ceil(text.length / maxChars));
  const size = Math.ceil(text.length / n);
  const id = textId(text);
  return Array.from({ length: n }, (_, i) => `NOX1:${id}:${i + 1}/${n}:${text.slice(i * size, (i + 1) * size)}`);
}

export interface QrPart {
  id: string;
  i: number;
  n: number;
  chunk: string;
}

export function parsePart(s: string): QrPart | null {
  const m = PART_RE.exec(s.trim());
  if (!m) return null;
  const i = Number(m[2]);
  const n = Number(m[3]);
  if (i < 1 || i > n || n > 64) return null;
  return { id: m[1], i, n, chunk: m[4] };
}

/** Collects parts; returns the full text once complete and its checksum matches. */
export class PartCollector {
  id: string | null = null;
  n = 0;
  parts = new Map<number, string>();

  /** Returns "new" | "dup" | "other" (part of a different request) | "bad". */
  add(raw: string): "new" | "dup" | "other" | "bad" {
    const p = parsePart(raw);
    if (!p) return "bad";
    if (this.id && p.id !== this.id) return "other";
    this.id = p.id;
    this.n = p.n;
    if (this.parts.has(p.i)) return "dup";
    this.parts.set(p.i, p.chunk);
    return "new";
  }

  get done(): boolean {
    return this.n > 0 && this.parts.size === this.n;
  }

  text(): string | null {
    if (!this.done) return null;
    const t = Array.from({ length: this.n }, (_, i) => this.parts.get(i + 1)).join("");
    if (textId(t) !== this.id) throw new Error("The scanned parts do not add up (checksum mismatch). Scan again.");
    return t;
  }
}

/** Accepts raw RelayRequest JSON, or one or more "NOX1:" parts (one per line). */
export function parseSubmitInput(input: string): { request: RelayRequest; signed: SignedAction; text: string } {
  let text = input.trim();
  if (!text) throw new Error("Paste the signed request first");
  if (text.startsWith("NOX1:")) {
    const c = new PartCollector();
    for (const line of text.split(/\s*\n\s*/).filter(Boolean)) {
      const r = c.add(line);
      if (r === "bad") throw new Error("A line is not a Noxvault QR part");
      if (r === "other") throw new Error("These parts come from two different signed requests");
    }
    if (!c.done) throw new Error(`Have ${c.parts.size} of ${c.n} parts`);
    text = c.text()!;
  }
  let request: RelayRequest;
  try {
    request = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  return { request, signed: decodeRelayRequest(request), text };
}

// ---------- online checks (/submit) ----------

export interface Check {
  level: "ok" | "warn" | "bad";
  text: string;
}

interface HistoryEntry {
  sig: string;
  opens: { tree: number; leaf: number; pkSeed: Uint8Array; action: Action; buffer: string }[];
  writes: { buffer: string; start: number; values: Uint8Array[] }[];
}

/** All open_unlock / write_sigs instructions in the vault's history, oldest first. */
export async function readVaultHistory(program: Program<Noxvault>, vault: PublicKey): Promise<HistoryEntry[]> {
  const conn = program.provider.connection;
  const coder = program.coder.instruction as BorshInstructionCoder;
  const sigs: string[] = [];
  for (let before: string | undefined; ; ) {
    const page = await withRetry(() => conn.getSignaturesForAddress(vault, { before, limit: 1000 }, "confirmed"));
    sigs.push(...page.map((s) => s.signature));
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  sigs.reverse();
  const out: HistoryEntry[] = [];
  for (let i = 0; i < sigs.length; i += 5) {
    const batch = sigs.slice(i, i + 5);
    const txs = await withRetry(() => conn.getTransactions(batch, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
    txs.forEach((tx, t) => {
      if (!tx) throw new Error(`Could not load transaction ${batch[t]}`);
      const msg = tx.transaction.message;
      const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
      const e: HistoryEntry = { sig: batch[t], opens: [], writes: [] };
      for (const ix of msg.compiledInstructions) {
        if (!keys.get(ix.programIdIndex)?.equals(program.programId)) continue;
        let decoded: ReturnType<BorshInstructionCoder["decode"]>;
        try {
          decoded = coder.decode(Buffer.from(ix.data));
        } catch {
          continue;
        }
        if (!decoded) continue;
        const acct = (n: number) => keys.get(ix.accountKeyIndexes[n]);
        const data = decoded.data as Record<string, any>;
        if (decoded.name === "openUnlock" || decoded.name === "open_unlock") {
          if (!acct(1)?.equals(vault)) continue;
          e.opens.push({
            tree: data.tree,
            leaf: data.leaf,
            pkSeed: Uint8Array.from(data.pkSeed ?? data.pk_seed),
            action: anchorToAction(data.action),
            buffer: acct(3)!.toBase58(),
          });
        } else if (decoded.name === "writeSigs" || decoded.name === "write_sigs") {
          if (!acct(1)?.equals(vault)) continue;
          e.writes.push({ buffer: acct(2)!.toBase58(), start: data.start, values: (data.sigs as number[][]).map((v) => Uint8Array.from(v)) });
        }
      }
      if (e.opens.length || e.writes.length) out.push(e);
    });
  }
  return out;
}

function anchorToAction(a: Record<string, Record<string, any>>): Action {
  const [kind, f] = Object.entries(a)[0];
  const k = (p: PublicKey) => p.toBytes();
  const n = (x: { toString(): string }) => BigInt(x.toString());
  const payee = k(f.feePayee ?? f.fee_payee);
  switch (kind) {
    case "withdraw":
      return { kind, mint: k(f.mint), dest: k(f.dest), amount: n(f.amount), fee: n(f.fee), feePayee: payee };
    case "stake":
      return { kind, seed: f.seed, vote: k(f.vote), amount: n(f.amount), fee: n(f.fee), feePayee: payee };
    case "unstake":
    case "collectStake":
      return { kind, seed: f.seed, fee: n(f.fee), feePayee: payee };
    case "cancel":
    case "ping":
      return { kind, fee: n(f.fee), feePayee: payee };
  }
  throw new Error(`unknown action ${kind}`);
}

/**
 * Checks a signed request against chain state, like the relayer's checkRelay, plus a history
 * check that needs no secret: the request's own signature reveals every chain end of its key, so
 * any signature value published for a *different* message with the same key can be recognised.
 */
export async function checkSigned(program: Program<Noxvault>, s: SignedAction): Promise<{ checks: Check[]; state: VaultStateView | null }> {
  const checks: Check[] = [];
  const conn = program.provider.connection;
  const state = await withRetry(() => fetchState(program, s.vault));
  if (!state) return { checks: [{ level: "bad", text: "This vault is not initialized on this network (or it is not a v2 vault)." }], state };

  const primary = s.tree === TREE_PRIMARY;
  const root = primary ? state.config.primaryRoot : state.config.recoveryRoot;
  const height = primary ? state.config.primaryHeight : state.config.recoveryHeight;
  if (!height) checks.push({ level: "bad", text: "This vault has no recovery tree." });
  else if (s.authPath.length !== height) checks.push({ level: "bad", text: `Wrong tree: auth path has ${s.authPath.length} levels, the vault's tree has ${height}.` });

  const digest = actionDigest(program.programId, s.vault, s.tree, s.leaf, s.action);
  let rootOk = false;
  try {
    rootOk = equal(recoverRoot(s.pkSeed, s.leaf, digest, s.signature, s.authPath), root);
  } catch {}
  checks.push(
    rootOk
      ? { level: "ok", text: "Signature and Merkle path match this vault's root." }
      : { level: "bad", text: "Signature does not match this vault (wrong words, vault number, tree, vault address or program)." }
  );

  if (leafUsed(state, s.tree, s.leaf)) checks.push({ level: "bad", text: `One-time key #${s.leaf} is already used on chain.` });
  else checks.push({ level: "ok", text: `One-time key #${s.leaf} is unused on chain.` });

  if (!primary && s.action.kind !== "cancel") {
    const opensAt = state.lastActive + Number(state.config.recoveryDelay);
    if (Date.now() / 1000 < opensAt)
      checks.push({ level: "bad", text: `The recovery key can only cancel until ${new Date(opensAt * 1000).toLocaleString()}.` });
  }
  if (s.action.kind === "cancel" && !state.pending) checks.push({ level: "warn", text: "Nothing is pending: this cancel only uses up a one-time key." });

  // Balance.
  const lamports = BigInt(await withRetry(() => conn.getBalance(s.vault, "confirmed")));
  let solOut = s.action.fee;
  if (s.action.kind === "withdraw" && new PublicKey(s.action.mint).equals(SOL_MINT)) solOut += s.action.amount;
  if (s.action.kind === "stake") solOut += s.action.amount;
  if (solOut > lamports) checks.push({ level: "bad", text: `The vault holds ${fromBaseUnits(lamports, 9)} SOL, less than this needs.` });

  // History: same key, other message?
  if (rootOk) {
    try {
      const hist = await readVaultHistory(program, s.vault);
      const ends = digits(digest).map((a, j) => chain(s.pkSeed, s.leaf, j, s.signature[j], a, STEPS - a));
      const mine = encodeAction(s.action);
      const opens = new Map<string, HistoryEntry["opens"][number]>();
      let otherOpens = 0;
      let leaked = 0;
      let sameOpened = false;
      for (const e of hist) {
        for (const o of e.opens) opens.set(o.buffer, o);
        for (const o of e.opens) {
          if (o.tree !== s.tree || o.leaf !== s.leaf || !equal(o.pkSeed, s.pkSeed)) continue;
          if (equal(encodeAction(o.action), mine)) sameOpened = true;
          else otherOpens++;
        }
        for (const w of e.writes) {
          const o = opens.get(w.buffer);
          if (!o || o.tree !== s.tree || o.leaf !== s.leaf || !equal(o.pkSeed, s.pkSeed)) continue;
          if (equal(encodeAction(o.action), mine)) continue;
          const d = digits(actionDigest(program.programId, s.vault, o.tree, o.leaf, o.action));
          w.values.forEach((v, k) => {
            const j = w.start + k;
            if (j < ends.length && equal(chain(s.pkSeed, s.leaf, j, v, d[j], STEPS - d[j]), ends[j])) leaked++;
          });
        }
      }
      if (leaked)
        checks.push({
          level: "bad",
          text: `Key #${s.leaf} has already published ${leaked} genuine signature value(s) for a DIFFERENT message. Do not submit this: sign nothing more with this key, and complete only that earlier message (from /mine).`,
        });
      else if (otherOpens)
        checks.push({
          level: "warn",
          text: `Someone opened a buffer for key #${s.leaf} with a different action, but no genuine signature values for it were published. If that was you, check /mine before continuing.`,
        });
      else checks.push({ level: "ok", text: `No other message was ever signed with key #${s.leaf} in this vault's history${sameOpened ? " (this same action was started before; it can be resumed)" : ""}.` });
    } catch (e) {
      checks.push({ level: "bad", text: `Could not read this vault's history, so it is not safe to submit (${(e as Error).message}).` });
    }
  }
  return { checks, state };
}

/** The lowest leaf per tree that is unused in state and never appeared in any open_unlock. */
export async function prepareLeaves(program: Program<Noxvault>, vault: PublicKey) {
  const state = await withRetry(() => fetchState(program, vault));
  if (!state) return null;
  const hist = await readVaultHistory(program, vault);
  const seen = [new Set<number>(), new Set<number>()];
  for (const e of hist) for (const o of e.opens) seen[o.tree]?.add(o.leaf);
  const lowest = (tree: number, height: number) => {
    if (!height) return null;
    for (let l = 0; l < 1 << height; l++) if (!leafUsed(state, tree, l) && !seen[tree].has(l)) return l;
    return -1;
  };
  const balance = await withRetry(() => program.provider.connection.getBalance(vault, "confirmed"));
  return {
    state,
    balance,
    primaryLeaf: lowest(0, state.config.primaryHeight),
    recoveryLeaf: lowest(1, state.config.recoveryHeight),
    seenPrimary: [...seen[0]].sort((a, b) => a - b),
    seenRecovery: [...seen[1]].sort((a, b) => a - b),
  };
}
