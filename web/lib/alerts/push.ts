// Web Push alerts: pure logic, no I/O (docs/ALERTS.md). The same Alert objects the Telegram bot
// sends (lib/alerts/logic.ts alertsFor) become notification payloads here; subscriptions are
// checked before the server ever posts to their endpoint. Tests: push.test.ts.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { shortAddr, type Alert } from "./logic";

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin path the notification opens. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
  /** Stays on screen until the user acts (pending payouts, lockdowns). */
  urgent: boolean;
}

/**
 * Hosts of the browser push services. The server only ever posts to these, so a made-up
 * "subscription" cannot point it at an arbitrary URL.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isPushEndpoint(raw: string): boolean {
  if (raw.length > 1024) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname));
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** A PushSubscription as JSON (subscription.toJSON()), or null when anything is off. */
export function parseSubscription(x: unknown): PushSub | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = o.endpoint, p256dh = o.keys?.p256dh, auth = o.keys?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!isPushEndpoint(endpoint)) return null;
  // p256dh: an uncompressed P-256 point (65 bytes ≈ 87 chars); auth: 16 bytes (≈ 22 chars)
  if (!B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null;
  if (!B64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Stable id for a subscription, so Redis keys never contain the (secret) endpoint URL. */
export function subId(endpoint: string): string {
  return bytesToHex(sha256(utf8ToBytes(endpoint))).slice(0, 32);
}

const TITLES: [string, string][] = [
  ["pending:", "Pending withdrawal"],
  ["migrate:", "Pending migration"],
  ["lockdown:", "Lockdown started"],
  ["recovery:", "Recovery clock"],
  ["testament:", "Testament clock"],
  ["letter:", "Sealed letter"],
  ["schedule:", "Scheduled payout"],
];

/** Pending payouts open the recovery page (where the recovery key can cancel); the rest open the vault page. */
export function pushPayload(a: Alert, vault: string): PushPayload {
  const kind = TITLES.find(([p]) => a.key.startsWith(p));
  const cancellable = a.key.startsWith("pending:") || a.key.startsWith("migrate:");
  const body = a.text
    .split("\n")
    .filter((l) => !/^https?:\/\//.test(l.trim()))
    .join("\n")
    .replace(/^\S+ Vault [^:]+: /, "")
    .trim();
  return {
    title: `${kind ? kind[1] : "Noxvault alert"} · vault ${shortAddr(vault)}`,
    body,
    url: cancellable ? `/recovery?vault=${vault}` : `/t/${vault}`,
    tag: `${vault}:${subId(a.key).slice(0, 16)}`,
    urgent: cancellable || a.key.startsWith("lockdown:"),
  };
}

/** The confirmation sent right after someone turns alerts on, so they see it works. */
export function welcomePayload(vault: string): PushPayload {
  return {
    title: `Alerts on · vault ${shortAddr(vault)}`,
    body: "This device will be warned when a withdrawal is pending, so your recovery key can cancel it in time.",
    url: `/t/${vault}`,
    tag: `${vault}:welcome`,
    urgent: false,
  };
}

// ---------- browser helpers (pure) ----------

/** iPhone / iPad, including iPadOS that reports itself as a Mac. */
export function isIosDevice(ua: string, platform = "", maxTouchPoints = 0): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

/** The VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
export function vapidKeyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
