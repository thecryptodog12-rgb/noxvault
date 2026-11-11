// Snapshot → notifications. The "what deserves an alert" rules and their stable dedupe keys come
// from the site's Telegram bot logic (web/lib/alerts/logic.ts, alertsFor); this file only words
// them for a desktop notification and decides where a click goes. Pure; tested in test/alerts.test.ts.
import { SOL_MINT, alertsFor, fmtDate, fmtDuration, fmtSol } from "../../../web/lib/alerts/logic";
import { shortAddr, siteLinks } from "./net";
import type { AlertKind, ExtAlert, ExtSnapshot, TokenBalance } from "./types";

/** Kinds that become a desktop notification. Schedule payouts are routine and only show in the popup. */
export const NOTIFY_KINDS: ReadonlySet<AlertKind> = new Set(["pending", "migrate", "lockdown", "recovery", "testament", "letter"]);

/** A token amount in human units when the vault holds that mint (decimals known), else base units. */
export function fmtTokenAmount(mint: string, amount: string, tokens: TokenBalance[]): string {
  if (mint === SOL_MINT) return fmtSol(amount);
  const t = tokens.find((x) => x.mint === mint);
  if (!t) return `${amount} base units of ${shortAddr(mint)}`;
  const raw = BigInt(amount);
  const d = 10n ** BigInt(t.decimals);
  const whole = raw / d;
  const frac = (raw % d).toString().padStart(t.decimals, "0").replace(/0+$/, "").slice(0, 6);
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""} of ${shortAddr(mint)}`;
}

const when = (at: number, now: number) => (at <= now ? "can execute now" : `executes in ${fmtDuration(at - now)}`);

export function extAlerts(prev: ExtSnapshot | null, cur: ExtSnapshot, now: number): ExtAlert[] {
  const v = cur.vault;
  const tag = shortAddr(v);
  const links = siteLinks(v);
  const out: ExtAlert[] = [];
  for (const a of alertsFor(prev, cur, now)) {
    const kind = a.key.split(":")[0] as AlertKind;
    const base = { id: `${cur.cluster}:${v}:${a.key}`, kind, vault: v };
    switch (kind) {
      case "pending": {
        const p = cur.pending!;
        out.push({
          ...base,
          title: `Pending withdrawal · vault ${tag}`,
          message: `⚠️ ${fmtTokenAmount(p.mint, p.amount, cur.tokens)} wants to leave vault ${tag} to ${shortAddr(p.dest)}: ${when(p.executableAt, now)}. Not you? Cancel with your recovery phrase.`,
          url: links.recovery,
          urgent: true,
        });
        break;
      }
      case "migrate": {
        const p = cur.pending!;
        out.push({
          ...base,
          title: `Pending migration · vault ${tag}`,
          message: `⚠️ All funds of vault ${tag} want to move to ${shortAddr(p.dest)}: ${when(p.executableAt, now)}. Not you? Cancel with your recovery phrase.`,
          url: links.recovery,
          urgent: true,
        });
        break;
      }
      case "lockdown":
        out.push({
          ...base,
          title: `Lockdown · vault ${tag}`,
          message: `🚨 The duress phrase was used. Vault ${tag} refuses withdrawals until ${fmtDate(cur.lockdownUntil)}. Check on the owner; only the recovery key can end it early.`,
          url: links.recovery,
          urgent: true,
        });
        break;
      case "recovery":
      case "testament": {
        const at = kind === "recovery" ? cur.recoveryAt! : cur.testamentAt!;
        const what = kind === "recovery" ? "the recovery key can take over" : "the testament can pay out to the heirs";
        const open = at <= now;
        out.push({
          ...base,
          title: `${kind === "recovery" ? "Recovery" : "Testament"} clock · vault ${tag}`,
          message: open
            ? `⌛ Owner inactive: ${what} now. If you are the owner, ping the vault on nox-vault.com to reset the clock.`
            : `⏳ In ${fmtDuration(at - now)} ${what} (owner inactive). If you are the owner, ping the vault to reset the clock.`,
          url: links.owner,
          urgent: false,
        });
        break;
      }
      case "letter": {
        const l = cur.letters.find((x) => a.key.startsWith(`letter:${x.id}:`));
        out.push({
          ...base,
          title: `Sealed letter · vault ${tag}`,
          message: `✉️ ${l?.label ? `"${l.label}"` : "A sealed letter"} becomes readable in ${l ? fmtDuration(l.opensAt - now) : "under 7 days"}.`,
          url: links.letters,
          urgent: false,
        });
        break;
      }
      case "schedule":
        out.push({ ...base, title: `Scheduled payout · vault ${tag}`, message: a.text.replace(/\n.*$/s, ""), url: links.view, urgent: false });
        break;
    }
  }
  return out;
}

/**
 * Which alerts are new (never notified), given the ids already notified. Returns the alerts to
 * notify now and the updated seen-map (id → first-notified unix time). Seen ids older than
 * `keepSecs` that no longer hold are dropped so the map cannot grow without bound.
 */
export function dedupe(
  alerts: ExtAlert[],
  seen: Record<string, number>,
  now: number,
  keepSecs = 60 * 86_400
): { fresh: ExtAlert[]; seen: Record<string, number> } {
  const next: Record<string, number> = {};
  const live = new Set(alerts.map((a) => a.id));
  for (const [id, at] of Object.entries(seen)) if (live.has(id) || now - at < keepSecs) next[id] = at;
  const fresh: ExtAlert[] = [];
  for (const a of alerts) {
    if (next[a.id] != null) continue;
    next[a.id] = now;
    if (NOTIFY_KINDS.has(a.kind)) fresh.push(a);
  }
  return { fresh, seen: next };
}

/** Red badge number: urgent conditions (pending withdrawal / migration, lockdown) that hold right now. */
export function badgeCount(snaps: (ExtSnapshot | null | undefined)[], now: number): number {
  let n = 0;
  for (const s of snaps) {
    if (!s) continue;
    if (s.pending) n++;
    if (s.lockdownUntil > now) n++;
  }
  return n;
}
