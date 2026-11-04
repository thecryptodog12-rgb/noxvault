// Solana Quantum Exposure Report: types for the snapshot in content/exposure-report.json and the
// pure helpers that classify who controls an account. The snapshot itself is written by
// scripts/exposure-report.ts from real mainnet RPC responses; the /report page only renders it.
//
// Same framing as lib/exposure.ts: a Solana address *is* its ed25519 public key. An account
// "exposed" here is one whose funds can be moved by a single ed25519 signature. A program
// address (PDA) has no private key, but the program that owns it usually checks ed25519
// signatures of its own (a multisig of ed25519 keys is still ed25519), so "program-controlled"
// is not the same as "quantum-safe". The report keeps those apart and never counts PDAs as safe.
import { PublicKey } from "@solana/web3.js";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
export const VOTE_PROGRAM = "Vote111111111111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PEnkAbnfK3nV5y4c";

/** Programs we can name with confidence. Anything else is shown by its program id. */
export const KNOWN_PROGRAMS: Record<string, string> = {
  [SYSTEM_PROGRAM]: "System Program",
  [STAKE_PROGRAM]: "Stake Program",
  [VOTE_PROGRAM]: "Vote Program",
  [TOKEN_PROGRAM]: "SPL Token",
  [TOKEN_2022_PROGRAM]: "Token-2022",
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: "Squads v4 (multisig)",
  SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: "Squads v3 (multisig)",
  BPFLoaderUpgradeab1e11111111111111111111111: "BPF Upgradeable Loader",
};

export const programName = (id: string | null | undefined) => (id ? KNOWN_PROGRAMS[id] ?? `program ${id.slice(0, 4)}…${id.slice(-4)}` : "no account");

/** True when the address is a point on the ed25519 curve, i.e. a key that has a private key. */
export function onCurve(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

/**
 * Who can move an account's funds.
 * - `key`: one ed25519 signature (a plain wallet, or a stake/vote account whose withdraw
 *   authority is a plain wallet). Exposed to a key-recovery attack on that one key.
 * - `program`: a program decides (PDA, multisig, protocol vault). No private key exists for the
 *   address itself; the program's own signers may still be ed25519 keys.
 * - `unknown`: not enough data to say (missing account, unparsed authority).
 */
export type Control = "key" | "program" | "unknown";

export interface ControlInput {
  /** The account (for SOL rows) or the token account's owner (for token rows). */
  address: string;
  /** Program that owns the account, null when the account does not exist. */
  programOwner: string | null;
  /** Stake/vote withdraw authority, when the account is a stake or vote account. */
  withdrawer?: string | null;
}

export interface ControlResult {
  control: Control;
  /** Short human label, e.g. "wallet (ed25519)", "stake: wallet withdrawer", "PDA (System Program)". */
  label: string;
  /** The ed25519 key that controls it, when control is "key". */
  key: string | null;
}

export function classifyControl({ address, programOwner, withdrawer }: ControlInput): ControlResult {
  // A stake or vote account is owned by its program, but its funds move on the withdrawer's signature.
  if (programOwner === STAKE_PROGRAM || programOwner === VOTE_PROGRAM) {
    const kind = programOwner === STAKE_PROGRAM ? "stake" : "vote";
    if (!withdrawer) return { control: "unknown", label: `${kind} account`, key: null };
    return onCurve(withdrawer)
      ? { control: "key", label: `${kind}: wallet withdrawer`, key: withdrawer }
      : { control: "program", label: `${kind}: program withdrawer`, key: null };
  }
  const curve = onCurve(address);
  if (curve && (programOwner === SYSTEM_PROGRAM || programOwner === null))
    // A token owner with no account of its own is still a key; it just holds no SOL.
    return { control: "key", label: "wallet (ed25519)", key: address };
  if (!curve) return { control: "program", label: `PDA (${programName(programOwner)})`, key: null };
  // On curve but owned by some program: a keypair-created program account. The program rules it.
  return { control: "program", label: `program account (${programName(programOwner)})`, key: null };
}

// ---------- snapshot shape ----------

export interface SolHolder {
  address: string;
  lamports: number;
  programOwner: string | null;
  control: Control;
  label: string;
}

export interface TokenHolder {
  /** The token account. */
  account: string;
  /** Raw amount as a decimal string (u64 does not fit a JS number). */
  amount: string;
  ui: number;
  /** Owner of the token account (the wallet or PDA that can move it). */
  owner: string | null;
  ownerProgram: string | null;
  control: Control;
  label: string;
}

export interface TokenReport {
  symbol: string;
  mint: string;
  decimals: number;
  /** Total supply in UI units, from getTokenSupply. */
  supply: number;
  holders: TokenHolder[];
  topTotal: number;
  topKey: number;
  topProgram: number;
  topUnknown: number;
}

export interface VoteReport {
  accounts: number;
  keyWithdrawer: number;
  programWithdrawer: number;
  unknown: number;
  lamports: number;
  lamportsKey: number;
  /** Activated stake delegated to these vote accounts (lamports), from getVoteAccounts. */
  activatedStake: number;
}

export interface ExposureReport {
  version: 1;
  generatedAt: string;
  slot: number;
  /** Endpoints that answered, per metric. Keyed RPC URLs are redacted. */
  sources: Record<string, string>;
  method: string[];
  supply: { totalLamports: number; circulatingLamports: number; nonCirculatingLamports: number } | null;
  largestSol: { holders: SolHolder[]; totalLamports: number; keyLamports: number; programLamports: number; unknownLamports: number } | null;
  tokens: TokenReport[];
  votes: VoteReport | null;
  failures: string[];
}

/** Sum a list by control class. */
export function splitByControl<T>(rows: T[], control: (r: T) => Control, value: (r: T) => number) {
  const out = { total: 0, key: 0, program: 0, unknown: 0 };
  for (const r of rows) {
    const v = value(r);
    out.total += v;
    out[control(r)] += v;
  }
  return out;
}

/** Share as a percentage with one decimal, "0.0" when the base is zero. */
export const pct = (part: number, whole: number) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : "0.0");

/** Compact number for headlines: 65.6M, 2.98B, 41.2T. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [v, s] of units) if (abs >= v) return `${(n / v).toFixed(abs / v >= 100 ? 0 : abs / v >= 10 ? 1 : 2)}${s}`;
  return n.toFixed(abs >= 10 ? 0 : 2);
}

export interface Headlines {
  /** SOL in the largest accounts that one ed25519 signature can move, and the base it is out of. */
  solKey: number;
  solTop: number;
  solKeyPct: string;
  /** Those single-key SOL as a share of circulating supply. */
  solKeyOfCirculatingPct: string | null;
  /** USDC + USDT among top holders that one key controls (token units). */
  stableKey: number;
  stableTop: number;
  stableKeyPct: string;
  /** Validator vote accounts whose withdraw authority is a plain wallet. */
  votesKey: number;
  votes: number;
  votesKeyPct: string;
}

export function headlines(r: ExposureReport): Headlines | null {
  if (!r.largestSol) return null;
  const solKey = r.largestSol.keyLamports / 1e9;
  const solTop = r.largestSol.totalLamports / 1e9;
  const stable = r.tokens.filter((t) => t.symbol === "USDC" || t.symbol === "USDT");
  const stableKey = stable.reduce((a, t) => a + t.topKey, 0);
  const stableTop = stable.reduce((a, t) => a + t.topTotal, 0);
  return {
    solKey,
    solTop,
    solKeyPct: pct(solKey, solTop),
    solKeyOfCirculatingPct: r.supply ? pct(r.largestSol.keyLamports, r.supply.circulatingLamports) : null,
    stableKey,
    stableTop,
    stableKeyPct: pct(stableKey, stableTop),
    votesKey: r.votes?.keyWithdrawer ?? 0,
    votes: r.votes?.accounts ?? 0,
    votesKeyPct: pct(r.votes?.keyWithdrawer ?? 0, r.votes?.accounts ?? 0),
  };
}

/** Redact anything that looks like an API key in an RPC URL before it goes into a public file. */
export function redactRpc(url: string): string {
  try {
    const u = new URL(url);
    const keyed = u.search.length > 0 || u.username || /[a-f0-9-]{24,}/i.test(u.pathname);
    return keyed ? `${u.protocol}//${u.host}/<redacted>` : `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return "<invalid url>";
  }
}
