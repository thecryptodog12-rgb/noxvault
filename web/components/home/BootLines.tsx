"use client";
import { useEffect, useState } from "react";

const LINES: [string, string][] = [
  ["loading hash chains", "ok"],
  ["deriving one-time keys", "ok"],
  ["sealing vault", "ok"],
];
const FULL = LINES.map(([t, ok]) => `> ${t} ... ${ok}`);
const TOTAL = FULL.reduce((n, l) => n + l.length, 0);

/**
 * Terminal boot log, typed out character by character. Every line is rendered at full length
 * from the start (untyped characters are transparent), so typing never shifts the layout.
 * With reduced motion the log shows complete at once.
 */
export default function BootLines() {
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(TOTAL);
      return;
    }
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      n++;
      setTyped(n);
      if (n >= TOTAL) return;
      // pause briefly at the end of each line, as if the step took work
      let acc = 0;
      const atLineEnd = FULL.some((l) => (acc += l.length) === n);
      t = setTimeout(tick, atLineEnd ? 260 : 18 + Math.random() * 22);
    };
    t = setTimeout(tick, 250);
    return () => clearTimeout(t);
  }, []);

  let left = typed;
  return (
    <pre className="min-h-[66px] text-[13px] [font-variant-ligatures:none] leading-[22px] text-mute sm:text-[14px]" aria-label="Boot log: loading hash chains ok, deriving one-time keys ok, sealing vault ok">
      {LINES.map(([t, ok], i) => {
        const line = FULL[i];
        const shown = Math.max(0, Math.min(line.length, left));
        left -= line.length;
        const okFrom = line.length - ok.length;
        const active = shown > 0 && shown < line.length;
        const last = typed >= TOTAL && i === LINES.length - 1;
        return (
          <div key={t} aria-hidden>
            {Array.from(line, (ch, k) => (
              <span key={k} className={k >= shown ? "opacity-0" : k >= okFrom ? "text-teal" : undefined}>
                {ch}
                {((active && k === shown - 1) || (last && k === line.length - 1)) && <span className="caret" />}
              </span>
            ))}
          </div>
        );
      })}
    </pre>
  );
}
