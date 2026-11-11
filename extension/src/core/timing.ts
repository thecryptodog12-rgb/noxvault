// What a withdrawal will do once approved: go out at once, wait (a pending payout, cancellable),
// or be refused. Same rules as sdk preflightAction's restrictedCheck and the program (docs/SPEC.md §4):
// a destination is restricted when it is not on the whitelist (or, without a whitelist, whenever
// there is an instant limit); restricted SOL may skip the wait up to the instant limit per 24 h;
// tokens to a restricted destination always wait; slow_delay 0 = restricted destinations refused.
// The recovery key after the inactivity delay is unrestricted; duress withdrawals pay out at once.
import { PublicKey } from "@solana/web3.js";
import { DAY, DURESS_TREE, RECOVERY_TREE, SOL_MINT, isRestricted, type VaultStateView } from "../../../sdk/client";
import { equal, type Action } from "../../../sdk/wots";

export type Timing =
  | { kind: "instant"; why: string }
  | { kind: "wait"; secs: number; at: number; why: string }
  | { kind: "refused"; why: string };

export function withdrawTiming(state: VaultStateView, tree: number, action: Action, now = Math.floor(Date.now() / 1000)): Timing | null {
  if (action.kind !== "withdraw" && action.kind !== "migrate") return null;
  const c = state.config;
  if (tree === DURESS_TREE) return { kind: "instant", why: "duress payout" };
  if (tree === RECOVERY_TREE && now >= state.lastActive + Number(c.recoveryDelay)) return { kind: "instant", why: "recovery key after the inactivity delay" };
  const dest = new PublicKey(action.kind === "withdraw" ? action.dest : action.newVault);
  if (!isRestricted(c, dest)) return { kind: "instant", why: c.whitelist.length ? "whitelisted address" : "this vault has no restrictions" };
  if (action.kind === "withdraw" && equal(action.mint, SOL_MINT.toBytes()) && c.instantLimit > 0n) {
    const spent = now >= state.windowStart + DAY ? 0n : state.windowSpent;
    if (spent + action.amount <= c.instantLimit) return { kind: "instant", why: "within the daily instant limit" };
  }
  if (c.slowDelay === 0n) return { kind: "refused", why: "this vault only pays its whitelist" };
  const secs = Number(c.slowDelay);
  return { kind: "wait", secs, at: now + secs, why: action.kind === "withdraw" && !equal(action.mint, SOL_MINT.toBytes()) ? "tokens to a non-whitelisted address always wait" : "above the daily instant limit or not whitelisted" };
}

/** True when the vault has a whitelist and this destination is not on it. */
export function offWhitelist(state: VaultStateView, dest: Uint8Array): boolean {
  return state.config.whitelist.length > 0 && !state.config.whitelist.some((k) => equal(k, dest));
}
