// Telegram alerts: pure logic, no I/O. A vault is read into a VaultSnapshot (lib/alerts/chain.ts);
// alertsFor(prev, cur, now) turns "what is true now / what changed since the last snapshot" into
// messages, each with a stable dedupe key, and handleCommand answers chat commands through
// injected dependencies. Everything here is unit-tested in logic.test.ts.

export const SOL_MINT = "11111111111111111111111111111111";
export const DAY = 86_400;
/** Deadline warnings, in days before the recovery takeover / testament can run. */
export const DEADLINE_STEPS = [14, 3, 1] as const;
/** Warn about a sealed letter whose round is this close. */
export const LETTER_WARN_SECS = 7 * DAY;
export const MAX_WATCH = 5;

// drand quicknet (the tlock chain used for sealed letters, docs/SPEC.md §12): 3 s rounds.
export const QUICKNET_GENESIS = 1692803367;
export const QUICKNET_PERIOD = 3;
/** Unix seconds at which a quicknet round is published, i.e. when a letter sealed to it opens. */
export function quicknetRoundTime(round: number | bigint): number {
  return QUICKNET_GENESIS + (Number(round) - 1) * QUICKNET_PERIOD;
}

export interface SnapPending {
  kind: "withdraw" | "migrate";
  mint: string;
  dest: string;
  amount: string; // base units
  executableAt: number;
}
export interface SnapSchedule {
  id: number;
  mint: string;
  dest: string;
  amount: string;
  remaining: number;
  nextAt: number;
}
export interface SnapLetter {
  id: number;
  label: string;
  unlockRound: string;
  opensAt: number;
}

export interface VaultSnapshot {
  vault: string;
  takenAt: number;
  lamports: number;
  pending: SnapPending | null;
  lockdownUntil: number;
  /** When the recovery key may act fully (owner inactivity); null without a recovery key. */
  recoveryAt: number | null;
  /** When anyone may run the testament; null without one. */
  testamentAt: number | null;
  schedules: SnapSchedule[];
  letters: SnapLetter[];
}

export interface Alert {
  /** Stable per event: the same event never produces two keys, a new event gets a new one. */
  key: string;
  text: string;
}

// ---------- formatting ----------

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function fmtSol(lamports: number | bigint | string): string {
  const n = Number(lamports) / 1e9;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;
}

export function fmtAmount(mint: string, amount: string): string {
  return mint === SOL_MINT ? fmtSol(amount) : `${amount} base units of token ${shortAddr(mint)}`;
}

/** "2026-11-03 14:05 UTC" */
export function fmtDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** "3 days 4 h", "5 h 12 min", "8 min" */
export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return h ? `${d} day${d > 1 ? "s" : ""} ${h} h` : `${d} day${d > 1 ? "s" : ""}`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(m, 1)} min`;
}

// ---------- what changed → messages ----------

/** The tightest warning step already reached, e.g. 2.5 days left → 3. null when further away than 14 days or past. */
export function deadlineStep(at: number, now: number): number | null {
  const left = at - now;
  if (left <= 0) return null;
  let step: number | null = null;
  for (const d of DEADLINE_STEPS) if (left <= d * DAY) step = d;
  return step;
}

/**
 * Alerts for one vault. State-based alerts (pending withdrawal, lockdown, deadlines, letters) are
 * produced whenever the state holds and deduped by key by the caller, so a chat that starts watching
 * later still hears about a pending withdrawal. Schedule payouts need the previous snapshot.
 */
export function alertsFor(prev: VaultSnapshot | null, cur: VaultSnapshot, now: number, siteUrl = ""): Alert[] {
  const v = cur.vault;
  const tag = `Vault ${shortAddr(v)}`;
  const link = siteUrl ? `\n${siteUrl}/t/${v}` : "";
  const out: Alert[] = [];

  const p = cur.pending;
  if (p) {
    const when = p.executableAt <= now ? "It can execute now." : `It executes at ${fmtDate(p.executableAt)} (in ${fmtDuration(p.executableAt - now)}).`;
    if (p.kind === "withdraw") {
      out.push({
        key: `pending:${p.executableAt}:${p.dest}:${p.amount}:${p.mint}`,
        text: `⚠️ ${tag}: new pending withdrawal of ${fmtAmount(p.mint, p.amount)} to ${p.dest}.\n${when}\nIf this is not you, cancel it with your recovery key.${link}`,
      });
    } else {
      out.push({
        key: `migrate:${p.executableAt}:${p.dest}`,
        text: `⚠️ ${tag}: pending migration of all funds to ${p.dest}.\n${when}\nIf this is not you, cancel it with your recovery key.${link}`,
      });
    }
  }

  const locked = cur.lockdownUntil > now;
  if (locked) {
    // Two causes lock a vault (docs/SPEC.md §11): a duress withdrawal, or the recovery phrase's
    // "cancel and freeze" (CancelLock, v4.2). A payout that vanished together with the start of the
    // lockdown means the latter; otherwise the alert names both.
    const frozeAPayout = prev != null && prev.pending != null && cur.pending == null && prev.lockdownUntil <= prev.takenAt;
    out.push({
      key: `lockdown:${cur.lockdownUntil}`,
      text: frozeAPayout
        ? `🧊 ${tag}: the pending payout was cancelled and the vault is frozen until ${fmtDate(cur.lockdownUntil)} (the recovery phrase's cancel and freeze). Until then the main phrase alone can only Ping or cancel: nothing can be withdrawn with it, and its Pings do not count as activity. The owner can still move everything to a new vault with the main phrase and the recovery phrase together.${link}`
        : `🚨 ${tag}: lockdown started, until ${fmtDate(cur.lockdownUntil)}. Either the duress phrase was used, or the recovery phrase cancelled a payout and froze the vault (anti-theft). Withdrawals with the main phrase alone are refused until then. Only the recovery key can end it early; check on the owner before you do.${link}`,
    });
  }

  const clocks: [string, number | null, string, string][] = [
    ["recovery", cur.recoveryAt, "the recovery key can take over the vault", "the recovery key can now take over the vault"],
    ["testament", cur.testamentAt, "the testament can pay out to the heirs", "the testament can now pay out to the heirs"],
  ];
  for (const [name, at, soon, open] of clocks) {
    if (at == null) continue;
    const step = deadlineStep(at, now);
    if (step != null) {
      out.push({
        key: `${name}:${at}:${step}`,
        text: `⏳ ${tag}: in ${fmtDuration(at - now)} (${fmtDate(at)}) ${soon}, because the owner has been inactive. ${
          locked ? "The vault is in lockdown, so Pings by the main phrase do not reset this clock." : "If you are the owner, ping to reset the clock."
        }${link}`,
      });
    } else if (at <= now) {
      out.push({ key: `${name}:${at}:open`, text: `⌛ ${tag}: the inactivity period has passed; ${open}. If you are the owner, ping now to reset the clock.${link}` });
    }
  }

  for (const l of cur.letters) {
    const left = l.opensAt - now;
    if (left > 0 && left <= LETTER_WARN_SECS) {
      out.push({
        key: `letter:${l.id}:${l.unlockRound}`,
        text: `✉️ ${tag}: sealed letter ${l.label ? `"${l.label}"` : `#${l.id}`} becomes readable at ${fmtDate(l.opensAt)} (in ${fmtDuration(left)}). If you are the owner and that is too early, open the vault to re-seal it to a later date.${link}`,
      });
    }
  }

  if (prev) {
    for (const old of prev.schedules) {
      const s = cur.schedules.find((x) => x.id === old.id);
      if (s && s.remaining < old.remaining) {
        const n = old.remaining - s.remaining;
        out.push({
          key: `schedule:${s.id}:${s.remaining}`,
          text: `✅ ${tag}: scheduled payout #${s.id} ran ${n === 1 ? "once" : `${n} times`}: ${fmtAmount(s.mint, s.amount)} to ${shortAddr(s.dest)} each. ${s.remaining} left${s.remaining ? `, next at ${fmtDate(s.nextAt)}` : ""}.${link}`,
        });
      } else if (!s) {
        out.push({
          key: `schedule:${old.id}:gone:${old.remaining}`,
          text: `✅ ${tag}: scheduled payout #${old.id} (${fmtAmount(old.mint, old.amount)} to ${shortAddr(old.dest)}) has ended: its last payment ran, or it was cancelled.${link}`,
        });
      }
    }
  }
  return out;
}

// ---------- /status ----------

export function formatStatus(s: VaultSnapshot, now: number, siteUrl = ""): string {
  const lines = [`Vault ${s.vault}`, `Balance: ${fmtSol(s.lamports)}`];
  const p = s.pending;
  lines.push(
    p
      ? `Pending ${p.kind === "withdraw" ? `withdrawal: ${fmtAmount(p.mint, p.amount)}` : "migration"} to ${p.dest}, ${p.executableAt <= now ? "executable now" : `executes ${fmtDate(p.executableAt)}`}`
      : "Pending payout: none"
  );
  lines.push(s.lockdownUntil > now ? `Lockdown: ACTIVE until ${fmtDate(s.lockdownUntil)} (main-phrase Pings do not reset the clocks meanwhile)` : "Lockdown: no");
  const clock = (name: string, at: number | null) =>
    at == null ? `${name}: not set` : at <= now ? `${name}: open since ${fmtDate(at)} (owner inactive)` : `${name}: ${fmtDate(at)} (in ${fmtDuration(at - now)}) unless the owner pings`;
  lines.push(clock("Recovery takeover", s.recoveryAt));
  lines.push(clock("Testament", s.testamentAt));
  if (s.schedules.length) lines.push(`Scheduled payouts: ${s.schedules.length}`);
  if (s.letters.length) {
    lines.push("Sealed letters:");
    for (const l of s.letters) lines.push(`  ${l.label ? `"${l.label}"` : `#${l.id}`}: ${l.opensAt <= now ? "readable since" : "opens"} ${fmtDate(l.opensAt)}`);
  } else lines.push("Sealed letters: none");
  if (siteUrl) lines.push(`${siteUrl}/t/${s.vault}`);
  return lines.join("\n");
}

// ---------- commands ----------

export interface WatchStore {
  list(chat: string): Promise<string[]>;
  add(chat: string, vault: string): Promise<void>;
  remove(chat: string, vault: string): Promise<boolean>;
}

export interface CommandDeps {
  store: WatchStore | null; // null = storage not configured
  /** Validated base58 vault address, or null when the text is not a Solana address. */
  parseAddress(s: string): string | null;
  /** Snapshot of an initialized Noxvault; null when the address is not one. */
  snapshot(vault: string): Promise<VaultSnapshot | null>;
  now(): number;
  siteUrl: string;
}

export const START_TEXT = [
  "Noxvault alerts. I watch vaults on-chain and message you when something needs attention:",
  "• a new pending withdrawal (so the recovery key can cancel it in time)",
  "• a lockdown (the duress phrase was used, or the recovery phrase cancelled a payout and froze the vault)",
  "• the recovery or testament clock running out (14, 3 and 1 day before)",
  "• a sealed letter opening within 7 days",
  "• scheduled payouts that ran",
  "",
  "Commands:",
  "/watch <vault>: watch a vault (up to 5 per chat)",
  "/unwatch <vault>: stop watching",
  "/list: the vaults this chat watches",
  "/status <vault>: balance, pending payout, lockdown, clocks and letters",
  "",
  "I only read public on-chain data. I never need your phrase, recovery code or any key: never send them to me or anyone else.",
].join("\n");

export const STORAGE_MISSING = "Alerts storage is not configured on this server yet (KV_REST_API_URL / KV_REST_API_TOKEN). /status still works.";

/** Looks like a pasted recovery phrase: 12 or more plain lowercase words. */
export function looksLikePhrase(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 12 && words.every((w) => /^[a-z]{3,8}$/.test(w));
}

/** Splits "/watch@NoxBot  ABC" into ["watch", "ABC"]. null for non-commands. */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() } : null;
}

export async function handleCommand(text: string, chat: string, d: CommandDeps): Promise<string | null> {
  if (looksLikePhrase(text)) {
    return "⚠️ That looks like a recovery phrase. Delete that message now. This bot never needs a phrase, and anyone who has it can sign for your vault. If it is a real phrase, treat it as exposed and move your funds to a new vault.";
  }
  const c = parseCommand(text);
  if (!c) return null;
  const needVault = async (): Promise<string | { error: string }> => {
    if (!c.arg) return { error: `Usage: /${c.cmd} <vault address>` };
    const a = d.parseAddress(c.arg.split(/\s+/)[0]);
    return a ?? { error: "That is not a Solana address." };
  };

  switch (c.cmd) {
    case "start":
    case "help":
      return START_TEXT;
    case "list": {
      if (!d.store) return STORAGE_MISSING;
      const vs = await d.store.list(chat);
      return vs.length ? `This chat watches:\n${vs.map((v) => `• ${v}`).join("\n")}` : "This chat watches no vaults yet. Use /watch <vault>.";
    }
    case "watch": {
      if (!d.store) return STORAGE_MISSING;
      const v = await needVault();
      if (typeof v !== "string") return v.error;
      const have = await d.store.list(chat);
      if (have.includes(v)) return `Already watching ${shortAddr(v)}.`;
      if (have.length >= MAX_WATCH) return `This chat already watches ${MAX_WATCH} vaults, the maximum. /unwatch one first.`;
      const s = await d.snapshot(v);
      if (!s) return "No Noxvault at that address.";
      await d.store.add(chat, v);
      return `Watching ${shortAddr(v)}. You will get a message when something needs attention.\n\n${formatStatus(s, d.now(), d.siteUrl)}`;
    }
    case "unwatch": {
      if (!d.store) return STORAGE_MISSING;
      const v = await needVault();
      if (typeof v !== "string") return v.error;
      return (await d.store.remove(chat, v)) ? `Stopped watching ${shortAddr(v)}.` : `This chat was not watching ${shortAddr(v)}.`;
    }
    case "status": {
      const v = await needVault();
      if (typeof v !== "string") return v.error;
      const s = await d.snapshot(v);
      return s ? formatStatus(s, d.now(), d.siteUrl) : "No Noxvault at that address.";
    }
    default:
      return "Unknown command. /start lists what I can do.";
  }
}
