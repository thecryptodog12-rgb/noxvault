// Web-side glue for v2 actions: what this browser remembers about an action it is signing,
// sending helpers (wallet or relayer), and reading vault balances. All buffer / step logic
// lives in the SDK (buildSteps, remainingSteps, packSteps). See docs/SPEC.md §6–8.
import { Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SOL_MINT, type SignedAction } from "@nox/sdk/client";
import type { Action } from "@nox/sdk/wots";
import { encodeRelayRequest } from "@nox/sdk/relayer";

// ---------- action <-> JSON (keys base58, amounts decimal strings) ----------

export type ActionJson = Record<string, string | number> & { kind: Action["kind"] };

const KEY_FIELDS = new Set(["mint", "dest", "vote", "session", "newVault", "feePayee", "key"]);
const BIG_FIELDS = new Set(["amount", "interval", "start", "limit", "period", "expires", "fee", "secs"]);
const NUM_FIELDS = new Set(["seed", "id", "count"]);

export function actionToJson(a: Action): ActionJson {
  const out: Record<string, string | number> = { kind: a.kind };
  for (const [k, v] of Object.entries(a)) {
    if (k === "kind") continue;
    out[k] = v instanceof Uint8Array ? new PublicKey(v).toBase58() : typeof v === "bigint" ? v.toString() : (v as number);
  }
  return out as ActionJson;
}

export function actionFromJson(j: ActionJson): Action {
  const out: Record<string, unknown> = { kind: j.kind };
  for (const [k, v] of Object.entries(j)) {
    if (k === "kind") continue;
    if (KEY_FIELDS.has(k)) out[k] = new PublicKey(String(v)).toBytes();
    else if (BIG_FIELDS.has(k)) out[k] = BigInt(String(v));
    else if (NUM_FIELDS.has(k)) out[k] = Number(v);
    else throw new Error(`unknown action field ${k}`);
  }
  return out as unknown as Action;
}

// ---------- the action this browser froze for a leaf ----------

export interface PendingAction {
  v: 2;
  vault: string;
  tree: number;
  leaf: number;
  action: ActionJson;
  digest: string; // hex
  mode: "wallet" | "relayer";
  createdAt: number;
}

const pendKey = (vault: string, tree: number) => `nox2.pending.${vault}.${tree}`;
const attKey = (vault: string, tree: number, leaf: number) => `nox2.attempted.${vault}.${tree}.${leaf}`;

export function loadPending(vault: string, tree: number): PendingAction | null {
  try {
    const raw = localStorage.getItem(pendKey(vault, tree));
    const p = raw ? (JSON.parse(raw) as PendingAction) : null;
    return p && p.v === 2 ? p : null;
  } catch {
    return null;
  }
}

export function savePending(p: PendingAction) {
  try {
    localStorage.setItem(pendKey(p.vault, p.tree), JSON.stringify(p));
  } catch {}
}

export function clearPending(vault: string, tree: number) {
  try {
    localStorage.removeItem(pendKey(vault, tree));
  } catch {}
}

/** Set BEFORE the first transaction or relay request of an action is sent. */
export function markAttempted(vault: string, tree: number, leaf: number) {
  try {
    localStorage.setItem(attKey(vault, tree, leaf), String(Date.now()));
  } catch {}
}

export function wasAttempted(vault: string, tree: number, leaf: number): boolean {
  try {
    return localStorage.getItem(attKey(vault, tree, leaf)) !== null;
  } catch {
    return true; // unknown: be safe
  }
}

export function clearAttempted(vault: string, tree: number, leaf: number) {
  try {
    localStorage.removeItem(attKey(vault, tree, leaf));
  } catch {}
}

// ---------- sending with a wallet ----------

export type SendFn = (
  tx: Transaction,
  conn: Connection,
  opts?: { preflightCommitment?: "confirmed"; maxRetries?: number }
) => Promise<string>;

const RETRYABLE = /Blockhash not found|block height exceeded|BlockheightExceeded|TransactionExpired/i;

/** One transaction with a "confirmed" blockhash; expired-blockhash errors retry with a fresh one. */
export async function sendIxs(conn: Connection, payer: PublicKey, send: SendFn, ixs: TransactionInstruction[], attempts = 4): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...ixs);
      const sig = await send(tx, conn, { preflightCommitment: "confirmed", maxRetries: 3 });
      const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
      return sig;
    } catch (e) {
      const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      if (attempt >= attempts || !RETRYABLE.test(text)) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

// ---------- relayer (this site's /api routes) ----------

export interface RelayerInfo {
  relayer: string;
  minFee: string; // lamports, never above maxFee
  maxFee?: string; // lamports: the program's MAX_ACTION_FEE
  lockdownFree?: boolean; // signer Ping / cancels during a lockdown are relayed with fee 0
  sentinelFree: boolean; // Sentinel-tier vaults relay with fee 0
}

export async function fetchRelayerInfo(): Promise<RelayerInfo> {
  const r = await fetch("/api/relayer-info", { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Relayer unavailable (${r.status})`);
  return j as RelayerInfo;
}

/** Sends a signed action through the relayer. Safe to repeat with the same action. */
export async function relayAction(s: SignedAction): Promise<string[]> {
  const r = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(encodeRelayRequest(s)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Relay failed (${r.status})`);
  return j.signatures as string[];
}

// ---------- vault reading ----------

export interface TokenHolding {
  mint: PublicKey;
  ata: PublicKey;
  amount: bigint;
  decimals: number;
  program: PublicKey;
}

export interface VaultAssets {
  lamports: number;
  tokens: TokenHolding[];
}

export async function vaultAssets(conn: Connection, vault: PublicKey): Promise<VaultAssets> {
  const [lamports, ...lists] = await Promise.all([
    conn.getBalance(vault, "confirmed"),
    ...[TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      conn.getParsedTokenAccountsByOwner(vault, { programId }, "confirmed").then((r) => ({ programId, r }))
    ),
  ]);
  const tokens: TokenHolding[] = [];
  for (const { programId, r } of lists) {
    for (const a of r.value) {
      const info = (a.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } }).parsed.info;
      tokens.push({
        mint: new PublicKey(info.mint),
        ata: a.pubkey,
        amount: BigInt(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
        program: programId,
      });
    }
  }
  return { lamports, tokens };
}

export const isSol = (mint: PublicKey | Uint8Array | string) =>
  (typeof mint === "string" ? mint : mint instanceof Uint8Array ? new PublicKey(mint).toBase58() : mint.toBase58()) === SOL_MINT.toBase58();

export function describeAction(a: Action): string {
  const sol = (n: bigint) => `${(Number(n) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL`;
  const short = (k: Uint8Array) => {
    const s = new PublicKey(k).toBase58();
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  };
  const amt = (mint: Uint8Array, n: bigint) => (isSol(mint) ? sol(n) : `${n} units of ${short(mint)}`);
  const every = (secs: bigint) => {
    const s = Number(secs);
    return s % 86400 === 0 ? `${s / 86400} d` : s % 3600 === 0 ? `${s / 3600} h` : `${s} s`;
  };
  const when = (t: bigint) => new Date(Number(t) * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const fee = a.fee > 0n ? ` (fee ${sol(a.fee)})` : "";
  switch (a.kind) {
    case "withdraw":
      return `withdraw ${amt(a.mint, a.amount)} to ${short(a.dest)}${fee}`;
    case "stake":
      return `stake ${sol(a.amount)} with ${short(a.vote)} (slot #${a.seed})${fee}`;
    case "unstake":
      return `unstake slot #${a.seed}${fee}`;
    case "collectStake":
      return `collect stake slot #${a.seed}${fee}`;
    case "cancel":
      return `cancel the pending withdrawal / migration${fee}`;
    case "cancelLock":
      return `cancel what is pending and freeze the vault for ${every(a.secs)}${fee}`;
    case "ping":
      return `ping (owner is active)${fee}`;
    case "schedule":
      return `schedule #${a.id}: ${amt(a.mint, a.amount)} to ${short(a.dest)} every ${every(a.interval)}, ${a.count}×, from ${when(a.start)}${fee}`;
    case "cancelSchedule":
      return `cancel schedule #${a.id}${fee}`;
    case "budget":
      return `budget #${a.id}: ${short(a.session)} may spend ${amt(a.mint, a.limit)} per ${every(a.period)} until ${when(a.expires)}${fee}`;
    case "cancelBudget":
      return `cancel budget #${a.id}${fee}`;
    case "migrate":
      return `migrate everything to vault ${short(a.newVault)}${fee}`;
    case "letterKey":
      return isSol(a.key) ? `revoke the letter key${fee}` : `authorize letter key ${short(a.key)} (sealed letters only, never funds)${fee}`;
  }
}
