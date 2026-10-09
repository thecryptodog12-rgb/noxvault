"use client";
import { useEffect, useRef, useState } from "react";
import { LEN, LEN1 } from "@nox/sdk/wots";

const CW = 3; // cell width
const GX = 1;
const CH = 8;
const GY = 3;
const LW = 30; // label column
const COLS = 256; // positions 0 (secret) … 255 (public end)
const W = LW + COLS * (CW + GX);
const H = LEN * (CH + GY);

const C = {
  idle: "#17171c",
  walked: "#3d3d47",
  verify: "#1d1d24",
  end: "#4a4a55",
  rev: "#e9e6df",
  revSum: "#b8a6ff",
  second: "#ffb86b",
  exposed: "rgba(255,107,122,0.55)",
  label: "#6d6d78",
  labelSum: "#b8a6ff",
};

export default function ChainGrid({ a, b }: { a: number[] | null; b: number[] | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ j: number; k: number } | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = "9px ui-monospace, monospace";
    g.textBaseline = "middle";
    for (let j = 0; j < LEN; j++) {
      const y = j * (CH + GY);
      const sum = j >= LEN1;
      g.fillStyle = sum ? C.labelSum : C.label;
      g.fillText(sum ? `c${j - LEN1}` : String(j).padStart(2, "0"), 2, y + CH / 2 + 0.5);
      const da = a?.[j];
      const db = b?.[j];
      const floor = da !== undefined && db !== undefined ? Math.min(da, db) : undefined;
      const ceil = da !== undefined && db !== undefined ? Math.max(da, db) : undefined;
      for (let k = 0; k < COLS; k++) {
        const x = LW + k * (CW + GX);
        let col = C.idle;
        if (da !== undefined) col = k < da ? C.walked : C.verify;
        if (floor !== undefined && ceil !== undefined && k > floor && k < ceil) col = C.exposed;
        if (k === 255) col = C.end;
        if (da !== undefined && k === da) col = sum ? C.revSum : C.rev;
        if (db !== undefined && k === db) col = C.second;
        g.fillStyle = col;
        g.fillRect(x, y, CW, CH);
      }
    }
  }, [a, b]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const j = Math.floor(sy / (CH + GY));
    const k = Math.floor((sx - LW) / (CW + GX));
    if (j >= 0 && j < LEN && k >= 0 && k < COLS) setHover({ j, k });
    else setHover(null);
  };

  return (
    <div>
      <canvas
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="block h-auto w-full"
        style={{ aspectRatio: `${W} / ${H}`, imageRendering: "pixelated" }}
        aria-label="34 WOTS+ chains of 255 steps each"
        role="img"
      />
      <div className="mt-3 flex min-h-[1.5rem] flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[11px] text-dim">
        <span>
          {hover
            ? `chain ${hover.j}${hover.j >= LEN1 ? ` (checksum ${hover.j - LEN1})` : ""} · position ${hover.k}${
                hover.k === 0 ? " = secret" : hover.k === 255 ? " = public end" : ""
              }${a ? ` · revealed at ${a[hover.j]}` : ""}${b ? ` / ${b[hover.j]}` : ""}`
            : "hover a chain · position 0 is the secret, 255 the public end"}
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <Legend c={C.rev} t="revealed" />
          <Legend c={C.revSum} t="checksum" />
          {b && <Legend c={C.second} t="2nd signature" />}
          {b && <Legend c={C.exposed} t="newly reachable" />}
          <Legend c={C.end} t="public end" />
        </span>
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2" style={{ background: c }} />
      {t}
    </span>
  );
}
