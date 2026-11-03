"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Shows one QR per part with prev/next and an auto-cycle for scanning. With `animate` the cycle
 * starts on its own: the receiving scanner takes frames in any order and skips repeats, so it
 * only has to watch until every part has gone by once.
 */
export default function QrParts({ parts, animate = false }: { parts: string[]; animate?: boolean }) {
  const [svgs, setSvgs] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(animate);
  const [ms, setMs] = useState(animate ? 700 : 1400);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setI(0);
    Promise.all(
      parts.map((p) =>
        QRCode.toString(p, { type: "svg", errorCorrectionLevel: "L", margin: 3, color: { dark: "#03070a", light: "#e6f0ef" } })
      )
    )
      .then((s) => live && (setSvgs(s), setErr(null)))
      .catch((e) => live && setErr(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [parts]);

  useEffect(() => {
    if (!auto || parts.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % parts.length), ms);
    return () => clearInterval(t);
  }, [auto, parts.length, ms]);

  if (err) return <div className="text-[12px] text-bad">✕ QR failed: {err}. Pick a smaller part size.</div>;
  if (!svgs.length) return <div className="py-10 text-center text-[12px] text-dim">rendering QR…</div>;
  const n = parts.length;
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="w-full max-w-[380px] rounded border border-line-2 bg-bone p-1 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
        aria-label={`QR part ${i + 1} of ${n}`}
        dangerouslySetInnerHTML={{ __html: svgs[i] }}
      />
      <div className="flex w-full max-w-[380px] items-center justify-between gap-2">
        <button className="btn ghost sm" onClick={() => setI((x) => (x - 1 + n) % n)} disabled={n < 2}>
          ← prev
        </button>
        <span className="text-[12px] text-bone">
          part <span className="text-teal">{i + 1}</span> of {n}
        </span>
        <button className="btn ghost sm" onClick={() => setI((x) => (x + 1) % n)} disabled={n < 2}>
          next →
        </button>
      </div>
      {n > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-dim">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[#2ee6d6]" />
            cycle automatically (point the scanner at the screen)
          </label>
          {auto && (
            <select className="field !w-auto !py-0.5 text-[11px]" value={ms} onChange={(e) => setMs(Number(e.target.value))} aria-label="frame speed">
              <option value={400}>fast</option>
              <option value={700}>normal</option>
              <option value={1400}>slow</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}
