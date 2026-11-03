// Quantum exposure of a Solana address: public reads only (no wallet, no backend). Used by /scan
// in the browser and by the /exposure/<address> share card on the server, so no browser APIs.
//
// The honest framing: a Solana address *is* its ed25519 public key. Nothing secret leaks when it
// is used; the public key is simply public from the start. What a future quantum computer would
// change is that the private key could be derived from it. So the exposure of an address is the
// value its key controls, not anything about "leaks".
import { PublicKey, StakeProgram, type Connection, type ParsedAccountData } from "@solana/web3.js";
import { withRetry } from "@nox/sdk/client";
import { errMsg } from "./format";

export interface Activity {
  /** Signatures read (pages of 1000, stopped at `maxPages`). */
  count: number;
  /** True when there are more signatures than were read. */
  capped: boolean;
  /** Block time of the newest signature read (unix seconds). */
  last: number | null;
  /** Block time of the oldest signature read; only the true first one when !capped. */
  first: number | null;
  failed: number;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

/** Signature history, newest first, up to `maxPages` × 1000. */
export async function readActivity(conn: Connection, address: PublicKey, maxPages = 3): Promise<Activity> {
  let count = 0;
  let failed = 0;
  let last: number | null = null;
  let first: number | null = null;
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const sigs = await withTimeout(withRetry(() => conn.getSignaturesForAddress(address, { before, limit: 1000 }, "confirmed"), 4), 20_000, "history");
    if (page === 0) last = sigs[0]?.blockTime ?? null;
    count += sigs.length;
    failed += sigs.filter((s) => s.err).length;
    if (sigs.length) first = sigs[sigs.length - 1].blockTime ?? first;
    if (sigs.length < 1000) return { count, capped: false, last, first, failed };
    before = sigs[sigs.length - 1].signature;
  }
  return { count, capped: true, last, first, failed };
}

export interface StakeView {
  address: string;
  lamports: number;
  staker: string;
  withdrawer: string;
  /** "active", "inactive", "activating", "deactivating" or the raw state when unknown. */
  state: string;
  voter: string | null;
  role: "staker" | "withdrawer" | "both";
}

// Stake account layout: u32 state, u64 rent reserve, staker (32) at 12, withdrawer (32) at 44.
const STAKER_OFFSET = 12;
const WITHDRAWER_OFFSET = 44;

/** Stake accounts where this key is staker and/or withdrawer. */
export async function readStakes(conn: Connection, address: PublicKey): Promise<StakeView[]> {
  const q = (offset: number) =>
    withTimeout(
      withRetry(
        () => conn.getParsedProgramAccounts(StakeProgram.programId, { commitment: "confirmed", filters: [{ dataSize: 200 }, { memcmp: { offset, bytes: address.toBase58() } }] }),
        4
      ),
      25_000,
      "stake lookup"
    ).catch((e) => {
      throw new Error(/429|Too many requests/i.test(String(e)) ? "the RPC is rate-limiting, try again in a minute" : errMsg(e));
    });
  // one after the other: public RPCs rate-limit getProgramAccounts hard
  const asStaker = await q(STAKER_OFFSET);
  const asWithdrawer = await q(WITHDRAWER_OFFSET);
  const out = new Map<string, StakeView>();
  const me = address.toBase58();
  for (const { pubkey, account } of [...asStaker, ...asWithdrawer]) {
    const key = pubkey.toBase58();
    if (out.has(key)) continue;
    const parsed = (account.data as ParsedAccountData)?.parsed as
      | { type?: string; info?: { meta?: { authorized?: { staker?: string; withdrawer?: string } }; stake?: { delegation?: { voter?: string; deactivationEpoch?: string } } } }
      | undefined;
    const staker = parsed?.info?.meta?.authorized?.staker ?? "";
    const withdrawer = parsed?.info?.meta?.authorized?.withdrawer ?? "";
    const d = parsed?.info?.stake?.delegation;
    const deactivating = d?.deactivationEpoch !== undefined && d.deactivationEpoch !== "18446744073709551615";
    out.set(key, {
      address: key,
      lamports: account.lamports,
      staker,
      withdrawer,
      state: parsed?.type === "delegated" ? (deactivating ? "deactivating" : "delegated") : parsed?.type === "initialized" ? "undelegated" : parsed?.type ?? "unknown",
      voter: d?.voter ?? null,
      role: staker === me && withdrawer === me ? "both" : withdrawer === me ? "withdrawer" : "staker",
    });
  }
  return [...out.values()].sort((a, b) => b.lamports - a.lamports);
}

// ---------- risk summary (pure) ----------

export type RiskLevel = "none" | "low" | "medium" | "high";

export interface RiskInput {
  kind: "wallet" | "pda" | "vault";
  lamports: number;
  /** Lamports in stake accounts this key can withdraw. */
  stakeWithdrawable: number;
  /** Stake accounts where this key is only the staker (it can redelegate, not withdraw). */
  stakeStakerOnly: number;
  tokens: number;
  /** Total value in USD when prices are known (mainnet), else null. */
  usd: number | null;
  /** Token accounts with a third-party delegate (not the Escape Hatch). */
  delegations: number;
  escapeArmed: boolean;
  activity: Activity | null;
  now?: number;
}

export interface Risk {
  level: RiskLevel;
  headline: string;
  points: string[];
}

const solStr = (l: number) => `${(l / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;
const daysAgo = (t: number, now: number) => Math.max(0, Math.floor((now - t) / 86400));

export function riskOf(r: RiskInput): Risk {
  const now = r.now ?? Math.floor(Date.now() / 1000);
  if (r.kind === "vault")
    return {
      level: "none",
      headline: "Protected: no ed25519 key can move these funds.",
      points: ["Every withdrawal needs a hash-based (WOTS+) one-time signature, checked on chain. Shor's algorithm does not break hash functions."],
    };
  if (r.kind === "pda")
    return {
      level: "none",
      headline: "No private key exists for this address.",
      points: ["It is off the ed25519 curve, so there is no key to derive. The program that owns it decides what can move, so check that program's own rules and keys."],
    };

  const points: string[] = [];
  const solTotal = r.lamports + r.stakeWithdrawable;
  const empty = solTotal === 0 && r.tokens === 0;
  let level: RiskLevel;
  if (empty) level = "low";
  else if (r.usd !== null) level = r.usd >= 10_000 ? "high" : r.usd >= 100 ? "medium" : "low";
  else level = solTotal >= 100e9 ? "high" : solTotal >= 1e9 || r.tokens > 0 ? "medium" : "low";

  points.push("The address is the public key. It has been public since the address was first shared; that is normal and leaks nothing today.");
  if (r.lamports) points.push(`${solStr(r.lamports)} sits directly on this key.`);
  if (r.stakeWithdrawable) points.push(`${solStr(r.stakeWithdrawable)} is staked in accounts this key can withdraw, so it is exposed the same way.`);
  if (r.stakeStakerOnly) points.push(`${r.stakeStakerOnly} stake account${r.stakeStakerOnly === 1 ? "" : "s"} name this key as staker: it can redelegate or deactivate them, but not withdraw.`);
  if (r.tokens) points.push(`${r.tokens} token balance${r.tokens === 1 ? "" : "s"} can be moved with this one key.`);
  if (r.delegations) points.push(`${r.delegations} token account${r.delegations === 1 ? " has" : "s have"} a delegate: a second key that can also move ${r.delegations === 1 ? "it" : "them"}, and is exposed the same way.`);
  if (r.activity) {
    const a = r.activity;
    if (!a.count) points.push("No transactions yet.");
    else {
      const last = a.last ? `, last ${daysAgo(a.last, now) === 0 ? "today" : `${daysAgo(a.last, now)} days ago`}` : "";
      points.push(`${a.capped ? `More than ${a.count.toLocaleString("en-US")}` : a.count.toLocaleString("en-US")} transaction${a.count === 1 ? "" : "s"}${last}. Activity does not change the exposure, but a key in daily use is one you need to plan a move for.`);
    }
  }
  if (r.escapeArmed) points.push("An Escape Hatch is armed: if the public canary key is ever broken, a pre-signed transaction can move covered funds into a Noxvault first.");

  const headline = empty
    ? "Nothing held right now. Anything sent here later sits behind the same public key."
    : level === "high"
      ? "A lot of value behind one ed25519 key."
      : level === "medium"
        ? "Real value behind one ed25519 key."
        : "A small amount behind one ed25519 key.";
  return { level, headline, points };
}
