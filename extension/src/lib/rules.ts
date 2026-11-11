// A vault's rules, from the SDK's decoded Config to display lines. Pure.
import type { Config } from "../../../sdk/wots";
import { fmtDuration, fmtSol } from "../../../web/lib/alerts/logic";
import { base58Encode, shortAddr } from "./net";
import type { RulesView } from "./types";

const RECOVERY_TREE = 3;

export function rulesFromConfig(c: Config, keysLeft: number): RulesView {
  const signerTrees = c.trees.slice(0, 3);
  const primary = signerTrees[0];
  const heirs = c.heirs.map((h) => ({ addr: base58Encode(h.addr), bps: h.bps }));
  return {
    signers: signerTrees.filter((t) => t.height > 0).length,
    threshold: c.threshold,
    slowDelay: Number(c.slowDelay),
    instantLimit: c.instantLimit.toString(),
    whitelist: c.whitelist.map(base58Encode),
    recoveryDelay: c.trees[RECOVERY_TREE].height > 0 ? Number(c.recoveryDelay) : null,
    testament: c.testamentDelay > 0n && heirs.length ? { delay: Number(c.testamentDelay), heirs } : null,
    keysLeft,
    keysTotal: primary.height > 0 ? 1 << primary.height : 0,
  };
}

export type Tone = "ok" | "warn" | "bad" | "dim";
export interface RuleLine {
  label: string;
  value: string;
  tone: Tone;
}

/**
 * The rules as short label/value lines. "Restricted" destinations (docs/SPEC.md §4): every
 * non-whitelisted one when there is a whitelist; otherwise all of them when instant_limit > 0.
 */
export function ruleLines(r: RulesView): RuleLine[] {
  const lines: RuleLine[] = [];
  lines.push({
    label: "Signers",
    value: r.signers > 1 ? `${r.threshold} of ${r.signers} must sign` : "1 owner key",
    tone: r.threshold > 1 ? "ok" : "dim",
  });
  const limit = BigInt(r.instantLimit);
  const restricted = r.whitelist.length > 0 || limit > 0n;
  const wait = r.slowDelay === 0 ? "refused" : `wait ${fmtDuration(r.slowDelay)}`;
  lines.push({
    label: "Withdrawals",
    value: !restricted
      ? "any address, instantly"
      : r.whitelist.length
        ? `whitelist instant; others ${wait}`
        : `${wait}${r.slowDelay ? ", cancellable" : ""}`,
    tone: restricted ? "ok" : "warn",
  });
  if (restricted && r.whitelist.length === 0) {
    lines.push({ label: "Instant limit", value: `${fmtSol(limit)} / 24 h`, tone: "dim" });
  } else if (r.whitelist.length && limit > 0n) {
    lines.push({ label: "Instant limit", value: `${fmtSol(limit)} / 24 h to others`, tone: "dim" });
  }
  lines.push({
    label: "Whitelist",
    value: r.whitelist.length ? r.whitelist.map(shortAddr).join(", ") : "none",
    tone: "dim",
  });
  lines.push({
    label: "Recovery",
    value: r.recoveryDelay == null ? "no recovery key" : `cancel anytime; takeover after ${fmtDuration(r.recoveryDelay)} inactive`,
    tone: r.recoveryDelay == null ? "warn" : "ok",
  });
  if (r.testament) {
    lines.push({
      label: "Testament",
      value: `${r.testament.heirs.length} heir${r.testament.heirs.length > 1 ? "s" : ""} after ${fmtDuration(r.testament.delay)} inactive`,
      tone: "dim",
    });
  }
  if (r.keysTotal) {
    const low = r.keysLeft <= Math.max(8, r.keysTotal / 16);
    lines.push({ label: "One-time keys", value: `${r.keysLeft} of ${r.keysTotal} left`, tone: low ? "warn" : "dim" });
  }
  return lines;
}
