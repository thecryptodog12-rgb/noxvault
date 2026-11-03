// A line-by-line TypeScript model of the program's pure rules (programs/noxvault/src/lib.rs and
// state.rs), used by the property tests. Each function names the Rust it mirrors. The pure-SDK
// suite (tests/properties.sdk.ts) checks the invariants of docs/audit/INVARIANTS.md on this
// model; the on-chain suite (tests/properties.chain.ts) checks the deployed program against it.
// Keep it in sync with the program: if a rule changes there, change it here.

export const DAY = 86_400n;
export const SIGNER_SLOTS = 3;
export const RECOVERY_TREE = 3;
export const DURESS_TREE = 4;
export const SIGNER_BITS = (1 << SIGNER_SLOTS) - 1;

export interface RuleConfig {
  whitelist: string[]; // non-default keys only
  slowDelay: bigint;
  instantLimit: bigint;
  threshold: number;
  recoveryDelay: bigint;
  duressLimit: bigint;
  duressLock: bigint;
}

export interface Pending {
  kind: 0 | 1;
  mint: string;
  dest: string;
  amount: bigint;
  executableAt: bigint;
}

export interface RuleState {
  windowStart: bigint;
  windowSpent: bigint;
  pending: Pending | null;
  lockdownUntil: bigint;
  lastActive: bigint;
}

export const SOL_MINT = "11111111111111111111111111111111";

/** Config::whitelist_active, state.rs:107 */
export const whitelistActive = (c: RuleConfig) => c.whitelist.length > 0;
/** Config::restricted, state.rs:114 */
export function restricted(c: RuleConfig, dest: string): boolean {
  return whitelistActive(c) ? !c.whitelist.includes(dest) : c.instantLimit > 0n;
}

export class RuleError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const require_ = (ok: boolean, code: string) => {
  if (!ok) throw new RuleError(code);
};

/** gate, lib.rs:929. Returns true to pay now, false if queued; throws RuleError like `require!`. */
export function gate(st: RuleState, c: RuleConfig, kind: 0 | 1, mint: string, dest: string, amount: bigint, unrestricted: boolean, now: bigint): boolean {
  if (unrestricted || !restricted(c, dest)) return true;
  if (mint === SOL_MINT && c.instantLimit > 0n) {
    if (now >= st.windowStart + DAY) {
      st.windowStart = now;
      st.windowSpent = 0n;
    }
    if (st.windowSpent + amount <= c.instantLimit) {
      st.windowSpent += amount;
      return true;
    }
  }
  require_(c.slowDelay > 0n, "NotWhitelisted");
  require_(st.pending === null, "PendingExists");
  st.pending = { kind, mint, dest, amount, executableAt: now + c.slowDelay };
  return false;
}

export type Mode = "Normal" | "Unrestricted" | "Duress";
export type KindName = "withdraw" | "stake" | "unstake" | "collectStake" | "cancel" | "ping" | "schedule" | "cancelSchedule" | "budget" | "cancelBudget" | "migrate" | "letterKey";
const isCancel = (k: KindName) => k === "cancel" || k === "cancelSchedule" || k === "cancelBudget";

/** authorize, lib.rs:892 (plus Action::is_cancel / allowed_in_lockdown, state.rs:154-160). */
export function authorize(trees: number, c: RuleConfig, st: RuleState, kind: KindName, solWithdraw: boolean, now: bigint): Mode {
  let signers = 0;
  for (let t = 0; t < SIGNER_SLOTS; t++) if (trees & (1 << t)) signers++;
  if (signers >= c.threshold) {
    require_(!(now < st.lockdownUntil) || isCancel(kind) || kind === "ping", "Lockdown");
    return "Normal";
  }
  if (trees & (1 << RECOVERY_TREE)) {
    if (isCancel(kind)) return "Normal";
    require_(now >= st.lastActive + c.recoveryDelay, "RecoveryLocked");
    return "Unrestricted";
  }
  if (trees === 1 << DURESS_TREE) {
    require_(kind === "withdraw" && solWithdraw, "DuressSolOnly");
    return "Duress";
  }
  throw new RuleError("NotApproved");
}

/** The duress branch of execute_withdraw, lib.rs:224-241. Mutates `st`; returns lamports out. */
export function duressPayout(
  st: RuleState,
  c: RuleConfig,
  vaultLamports: bigint,
  rentMin: bigint,
  amount: bigint,
  fee: bigint,
  now: bigint
): { fee: bigint; paid: bigint; vaultAfter: bigint } {
  const aboveRent = vaultLamports > rentMin ? vaultLamports - rentMin : 0n;
  let allowance = now < st.lockdownUntil ? 0n : min(c.duressLimit, aboveRent);
  const f = min(fee, allowance);
  allowance -= f;
  const paid = min(amount, allowance);
  const lockEnd = now + c.duressLock;
  st.lockdownUntil = st.lockdownUntil > lockEnd ? st.lockdownUntil : lockEnd;
  return { fee: f, paid, vaultAfter: vaultLamports - f - paid };
}

/** split, lib.rs:995: shares by basis points, the last heir gets the rounding remainder. */
export function split(total: bigint, bps: number[]): bigint[] {
  const out = bps.map((b) => (total * BigInt(b)) / 10_000n);
  const given = out.reduce((a, b) => a + b, 0n);
  if (out.length) out[out.length - 1] += total - given;
  return out;
}

export interface BudgetState {
  limit: bigint;
  period: bigint;
  expires: bigint;
  windowStart: bigint;
  spent: bigint;
}

/** budget_spend, lib.rs:967 (the mint and dest != vault checks are left to the caller). */
export function budgetSpend(b: BudgetState, c: RuleConfig, dest: string, amount: bigint, now: bigint): void {
  require_(now < b.expires, "BudgetExpired");
  require_(c.whitelist.includes(dest) || !whitelistActive(c), "NotWhitelisted");
  if (now >= b.windowStart + b.period) {
    b.windowStart = now;
    b.spent = 0n;
  }
  require_(b.spent + amount <= b.limit, "OverBudget");
  b.spent += amount;
}

/** VaultState::used / mark_used, state.rs:200-205, over a 5 x 32-byte bitmap. */
export function newBitmap(): Uint8Array[] {
  return Array.from({ length: 5 }, () => new Uint8Array(32));
}
export const isUsed = (bm: Uint8Array[], tree: number, leaf: number) => (bm[tree][leaf >> 3] & (1 << (leaf & 7))) !== 0;
export const markUsed = (bm: Uint8Array[], tree: number, leaf: number) => {
  bm[tree][leaf >> 3] |= 1 << (leaf & 7);
};

/** The fee rule of pay_fee, lib.rs:1027: no cap, no gate, any payee the action names. */
export function feeAllowed(fee: bigint, vaultLamports: bigint): boolean {
  return fee <= vaultLamports;
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
