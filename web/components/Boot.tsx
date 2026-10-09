"use client";
import { useEffect, useState } from "react";
import { Mark } from "./Logo";

const LINES = [
  "> mount /dev/night ............ ok",
  "> load wots+ (w=256, n=32) ...... ok",
  "> sha-256 self test ............. ok",
  "> 34 chains × 255 steps ......... ok",
  "> ed25519 keys .......... not trusted",
  "> secrets stay in this tab ...... ok",
];

export default function Boot() {
  const [shown, setShown] = useState(0);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let booted = false;
    try {
      booted = sessionStorage.getItem("nox.booted") === "1";
    } catch {}
    if (booted || document.documentElement.dataset.booted) {
      setGone(true);
      return;
    }
    const t = setInterval(() => setShown((n) => n + 1), 170);
    return () => clearInterval(t);
  }, []);

  const finish = () => {
    try {
      sessionStorage.setItem("nox.booted", "1");
    } catch {}
    document.documentElement.dataset.booted = "1";
    setGone(true);
  };

  useEffect(() => {
    if (shown > LINES.length + 3) finish();
  }, [shown]);

  useEffect(() => {
    if (gone) return;
    const k = () => finish();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [gone]);

  if (gone) return null;
  return (
    <div
      className="boot nox-bg fixed inset-0 z-[100] flex cursor-pointer items-center justify-center px-4"
      onClick={finish}
      role="button"
      aria-label="Skip intro"
    >
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <Mark size={36} />
          <div className="font-display text-[15px] sm:text-[18px]">
            NOXVAULT <span className="text-dim">//</span> V1 <span className="text-dim">//</span> SOLANA
          </div>
        </div>
        <pre className="min-h-[9.5rem] whitespace-pre-wrap text-[11.5px] leading-6 text-mute sm:text-[12.5px]">
          {LINES.slice(0, shown).map((l) => {
            const ok = l.endsWith("ok");
            return (
              <div key={l}>
                {ok ? l.slice(0, -2) : l.replace(/not trusted$/, "")}
                <span className={ok ? "text-moon" : "text-warn"}>{ok ? "ok" : "not trusted"}</span>
              </div>
            );
          })}
          {shown >= LINES.length && (
            <div className="text-bone">
              {">"} ready<span className="blink">_</span>
            </div>
          )}
        </pre>
        <div className="label mt-6">click or press any key to skip</div>
      </div>
    </div>
  );
}
