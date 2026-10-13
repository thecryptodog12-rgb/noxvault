// $NOX launch commands: /ca, /links, /buy. Pure text builders so they can be tested without Telegram.

export const SITE_URL = "https://www.nox-vault.com";
export const BUY_URL = `${SITE_URL}/buy`;
export const WHITEPAPER_URL = `${SITE_URL}/whitepaper`;
export const X_URL = "https://x.com/noxvaultHQ";
export const DEFAULT_LAUNCH_AT = "2026-10-13T20:00:00+02:00";

export interface LaunchInfo {
  /** $NOX mint on mainnet; empty until launch. */
  token: string;
  /** ISO time of the pump.fun launch. */
  launchAt: string;
}

export const pumpUrl = (token: string) => `https://pump.fun/coin/${token}`;

const NO_DMS = "Nobody from Noxvault will DM you. Only trust the CA on nox-vault.com and @noxvaultHQ.";

/** Launch time in CEST/CET, e.g. "20:00 CEST". */
export function launchClock(launchAt: string): string {
  const d = new Date(launchAt);
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", timeZoneName: "short" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value;
  return zone ? `${hm} ${zone}` : hm;
}

/** "2h 14m" (or "45s" in the last minute); null once the launch time has passed. */
export function timeLeft(launchAt: string, now: number): string | null {
  const s = Math.floor((Date.parse(launchAt) - now) / 1000);
  if (!(s > 0)) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function caText(info: LaunchInfo, now = Date.now()): string {
  if (info.token) {
    return (
      "<b>$NOX contract address</b>\n" +
      `<code>${info.token}</code>\n\n` +
      `Buy on pump.fun: ${pumpUrl(info.token)}\n` +
      `How to buy: ${BUY_URL}\n\n` +
      `⚠️ ${NO_DMS}`
    );
  }
  const left = timeLeft(info.launchAt, now);
  return (
    `<b>$NOX</b> launches on pump.fun at <b>${launchClock(info.launchAt)}</b>` +
    (left ? ` — in ${left}.` : " — any moment now.") +
    "\n\nThe contract address will be posted on " +
    `${SITE_URL} and ${X_URL} at launch. Anything posted before that is fake.\n\n` +
    `⚠️ ${NO_DMS}`
  );
}

export function linksText(): string {
  return (
    "<b>Noxvault links</b>\n" +
    `Site: ${SITE_URL}\n` +
    `X: ${X_URL}\n` +
    `How to buy $NOX: ${BUY_URL}\n` +
    `Whitepaper: ${WHITEPAPER_URL}`
  );
}

export function buyText(info: LaunchInfo): string {
  return (
    "<b>How to buy $NOX</b>\n" +
    "1. Get a Solana wallet: Phantom, Solflare or Backpack.\n" +
    "2. Buy some SOL on an exchange or in the wallet app, plus a little for fees.\n" +
    `3. Open pump.fun via our link${info.token ? ` (${pumpUrl(info.token)})` : " (posted at launch)"} and check the CA matches the one on nox-vault.com` +
    " (/ca).\n" +
    "4. Swap SOL for $NOX and confirm in your wallet.\n" +
    "5. Optional: hold it in your Noxvault vault for tiers.\n\n" +
    `Full guide: ${BUY_URL}\n\n` +
    `⚠️ ${NO_DMS}`
  );
}
