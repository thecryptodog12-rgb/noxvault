// Sends Web Push messages with the `web-push` package (VAPID). Server only.
import "server-only";
import webpush from "web-push";
import type { PushPayload, PushSub } from "./push";

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** null when push is not configured (no VAPID keys in the environment). */
export function vapidFromEnv(): Vapid | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "https://www.nox-vault.com";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

export type PushResult = { ok: true } | { ok: false; status: number; gone: boolean; description: string };

/** Alerts must reach the device while the delay runs; a push service may hold a message this long (s). */
const TTL_SECS = 12 * 3600;

export async function sendPush(v: Vapid, sub: PushSub, payload: PushPayload): Promise<PushResult> {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      vapidDetails: v,
      TTL: TTL_SECS,
      urgency: payload.urgent ? "high" : "normal",
      timeout: 10_000,
    });
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    // 404 / 410: the subscription expired or the user revoked permission
    return { ok: false, status, gone: status === 404 || status === 410, description: e instanceof Error ? e.message : String(e) };
  }
}
