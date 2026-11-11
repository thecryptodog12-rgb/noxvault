// What the popup shows per vault: one headline status and the list of clocks. Pure.
import { fmtDate, fmtDuration, fmtSol } from "../../../web/lib/alerts/logic";
import { fmtTokenAmount } from "./alerts";
import { shortAddr } from "./net";
import type { ExtSnapshot } from "./types";

export type Tone = "ok" | "warn" | "bad" | "dim";

export interface Headline {
  tone: Tone;
  label: string;
  detail: string;
}

export function headline(s: ExtSnapshot, now: number): Headline {
  if (s.lockdownUntil > now) return { tone: "bad", label: "LOCKDOWN", detail: `frozen: main-phrase withdrawals refused for ${fmtDuration(s.lockdownUntil - now)}` };
  const p = s.pending;
  if (p) {
    const amt = p.kind === "migrate" ? "all funds" : fmtTokenAmount(p.mint, p.amount, s.tokens);
    const t = p.executableAt <= now ? "executable now" : `in ${fmtDuration(p.executableAt - now)}`;
    return { tone: p.executableAt <= now ? "bad" : "warn", label: p.kind === "migrate" ? "MIGRATION PENDING" : "WITHDRAWAL PENDING", detail: `${amt} → ${shortAddr(p.dest)}, ${t}` };
  }
  const clocks = [s.recoveryAt, s.testamentAt].filter((x): x is number => x != null);
  if (clocks.some((at) => at <= now)) return { tone: "warn", label: "OWNER INACTIVE", detail: "an inactivity clock has run out" };
  if (clocks.some((at) => at - now <= 14 * 86_400)) return { tone: "warn", label: "CLOCK RUNNING", detail: `inactivity clock ends in ${fmtDuration(Math.min(...clocks) - now)}` };
  return { tone: "ok", label: "ALL CLEAR", detail: "no pending withdrawal" };
}

export interface Clock {
  label: string;
  /** unix seconds; the popup ticks a countdown to it */
  at: number;
  text: string;
  tone: Tone;
}

export function clocks(s: ExtSnapshot, now: number): Clock[] {
  const out: Clock[] = [];
  if (s.lockdownUntil > now) out.push({ label: "Lockdown / freeze ends", at: s.lockdownUntil, text: fmtDate(s.lockdownUntil), tone: "bad" });
  if (s.pending) out.push({ label: s.pending.kind === "migrate" ? "Migration executes" : "Withdrawal executes", at: s.pending.executableAt, text: fmtDate(s.pending.executableAt), tone: "warn" });
  if (s.recoveryAt != null) out.push({ label: "Recovery takeover", at: s.recoveryAt, text: fmtDate(s.recoveryAt), tone: s.recoveryAt - now <= 14 * 86_400 ? "warn" : "dim" });
  if (s.testamentAt != null) out.push({ label: "Testament opens", at: s.testamentAt, text: fmtDate(s.testamentAt), tone: s.testamentAt - now <= 14 * 86_400 ? "warn" : "dim" });
  for (const l of s.letters) out.push({ label: `Letter ${l.label ? `"${l.label}"` : `#${l.id}`}`, at: l.opensAt, text: fmtDate(l.opensAt), tone: "dim" });
  return out;
}

/** "71 h 4 min 09 s" style countdown for the popup; "now" once passed. */
export function countdown(secs: number): string {
  if (secs <= 0) return "now";
  const d = Math.floor(secs / 86_400), h = Math.floor((secs % 86_400) / 3600), m = Math.floor((secs % 3600) / 60), x = Math.floor(secs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(x)}s`;
  return `${m}m ${pad(x)}s`;
}

export const solText = (lamports: number) => fmtSol(lamports);
