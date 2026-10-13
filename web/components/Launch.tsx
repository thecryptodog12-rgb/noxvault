"use client";
import { useEffect, useState } from "react";
import { NOX_LAUNCH_AT, NOX_TOKEN } from "@/lib/config";

/** Time left until the $NOX launch as "02h 14m 09s", or null once it has passed (or before mount). */
export function useCountdown(): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null || NOX_TOKEN) return null;
  const left = Math.floor((Date.parse(NOX_LAUNCH_AT) - now) / 1000);
  if (!(left > 0)) return null;
  const d = Math.floor(left / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(Math.floor((left % 86400) / 3600))}h ${pad(Math.floor((left % 3600) / 60))}m ${pad(left % 60)}s`;
  return d ? `${d}d ${hms}` : hms;
}

/** Launch time in the viewer's own time zone, e.g. "20:00". */
export function launchClock(): string {
  return new Date(NOX_LAUNCH_AT).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function Countdown({ className = "" }: { className?: string }) {
  const left = useCountdown();
  return <span className={`tabular-nums ${className}`}>{left ?? "live soon"}</span>;
}
