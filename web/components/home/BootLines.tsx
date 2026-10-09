"use client";
import { useEffect, useState } from "react";

const LINES: [string, string][] = [
  ["loading hash chains", "ok"],
  ["deriving one-time keys", "ok"],
  ["sealing vault", "ok"],
];

export default function BootLines() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x >= LINES.length ? x : x + 1)), 380);
    return () => clearInterval(t);
  }, []);
  return (
    <pre className="min-h-[66px] text-[13px] leading-[22px] text-mute sm:text-[14px]" aria-label="Boot log">
      {LINES.map(([t, ok], i) => (
        <div key={t} className={i < n ? "" : "opacity-0"}>
          {"> "}
          {t} ... <span className="text-teal">{ok}</span>
        </div>
      ))}
    </pre>
  );
}
