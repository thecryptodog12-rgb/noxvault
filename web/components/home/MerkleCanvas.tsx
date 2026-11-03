"use client";
import { useEffect, useRef } from "react";

/**
 * Hero animation: one-time keys (leaves) light up as their hash chains finish, hash pulses travel
 * up the Merkle tree, and the root seals the vault. Plain canvas + requestAnimationFrame.
 * - sized by CSS (fills its parent), backing store scaled by devicePixelRatio
 * - pauses while off-screen or while the tab is hidden
 * - prefers-reduced-motion: draws one static, fully sealed frame
 * `onSeal(true|false)` lets the parent light up the vault image when the root seals.
 */

const LEAVES = 16;
const LEVELS = 4; // 16 → 8 → 4 → 2 → 1
const CHAIN_DOTS = 5;
const TRAVEL = 0.42; // s for a pulse to climb one edge
const HOLD = 2.6; // s the sealed state stays on screen
const FADE = 0.7;

const TEAL = "46,230,214";
const LINE = "#1b3238";
const DIM = "#2a4950";

interface Node {
  lvl: number;
  i: number;
  t: number; // time it lights up
}

function schedule(): { nodes: Node[][]; rootT: number; hex: string } {
  // leaves finish their chains in a shuffled order, a little apart
  const order = Array.from({ length: LEAVES }, (_, i) => i).sort(() => Math.random() - 0.5);
  const leafT = new Array<number>(LEAVES);
  order.forEach((leaf, k) => (leafT[leaf] = 0.5 + k * 0.13 + Math.random() * 0.05));
  const nodes: Node[][] = [leafT.map((t, i) => ({ lvl: 0, i, t }))];
  for (let l = 1; l <= LEVELS; l++) {
    const below = nodes[l - 1];
    nodes.push(Array.from({ length: below.length / 2 }, (_, i) => ({ lvl: l, i, t: Math.max(below[2 * i].t, below[2 * i + 1].t) + TRAVEL })));
  }
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  return { nodes, rootT: nodes[LEVELS][0].t, hex };
}

export default function MerkleCanvas({ onSeal }: { onSeal?: (sealed: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sealCb = useRef(onSeal);
  sealCb.current = onSeal;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    let plan = schedule();
    let t = 0; // animation clock in seconds, only advances while visible
    let sealed = false;
    const setSealed = (s: boolean) => {
      if (s !== sealed) {
        sealed = s;
        sealCb.current?.(s);
      }
    };

    const pos = (lvl: number, i: number) => {
      const count = LEAVES >> lvl;
      const padX = Math.max(14, w * 0.05);
      const span = w - 2 * padX;
      const x = padX + (span * (i + 0.5)) / count;
      const yLeaf = h * 0.8;
      const yRoot = h * 0.44;
      const y = yLeaf - ((yLeaf - yRoot) * lvl) / LEVELS;
      return [x, y] as const;
    };

    const draw = (now: number) => {
      g.clearRect(0, 0, w, h);
      const fade = now > plan.rootT + HOLD ? Math.max(0, 1 - (now - plan.rootT - HOLD) / FADE) : 1;
      const small = w < 480;
      g.font = `${small ? 9 : 10}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      g.textBaseline = "middle";

      // edges, with pulses climbing them
      for (let l = 0; l < LEVELS; l++) {
        for (const n of plan.nodes[l]) {
          const parent = plan.nodes[l + 1][n.i >> 1];
          const [x0, y0] = pos(l, n.i);
          const [x1, y1] = pos(l + 1, parent.i);
          g.strokeStyle = LINE;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
          const start = n.t;
          const p = Math.min(1, Math.max(0, (now - start) / TRAVEL));
          if (p > 0) {
            // lit part of the edge
            g.strokeStyle = `rgba(${TEAL},${0.55 * fade})`;
            g.beginPath();
            g.moveTo(x0, y0);
            g.lineTo(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p);
            g.stroke();
            if (p < 1) {
              const px = x0 + (x1 - x0) * p;
              const py = y0 + (y1 - y0) * p;
              const grd = g.createRadialGradient(px, py, 0, px, py, 9);
              grd.addColorStop(0, `rgba(${TEAL},0.9)`);
              grd.addColorStop(1, `rgba(${TEAL},0)`);
              g.fillStyle = grd;
              g.fillRect(px - 9, py - 9, 18, 18);
              g.fillStyle = "#d9fffb";
              g.fillRect(px - 1.25, py - 1.25, 2.5, 2.5);
            }
          }
        }
      }

      // hash chains under each leaf: dots fill bottom-up before the leaf lights
      const leafGap = (w - 2 * Math.max(14, w * 0.05)) / LEAVES;
      const dot = Math.max(2, Math.min(3.2, leafGap * 0.14));
      for (const n of plan.nodes[0]) {
        const [x, y] = pos(0, n.i);
        const chainStart = n.t - 0.45;
        for (let d = 0; d < CHAIN_DOTS; d++) {
          const dy = y + 12 + (CHAIN_DOTS - 1 - d) * (dot + 3.5);
          const on = now >= chainStart + (d * 0.45) / CHAIN_DOTS;
          g.fillStyle = on ? `rgba(${TEAL},${(0.25 + 0.12 * d) * fade})` : "#14262b";
          g.fillRect(x - dot / 2, dy - dot / 2, dot, dot);
        }
      }

      // nodes
      for (let l = 0; l <= LEVELS; l++) {
        for (const n of plan.nodes[l]) {
          const [x, y] = pos(l, n.i);
          const lit = now >= n.t;
          const age = now - n.t;
          const r = l === 0 ? 4.5 : l === LEVELS ? 7 : 4;
          if (lit && fade > 0) {
            const flash = age < 0.35 ? 1 - age / 0.35 : 0;
            const glowR = r * (2.6 + flash * 2);
            const grd = g.createRadialGradient(x, y, 0, x, y, glowR);
            grd.addColorStop(0, `rgba(${TEAL},${(0.45 + flash * 0.4) * fade})`);
            grd.addColorStop(1, `rgba(${TEAL},0)`);
            g.fillStyle = grd;
            g.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
            g.fillStyle = `rgba(${TEAL},${fade})`;
          } else {
            g.fillStyle = "#08131600";
          }
          g.strokeStyle = lit && fade > 0 ? `rgba(${TEAL},${fade})` : DIM;
          g.lineWidth = 1;
          if (l === 0) {
            g.beginPath();
            g.rect(x - r, y - r, r * 2, r * 2);
            if (lit && fade > 0) g.fill();
            g.stroke();
          } else {
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            if (lit && fade > 0) g.fill();
            g.stroke();
          }
        }
      }

      // root → vault: a short edge up into the vault image, then the seal ring
      const [rx, ry] = pos(LEVELS, 0);
      const vy = h * 0.35;
      const up = Math.min(1, Math.max(0, (now - plan.rootT) / 0.25));
      g.strokeStyle = up > 0 ? `rgba(${TEAL},${0.7 * fade})` : LINE;
      g.beginPath();
      g.moveTo(rx, ry - 7);
      g.lineTo(rx, ry - 7 - (ry - 7 - vy) * (up || 1));
      g.stroke();
      const since = now - plan.rootT;
      if (since > 0 && since < 1.4) {
        const k = since / 1.4;
        g.strokeStyle = `rgba(${TEAL},${(1 - k) * 0.8})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(rx, ry, 8 + k * Math.min(w, h) * 0.32, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 1;
      }
      setSealed(since > 0.15 && fade > 0.4);

      // labels
      g.textAlign = "left";
      g.fillStyle = "#5f7479";
      const litLeaves = plan.nodes[0].filter((n) => now >= n.t).length;
      g.fillText(`one-time keys ${String(litLeaves).padStart(2, "0")}/${LEAVES}${small ? "" : "  (a vault has 256)"}`, Math.max(14, w * 0.05), h - 10);
      g.textAlign = "right";
      if (since > 0 && fade > 0) {
        g.fillStyle = `rgba(${TEAL},${fade})`;
        g.fillText(small ? `root ${plan.hex.slice(0, 6)}… sealed` : `root ${plan.hex}…  sealed`, w - Math.max(14, w * 0.05), h - 10);
      } else {
        g.fillText(small ? "building tree" : "building merkle tree", w - Math.max(14, w * 0.05), h - 10);
      }
      g.textAlign = "left";
      if (!small) {
        for (let l = 0; l <= LEVELS; l++) {
          const [, y] = pos(l, 0);
          g.fillStyle = "#33505a";
          g.fillText(l === 0 ? "leaf" : l === LEVELS ? "root" : `h${l}`, 4, y);
        }
      }
    };

    resize();
    if (reduced) {
      draw(plan.rootT + 0.6);
      const ro = new ResizeObserver(() => {
        resize();
        draw(plan.rootT + 0.6);
      });
      ro.observe(cv);
      return () => ro.disconnect();
    }

    let raf = 0;
    let last = 0;
    let onScreen = false;
    const frame = (ms: number) => {
      const dt = last ? Math.min(0.1, (ms - last) / 1000) : 0;
      last = ms;
      t += dt;
      if (t > plan.rootT + HOLD + FADE + 0.4) {
        plan = schedule();
        t = 0;
      }
      draw(t);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf || !onScreen || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(cv);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);
    const ro = new ResizeObserver(() => {
      resize();
      draw(t);
    });
    ro.observe(cv);
    draw(0);
    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
