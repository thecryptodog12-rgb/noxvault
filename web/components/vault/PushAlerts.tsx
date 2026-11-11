"use client";
// "Warn me on this device": Web Push alerts for one vault (docs/ALERTS.md). The browser makes a
// push subscription for this site; /api/push stores it with the vault address, and the alert
// cron sends the same alerts as the Telegram bot. Nothing secret leaves the browser.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellOff, BellRing } from "lucide-react";
import { isIosDevice, vapidKeyBytes } from "@/lib/alerts/push";
import { errMsg } from "@/lib/format";

const VAPID = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();

type Env = { supported: boolean; ios: boolean; standalone: boolean; permission: NotificationPermission | "n/a" };

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  if (reg.active) return reg;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, no) => setTimeout(() => no(new Error("The service worker did not start. Reload the page and try again.")), 15_000)),
  ]);
}

async function api(body: object): Promise<{ vaults: string[]; test?: boolean }> {
  const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

export default function PushAlerts({ vault, compact = false }: { vault: string; compact?: boolean }) {
  const [env, setEnv] = useState<Env | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const check = useCallback(async () => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const nav = navigator as Navigator & { standalone?: boolean };
    setEnv({
      supported,
      ios: isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
      standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
      permission: "Notification" in window ? Notification.permission : "n/a",
    });
    if (!supported || !VAPID) return setOn(false);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return setOn(false);
      const { vaults } = await api({ action: "status", endpoint: sub.endpoint });
      setOn(vaults.includes(vault));
    } catch {
      setOn(false);
    }
  }, [vault]);

  useEffect(() => {
    check();
  }, [check]);

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications were not allowed. Allow them for this site in your browser settings, then try again.");
      const reg = await registration();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(VAPID) }));
      const r = await api({ action: "subscribe", vault, subscription: sub.toJSON() });
      setOn(true);
      setMsg({ kind: "ok", text: r.test ? "Alerts are on. A test notification is on its way." : "Alerts are on." });
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(false);
      setEnv((x) => (x ? { ...x, permission: "Notification" in window ? Notification.permission : "n/a" } : x));
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const { vaults } = await api({ action: "unsubscribe", vault, endpoint: sub.endpoint });
        if (!vaults.length) await sub.unsubscribe().catch(() => {}); // no other vault uses it
      }
      setOn(false);
      setMsg({ kind: "ok", text: "Alerts are off for this vault on this device." });
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!env) return null;
  const iosNeedsHome = env.ios && !env.standalone;

  let body: React.ReactNode;
  if (!VAPID) body = <p className="text-dim">Push alerts are not set up on this server yet.</p>;
  else if (iosNeedsHome)
    body = (
      <p className="text-mute">
        On iPhone and iPad, alerts only work from the home screen: tap <strong className="text-bone">Share → Add to Home Screen</strong>, open Noxvault from the
        new icon and come back to this vault.
      </p>
    );
  else if (!env.supported) body = <p className="text-dim">This browser does not support push notifications.</p>;
  else
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3">
          {on ? (
            <>
              <span className="flex items-center gap-1.5 text-teal">
                <BellRing size={14} /> Alerts on for this device
              </span>
              <button className="btn ghost sm" onClick={turnOff} disabled={busy}>
                <BellOff size={13} /> {busy ? "…" : "turn off"}
              </button>
            </>
          ) : (
            <button className="btn outline sm" onClick={turnOn} disabled={busy || on === null}>
              <BellRing size={13} /> {busy ? "turning on…" : "Warn me on this device"}
            </button>
          )}
        </div>
        {env.permission === "denied" && !on && <p className="text-warn">Notifications are blocked for this site. Allow them in your browser settings first.</p>}
        {!compact && (
          <p className="text-[11px] text-dim">
            Checks run on a schedule, so a warning can arrive some minutes after the event. The server stores this device&apos;s push address with the
            vault address, nothing else. Also on{" "}
            <Link className="underline" href="/alerts">
              Telegram
            </Link>
            .
          </p>
        )}
      </>
    );

  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      {!compact && <p className="text-mute">Get a notification on this device when a withdrawal is pending, so your recovery key can cancel it in time.</p>}
      {body}
      {msg && <p className={msg.kind === "ok" ? "text-teal" : "text-bad"}>{msg.text}</p>}
    </div>
  );
}
