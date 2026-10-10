// Offline signing helpers: building actions from form input, human-readable summaries, QR
// part framing, and the online checks /submit runs on a signed request it did not make.
import { BorshInstructionCoder, type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import {
  SOL_MINT,
  RECOVERY_TREE,
  actionFromAnchor,
  actionDigest,
  canExecute,
  fetchApproval,
  fetchState,
  isRestricted,
  leafUsed,
  withRetry,
  type Noxvault,
  type SignedAction,
  type VaultStateView,
} from "@nox/sdk/client";
import { decodeRelayRequest, type RelayRequest } from "@nox/sdk/relayer";
import { STEPS, chain, digits, encodeAction, equal, recoverRoot, type Action } from "@nox/sdk/wots";
import { fromBaseUnits, toBaseUnits } from "./format";

export const ACTION_KINDS = [
  "withdraw",
  "schedule",
  "budget",
  "stake",
  "unstake",
  "collectStake",
  "cancelSchedule",
  "cancelBudget",
  "migrate",
  "ping",
  "cancel",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const KIND_LABEL: Record<ActionKind, string> = {
  withdraw: "Withdraw",
  schedule: "Schedule recurring payments",
  budget: "Budget for a session wallet",
  stake: "Stake",
  unstake: "Unstake",
  collectStake: "Collect stake",
  cancelSchedule: "Stop a schedule",
  cancelBudget: "Stop a budget",
  migrate: "Migrate to a new vault",
  ping: "Ping (prove you are alive)",
  cancel: "Cancel pending withdrawal / migration",
};

/** Which form fields an action kind uses. */
export const KIND_FIELDS: Record<ActionKind, ("asset" | "dest" | "amount" | "seed" | "vote" | "id" | "interval" | "count" | "start" | "session" | "period" | "expires" | "newVault")[]> = {
  withdraw: ["asset", "dest", "amount"],
  schedule: ["id", "asset", "dest", "amount", "interval", "count", "start"],
  budget: ["id", "session", "asset", "amount", "period", "expires"],
  stake: ["seed", "vote", "amount"],
  unstake: ["seed"],
  collectStake: ["seed"],
  cancelSchedule: ["id"],
  cancelBudget: ["id"],
  migrate: ["newVault"],
  ping: [],
  cancel: [],
};

export const SLOT_LABEL = (slot: number) => (slot === RECOVERY_TREE ? "recovery" : `signer ${slot + 1}`);

// ---------- form → action ----------

export interface ActionForm {
  kind: ActionKind;
  asset: "sol" | "token";
  mint: string;
  decimals: string;
  dest: string;
  amount: string; // SOL, or token units with `decimals` (schedule: per payment; budget: limit per period)
  seed: string;
  vote: string;
  id: string; // schedule / budget slot
  interval: string;
  intervalUnit: "h" | "d";
  count: string;
  start: string; // datetime-local
  session: string;
  period: string;
  periodUnit: "h" | "d";
  expires: string; // datetime-local
  newVault: string;
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
  id: "0",
  interval: "30",
  intervalUnit: "d",
  count: "12",
  start: "",
  session: "",
  period: "1",
  periodUnit: "d",
  expires: "",
  newVault: "",
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

function u8Of(v: string, what: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`${what} must be 0–255`);
  return n;
}

const UNIT = { h: 3600, d: 86400 } as const;

function secs(v: string, unit: "h" | "d", what: string): bigint {
  const n = Number(v);
  if (!(n > 0)) throw new Error(`${what} must be more than 0`);
  return BigInt(Math.round(n * UNIT[unit]));
}

function when(v: string, what: string): bigint {
  const t = new Date(v).getTime();
  if (!v || !Number.isFinite(t)) throw new Error(`Pick ${what}`);
  return BigInt(Math.floor(t / 1000));
}

function assetOf(f: ActionForm): { mint: Uint8Array; decimals: number } {
  const sol = f.asset === "sol";
  const decimals = sol ? 9 : Number(f.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Decimals must be 0–18");
  return { mint: sol ? SOL_MINT.toBytes() : key("Mint", f.mint), decimals };
}

function amountOf(f: ActionForm, decimals: number): bigint {
  const amount = toBaseUnits(f.amount, decimals);
  if (amount === 0n) throw new Error("Amount must be more than 0");
  return amount;
}

/** Turns form input into an Action. Throws a readable error on bad input. */
export function actionFromForm(f: ActionForm): Action {
  const fee = toBaseUnits(f.fee || "0", 9);
  const feePayee = fee > 0n ? key("Fee payee", f.feePayee) : new Uint8Array(32);
  const withFee = <K extends object>(k: K) => ({ ...k, fee, feePayee }) as unknown as Action;
  switch (f.kind) {
    case "withdraw": {
      const { mint, decimals } = assetOf(f);
      return withFee({ kind: "withdraw", mint, dest: key("Destination", f.dest), amount: amountOf(f, decimals) });
    }
    case "schedule": {
      const { mint, decimals } = assetOf(f);
      const count = Number(f.count);
      if (!Number.isInteger(count) || count < 1 || count > 65535) throw new Error("Number of payments must be 1–65535");
      return withFee({
        kind: "schedule",
        id: u8Of(f.id, "Schedule slot"),
        mint,
        dest: key("Destination", f.dest),
        amount: amountOf(f, decimals),
        interval: secs(f.interval, f.intervalUnit, "Interval"),
        count,
        start: when(f.start, "the first payment time"),
      });
    }
    case "budget": {
      const { mint, decimals } = assetOf(f);
      return withFee({
        kind: "budget",
        id: u8Of(f.id, "Budget slot"),
        session: key("Session wallet", f.session),
        mint,
        limit: amountOf(f, decimals),
        period: secs(f.period, f.periodUnit, "Period"),
        expires: when(f.expires, "an expiry time"),
      });
    }
    case "stake":
      return withFee({ kind: "stake", seed: u8Of(f.seed, "Stake slot"), vote: key("Vote account", f.vote), amount: amountOf(f, 9) });
    case "unstake":
    case "collectStake":
      return withFee({ kind: f.kind, seed: u8Of(f.seed, "Stake slot") });
    case "cancelSchedule":
    case "cancelBudget":
      return withFee({ kind: f.kind, id: u8Of(f.id, f.kind === "cancelSchedule" ? "Schedule slot" : "Budget slot") });
    case "migrate":
      return withFee({ kind: "migrate", newVault: key("New vault", f.newVault) });
    case "cancel":
    case "ping":
      return withFee({ kind: f.kind });
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
const dur = (secs: bigint) => {
  const s = Number(secs);
  if (s % 86400 === 0) return `${s / 86400} day${s === 86400 ? "" : "s"}`;
  if (s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? "" : "s"}`;
  return `${s} seconds`;
};
const dateStr = (t: bigint) => new Date(Number(t) * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * A plain-language description of what a signed action does. `decimals` formats token amounts
 * (unknown → raw base units).
 */
export function summarize(vault: string, tree: number, leaf: number, a: Action, decimals?: number): { headline: string; rows: SummaryRow[] } {
  const rows: SummaryRow[] = [
    { k: "vault", v: vault },
    { k: "key", v: `${SLOT_LABEL(tree)} tree (slot ${tree}), one-time key #${leaf}` },
  ];
  const amt = (mint: Uint8Array, n: bigint) =>
    equal(mint, SOL_MINT.toBytes())
      ? solStr(n)
      : decimals !== undefined
        ? `${fromBaseUnits(n, decimals)} tokens (${n} base units)`
        : `${n} base units`;
  const asset = (mint: Uint8Array) => (equal(mint, SOL_MINT.toBytes()) ? "SOL" : `token ${b58(mint)}`);
  let headline = "";
  switch (a.kind) {
    case "withdraw":
      headline = `Withdraw ${amt(a.mint, a.amount)} to ${b58(a.dest)}`;
      rows.push({ k: "action", v: "withdraw", strong: true }, { k: "asset", v: asset(a.mint) }, { k: "amount", v: amt(a.mint, a.amount), strong: true }, { k: "to", v: b58(a.dest), strong: true });
      break;
    case "schedule":
      headline = `Pay ${amt(a.mint, a.amount)} to ${b58(a.dest)} every ${dur(a.interval)}, ${a.count} times, starting ${dateStr(a.start)}`;
      rows.push(
        { k: "action", v: `create schedule #${a.id}`, strong: true },
        { k: "asset", v: asset(a.mint) },
        { k: "per payment", v: amt(a.mint, a.amount), strong: true },
        { k: "to", v: b58(a.dest), strong: true },
        { k: "every", v: dur(a.interval), strong: true },
        { k: "payments", v: `${a.count} (total ${amt(a.mint, a.amount * BigInt(a.count))})`, strong: true },
        { k: "first", v: dateStr(a.start) }
      );
      break;
    case "budget":
      headline = `Let wallet ${b58(a.session)} spend up to ${amt(a.mint, a.limit)} per ${dur(a.period)} until ${dateStr(a.expires)}`;
      rows.push(
        { k: "action", v: `create budget #${a.id}`, strong: true },
        { k: "session wallet", v: b58(a.session), strong: true },
        { k: "asset", v: asset(a.mint) },
        { k: "limit", v: `${amt(a.mint, a.limit)} per ${dur(a.period)}`, strong: true },
        { k: "expires", v: dateStr(a.expires), strong: true }
      );
      break;
    case "stake":
      headline = `Stake ${solStr(a.amount)} with vote account ${b58(a.vote)} (slot #${a.seed})`;
      rows.push({ k: "action", v: "stake", strong: true }, { k: "amount", v: solStr(a.amount), strong: true }, { k: "validator", v: b58(a.vote), strong: true }, { k: "stake slot", v: `#${a.seed}` });
      break;
    case "unstake":
      headline = `Unstake stake slot #${a.seed}`;
      rows.push({ k: "action", v: "unstake (deactivate)", strong: true }, { k: "stake slot", v: `#${a.seed}`, strong: true });
      break;
    case "collectStake":
      headline = `Collect deactivated stake from slot #${a.seed} back into the vault`;
      rows.push({ k: "action", v: "collect stake", strong: true }, { k: "stake slot", v: `#${a.seed}`, strong: true });
      break;
    case "cancelSchedule":
      headline = `Stop schedule #${a.id}`;
      rows.push({ k: "action", v: `stop schedule #${a.id}`, strong: true });
      break;
    case "cancelBudget":
      headline = `Stop budget #${a.id}`;
      rows.push({ k: "action", v: `stop budget #${a.id}`, strong: true });
      break;
    case "migrate":
      headline = `Move everything in this vault to vault ${b58(a.newVault)}`;
      rows.push({ k: "action", v: "migrate", strong: true }, { k: "new vault", v: b58(a.newVault), strong: true });
      break;
    case "cancel":
      headline = "Cancel the vault's pending withdrawal or migration";
      rows.push({ k: "action", v: "cancel pending", strong: true });
      break;
    case "ping":
      headline = "Ping: mark the owner as active (resets the recovery and testament timers)";
      rows.push({ k: "action", v: "ping", strong: true });
      break;
  }
  rows.push({
    k: "fee",
    v: a.fee > 0n ? `${solStr(a.fee)} from the vault to ${b58(a.feePayee)}` : "none (whoever submits pays network fees)",
  });
  return { headline, rows };
}

/** The mint whose decimals a summary needs, if any. */
export function actionMint(a: Action): PublicKey | null {
  if ((a.kind === "withdraw" || a.kind === "schedule" || a.kind === "budget") && !equal(a.mint, SOL_MINT.toBytes())) return new PublicKey(a.mint);
  return null;
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
            action: actionFromAnchor(data.action),
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



/**
 * Checks a signed request against chain state, like the relayer's checkRelay, plus a history
 * check that needs no secret: the request's own signature reveals every chain end of its key, so
 * any signature value published for a *different* message with the same key can be recognised.
 */
export async function checkSigned(program: Program<Noxvault>, s: SignedAction): Promise<{ checks: Check[]; state: VaultStateView | null }> {
  const checks: Check[] = [];
  const conn = program.provider.connection;
  const state = await withRetry(() => fetchState(program, s.vault));
  if (!state) return { checks: [{ level: "bad", text: "This vault is not initialized on this network (or it is not a v3 vault)." }], state };

  const slot = state.config.trees[s.tree];
  const root = slot?.root ?? new Uint8Array(32);
  const height = slot?.height ?? 0;
  if (!height) checks.push({ level: "bad", text: s.tree === RECOVERY_TREE ? "This vault has no recovery tree." : `This vault has no signer in slot ${s.tree + 1}.` });
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

  if (s.tree === RECOVERY_TREE && !["cancel", "cancelSchedule", "cancelBudget"].includes(s.action.kind)) {
    const opensAt = state.lastActive + Number(state.config.recoveryDelay);
    if (Date.now() / 1000 < opensAt)
      checks.push({ level: "bad", text: `The recovery key can only cancel until ${new Date(opensAt * 1000).toLocaleString()}.` });
  }
  if (s.action.kind === "cancel" && !state.pending) checks.push({ level: "warn", text: "Nothing is pending: this cancel only uses up a one-time key." });
  const restrictedDest =
    s.action.kind === "withdraw" || s.action.kind === "schedule" ? new PublicKey(s.action.dest) : s.action.kind === "migrate" ? new PublicKey(s.action.newVault) : null;
  if (restrictedDest && s.tree !== RECOVERY_TREE && isRestricted(state.config, restrictedDest)) {
    if (state.config.slowDelay === 0n && !(s.action.kind === "withdraw" && equal(s.action.mint, SOL_MINT.toBytes()) && state.config.instantLimit > 0n))
      checks.push({ level: "bad", text: "The vault's rules do not allow this destination." });
    else checks.push({ level: "warn", text: "Restricted destination: unless it fits the daily instant limit, it becomes a pending action that waits and can be cancelled." });
  }

  // Approvals: does this signature complete the vault's rules, or record one approval of several?
  try {
    const existing = await fetchApproval(program, s.vault, s.action);
    const bits = (existing?.trees ?? 0) | (1 << s.tree);
    const signers = [0, 1, 2].filter((t) => state.config.trees[t].height > 0).length;
    const have = [0, 1, 2].filter((t) => bits & (1 << t)).length;
    if (existing && existing.trees & (1 << s.tree)) checks.push({ level: "warn", text: `Slot ${s.tree} already approved this exact action.` });
    if (canExecute(state, bits, s.action))
      checks.push({ level: "ok", text: s.tree === RECOVERY_TREE ? "This will execute: the recovery key may do this now." : `This will execute: with this signature ${have} of ${state.config.threshold} required signer approval${state.config.threshold === 1 ? " is" : "s are"} in place.` });
    else
      checks.push({
        level: "ok",
        text: `This records approval ${have} of ${state.config.threshold} (from ${signers} signers). It executes once the other signer(s) approve this exact action.`,
      });
  } catch (e) {
    checks.push({ level: "warn", text: `Could not read existing approvals (${(e as Error).message}).` });
  }

  // Balance.
  const lamports = BigInt(await withRetry(() => conn.getBalance(s.vault, "confirmed")));
  let solOut = s.action.fee;
  if (s.action.kind === "withdraw" && new PublicKey(s.action.mint).equals(SOL_MINT)) solOut += s.action.amount;
  if (s.action.kind === "stake") solOut += s.action.amount;
  if (s.action.kind === "withdraw" && new PublicKey(s.action.mint).equals(SOL_MINT) && isRestricted(state.config, new PublicKey(s.action.dest))) solOut = s.action.fee; // may wait as pending
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

/** Per tree slot: the lowest leaf that is unused in state and never appeared in any open_unlock. */
export async function prepareLeaves(program: Program<Noxvault>, vault: PublicKey) {
  const state = await withRetry(() => fetchState(program, vault));
  if (!state) return null;
  const hist = await readVaultHistory(program, vault);
  const seen = [new Set<number>(), new Set<number>(), new Set<number>(), new Set<number>()];
  for (const e of hist) for (const o of e.opens) seen[o.tree]?.add(o.leaf);
  const slots = [0, 1, 2, 3]
    .filter((t) => state.config.trees[t].height > 0)
    .map((t) => {
      const h = state.config.trees[t].height;
      let next = -1;
      for (let l = 0; l < 1 << h; l++)
        if (!leafUsed(state, t, l) && !seen[t].has(l)) {
          next = l;
          break;
        }
      return { slot: t, next, seen: [...seen[t]].sort((a, b) => a - b) };
    });
  const balance = await withRetry(() => program.provider.connection.getBalance(vault, "confirmed"));
  return { state, balance, slots };
}
