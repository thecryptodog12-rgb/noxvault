import { describe, expect, it } from "vitest";
import { DAY, SOL_MINT, alertsFor, type VaultSnapshot } from "./logic";
import { isIosDevice, isPushEndpoint, parseSubscription, pushPayload, subId, vapidKeyBytes, welcomePayload } from "./push";
import { PRESETS, PRESET_SETTINGS } from "@/lib/presets";

const NOW = 1_800_000_000;
const V = "CGiG5w5aiiMSNq2bJfjQ1rJuxcHGrTGDXs3wrR4FLc2V";
const DEST = "9BGzxXGPpoQnFisTDGmEmaxy1hbzmd2yXSmivsfgbLA5";
const snap = (over: Partial<VaultSnapshot> = {}): VaultSnapshot => ({
  vault: V, takenAt: NOW, lamports: 1e9, pending: null, lockdownUntil: 0, recoveryAt: null, testamentAt: null, schedules: [], letters: [], ...over,
});

const P256 = "B" + "A".repeat(86); // 87 chars, the length of a base64url P-256 point
const AUTH = "abcdefghijklmnopqrstuv"; // 22 chars
const FCM = "https://fcm.googleapis.com/fcm/send/abc:def";

describe("isPushEndpoint", () => {
  it("accepts the browser push services", () => {
    for (const u of [
      FCM,
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://web.push.apple.com/QM2x",
      "https://wns2-db5p.notify.windows.com/w/?token=x",
    ])
      expect(isPushEndpoint(u)).toBe(true);
  });
  it("refuses anything else", () => {
    for (const u of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com.evil.com/x",
      "https://evil.com/fcm.googleapis.com",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://localhost/x",
      "https://169.254.169.254/latest",
      "not a url",
      "https://fcm.googleapis.com/" + "x".repeat(1100),
    ])
      expect(isPushEndpoint(u)).toBe(false);
  });
});

describe("parseSubscription", () => {
  it("keeps endpoint and keys only", () => {
    expect(parseSubscription({ endpoint: FCM, expirationTime: null, keys: { p256dh: P256, auth: AUTH, extra: 1 } })).toEqual({ endpoint: FCM, keys: { p256dh: P256, auth: AUTH } });
  });
  it("refuses bad shapes, hosts and keys", () => {
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("x")).toBeNull();
    expect(parseSubscription({ endpoint: FCM })).toBeNull();
    expect(parseSubscription({ endpoint: "https://evil.com/x", keys: { p256dh: P256, auth: AUTH } })).toBeNull();
    expect(parseSubscription({ endpoint: FCM, keys: { p256dh: "short", auth: AUTH } })).toBeNull();
    expect(parseSubscription({ endpoint: FCM, keys: { p256dh: P256, auth: "has spaces in it ok?" } })).toBeNull();
  });
});

describe("subId", () => {
  it("is stable, 32 hex chars, and differs per endpoint", () => {
    expect(subId(FCM)).toMatch(/^[0-9a-f]{32}$/);
    expect(subId(FCM)).toBe(subId(FCM));
    expect(subId(FCM + "x")).not.toBe(subId(FCM));
  });
});

describe("pushPayload", () => {
  it("turns a pending withdrawal into an urgent notification that opens the recovery page", () => {
    const cur = snap({ pending: { kind: "withdraw", mint: SOL_MINT, dest: DEST, amount: "1500000000", executableAt: NOW + 3 * DAY } });
    const [a] = alertsFor(null, cur, NOW, "https://site");
    const p = pushPayload(a, V);
    expect(p.title).toBe("Pending withdrawal · vault CGiG…Lc2V");
    expect(p.body.startsWith("new pending withdrawal of 1.5 SOL")).toBe(true);
    expect(p.body).toContain("cancel it with your recovery key");
    expect(p.body).not.toContain("https://site"); // the link line is dropped: the click opens the url
    expect(p.url).toBe(`/recovery?vault=${V}`);
    expect(p.urgent).toBe(true);
    expect(p.tag).toBe(`${V}:${subId(a.key).slice(0, 16)}`);
  });
  it("sends other alerts to the vault page, not urgent", () => {
    const [a] = alertsFor(null, snap({ recoveryAt: NOW + 2 * DAY }), NOW);
    const p = pushPayload(a, V);
    expect(p.title.startsWith("Recovery clock")).toBe(true);
    expect(p.url).toBe(`/t/${V}`);
    expect(p.urgent).toBe(false);
  });
  it("marks a lockdown urgent and fits in a push message", () => {
    const [a] = alertsFor(null, snap({ lockdownUntil: NOW + DAY }), NOW, "https://site");
    const p = pushPayload(a, V);
    expect(p.urgent).toBe(true);
    expect(JSON.stringify(p).length).toBeLessThan(3000);
    expect(JSON.stringify(welcomePayload(V)).length).toBeLessThan(3000);
  });
});

describe("browser helpers", () => {
  it("detects iPhone and iPadOS", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 15)")).toBe(false);
  });
  it("decodes a base64url VAPID key", () => {
    expect([...vapidKeyBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("anti-theft preset", () => {
  it("comes right after Personal and is described, but kept off the project page", () => {
    expect(PRESETS.map(([p]) => p).slice(0, 2)).toEqual(["personal", "antitheft"]);
    expect(PRESET_SETTINGS.antitheft?.personal).toBe(true);
    expect(PRESET_SETTINGS.antitheft?.settings.join(" ")).toMatch(/apart from your main phrase/);
  });
});
