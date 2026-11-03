"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { ArrowRight, Check, RefreshCw, X } from "lucide-react";
import { LEN, LEN1, STEPS, authPath, buildTree, digits, equal, recoverRoot, sign, treeSeeds, type PublicTree, type TreeSeeds } from "@nox/sdk/wots";
import { hex } from "@/lib/format";

// A small tree keeps key generation instant on a phone; a real vault has height 8 (256 keys).
const HEIGHT = 2;
const KEYS = 1 << HEIGHT;
const RUN_MS = 1000; // a chain walked all 255 steps takes this long; shorter chains stop earlier

interface DemoKey {
  seeds: TreeSeeds;
  tree: PublicTree;
  next: number;
  ms: number;
}
interface Result {
  msg: string;
  leaf: number;
  digest: Uint8Array;
  digits: number[];
  signMs: number;
  verifyMs: number;
  ok: boolean;
  root: Uint8Array;
}

const enc = new TextEncoder();

function newKey(): DemoKey {
  const t = performance.now();
  const seeds = treeSeeds(randomBytes(32), 0);
  const tree = buildTree(seeds, HEIGHT);
  return { seeds, tree, next: 0, ms: performance.now() - t };
}

export default function SignDemo() {
  const key = useRef<DemoKey | null>(null);
  const [keyInfo, setKeyInfo] = useState<{ root: string; ms: number; used: number } | null>(null);
  const [msg, setMsg] = useState("pay 1 SOL to alice");
  const [res, setRes] = useState<Result | null>(null);
  const [run, setRun] = useState(0); // bumps per signature to restart the bar animation
  const [phase, setPhase] = useState<"idle" | "reset" | "walk" | "done">("idle");
  const reduced = useRef(false);

  const sync = () => {
    const k = key.current!;
    setKeyInfo({ root: hex(k.tree.root), ms: k.ms, used: k.next });
  };

  const fresh = useCallback(() => {
    key.current = newKey();
    sync();
    setRes(null);
    setPhase("idle");
  }, []);

  const doSign = useCallback((text: string) => {
    if (!key.current || key.current.next >= KEYS) key.current = newKey();
    const k = key.current;
    const leaf = k.next++;
    const digest = sha256(enc.encode(text));
    const t0 = performance.now();
    const sig = sign(k.seeds, leaf, digest);
    const t1 = performance.now();
    const root = recoverRoot(k.seeds.pkSeed, leaf, digest, sig, authPath(k.tree, leaf));
    const t2 = performance.now();
    setRes({ msg: text, leaf, digest, digits: digits(digest), signMs: t1 - t0, verifyMs: t2 - t1, ok: equal(root, k.tree.root), root });
    sync();
    setRun((r) => r + 1);
  }, []);

  // first signature as soon as the demo appears
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    fresh();
    doSign("pay 1 SOL to alice");
  }, [fresh, doSign]);

  // bar animation: snap to 0, then let every chain walk to its digit at the same speed
  useEffect(() => {
    if (!run) return;
    if (reduced.current) {
      setPhase("done");
      return;
    }
    setPhase("reset");
    let t: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setPhase("walk");
        t = setTimeout(() => setPhase("done"), RUN_MS + 80);
      })
    );
    return () => {
      cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
    };
  }, [run]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (msg.trim()) doSign(msg);
  };

  const steps = res ? res.digits.reduce((s, d) => s + d, 0) : 0;
  const csum = res ? res.digits[LEN1] * 256 + res.digits[LEN1 + 1] : 0;
  const pathBytes = HEIGHT * 32;
  const done = phase === "done";

  return (
    <div className="grid gap-px bg-line lg:grid-cols-[0.95fr_1.05fr] [&>*]:min-w-0">
      {/* left: message, key, digest */}
      <div className="flex flex-col gap-4 bg-ink-2 p-5 sm:p-6">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="demo-msg" className="label">
            message to sign
          </label>
          <div className="flex gap-2">
            <input
              id="demo-msg"
              className="field"
              value={msg}
              maxLength={80}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setMsg(e.target.value)}
            />
            <button className="btn shrink-0" type="submit" disabled={!msg.trim()}>
              sign
            </button>
          </div>
        </form>

        <div className="rounded-md border border-warn/40 bg-warn/[0.04] px-3 py-2 text-[11.5px] leading-5 text-mute">
          <span className="text-warn">demo key</span>, generated in your browser, never stored. Nothing is sent anywhere.
          <div className="mt-1 flex items-center justify-between gap-3 text-[10.5px] text-dim">
            <span className="min-w-0 truncate">
              {keyInfo
                ? `${keyInfo.used}/${KEYS} one-time keys used · root ${keyInfo.root.slice(0, 10)}… · built in ${keyInfo.ms.toFixed(0)} ms`
                : "building keys…"}
            </span>
            <button type="button" onClick={fresh} className="inline-flex shrink-0 items-center gap-1 uppercase tracking-[0.14em] hover:text-teal">
              <RefreshCw size={11} /> new key
            </button>
          </div>
        </div>

        <div>
          <div className="label mb-2 flex justify-between gap-2">
            <span>sha-256 digest → positions</span>
            <span className="text-warn/80">+ 2 checksum</span>
          </div>
          <div className="grid grid-cols-8 gap-1 font-mono text-[11px] sm:text-[12px]" aria-label="Digest bytes">
            {Array.from({ length: LEN }, (_, j) => {
              const d = res?.digits[j];
              const sum = j >= LEN1;
              return (
                <span
                  key={j}
                  className={`rounded-sm border px-0 py-1 text-center tabular-nums ${
                    sum ? "border-warn/40 text-warn" : "border-line-2 text-bone/90"
                  } ${j === LEN - 2 ? "col-start-1" : ""}`}
                  title={sum ? `checksum digit ${j - LEN1}` : `byte ${j}`}
                >
                  {d === undefined ? "··" : d.toString(16).padStart(2, "0")}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-dim">
            Each byte is how far along its chain the signature sits. The checksum Σ(255 − byte) = {res ? csum.toLocaleString("en-US") : "…"} goes the other way, so nobody can
            push a byte up to forge a different message.
          </p>
        </div>
      </div>

      {/* right: the 34 chains walking, then size + verify */}
      <div className="flex flex-col gap-4 bg-ink-2 p-5 sm:p-6">
        <div className="label flex justify-between gap-2">
          <span>34 hash chains · secret (0) → public end (255)</span>
          <span className="tabular-nums">{res ? `key #${res.leaf}` : ""}</span>
        </div>
        <div className="relative h-[150px] sm:h-[170px]" aria-label="Chain positions">
          {/* guide lines at 0, 128, 255 */}
          {[0, 0.5, 1].map((g) => (
            <span key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px] sm:gap-[3px]">
            {Array.from({ length: LEN }, (_, j) => {
              const d = res?.digits[j] ?? 0;
              const sum = j >= LEN1;
              const target = phase === "reset" || phase === "idle" ? 0 : d / STEPS;
              return (
                <div key={j} className="relative h-full flex-1 overflow-hidden rounded-t-[2px] bg-ink-3">
                  <div
                    className={`absolute inset-x-0 bottom-0 h-full origin-bottom ${sum ? "bg-warn/80" : "bg-teal/80"}`}
                    style={{
                      transform: `scaleY(${target})`,
                      transition: phase === "walk" ? `transform ${Math.round((d / STEPS) * RUN_MS)}ms linear` : "none",
                    }}
                  />
                  {/* the remaining walk a verifier does, up to the public end */}
                  {done && <div className="absolute inset-x-0 top-0 bg-teal/[0.12]" style={{ height: `${100 - (d / STEPS) * 100}%` }} />}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-dim">
          <span>chain 00</span>
          <span>31 · c0 c1</span>
        </div>

        <div className="mt-auto grid gap-2 text-[12px] sm:grid-cols-2 [&>*]:min-w-0">
          <div className="rounded-md border border-line-2 bg-ink/50 px-3 py-2.5">
            <div className="label">signature size</div>
            <div className="mt-1 tabular-nums text-bone">
              1,088 B <span className="text-dim">+ {pathBytes} B path</span>
            </div>
            <div className="mt-0.5 text-[10.5px] text-dim">34 × 32 B chain values; a real vault&apos;s path is 8 × 32 = 256 B</div>
          </div>
          <div className={`rounded-md border px-3 py-2.5 transition-colors ${done && res ? (res.ok ? "border-teal/70" : "border-bad/70") : "border-line-2"} bg-ink/50`}>
            <div className="label">verify</div>
            {done && res ? (
              <div className={`mt-1 flex items-center gap-1.5 ${res.ok ? "text-teal" : "text-bad"}`}>
                {res.ok ? <Check size={15} /> : <X size={15} />} {res.ok ? "verified" : "rejected"}
                <span className="text-[10.5px] text-dim">· root {hex(res.root).slice(0, 8)}…</span>
              </div>
            ) : (
              <div className="mt-1 text-mute">walking chains…</div>
            )}
            <div className="mt-0.5 text-[10.5px] tabular-nums text-dim">
              {res ? `${steps.toLocaleString("en-US")} chain steps to sign (${res.signMs.toFixed(1)} ms) · verify ${res.verifyMs.toFixed(1)} ms` : " "}
            </div>
          </div>
        </div>
        <Link href="/keylab" className="inline-flex items-center gap-2 self-start text-[12.5px] text-teal hover:underline">
          Sign twice with one key and see what leaks, in the Key Lab <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
