"use client";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, Terminal, Network } from "lucide-react";

// Both load after hydration, off the critical path. The keygen console pulls in the SDK, so it
// only loads when someone asks for it.
const MerkleCanvas = dynamic(() => import("./MerkleCanvas"), { ssr: false });
const KeygenConsole = dynamic(() => import("../KeygenConsole"), {
  ssr: false,
  loading: () => <div className="p-5 text-[12px] text-dim">loading keygen…</div>,
});

const STATS = [
  { t: "WOTS+", s: ["WINTERNITZ", "ONE-TIME SIGS"] },
  { t: "SHA-256", s: ["HASH-BASED", "AUTHORIZATION"] },
  { t: "1 KEY = 1 USE", s: ["NO KEY REUSE", "BY DESIGN"] },
];

/** The vault image, with a gentle 3D tilt on hover (fine pointers only) and a glow when sealed. */
function TiltVault({ sealed }: { sealed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches);
  }, []);
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!can || !el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateX(${(-y * 14).toFixed(2)}deg) rotateY(${(x * 18).toFixed(2)}deg) scale(1.04)`;
  };
  const leave = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return (
    <div className="absolute left-1/2 top-[3%] z-10 aspect-[348/290] h-[33%] -translate-x-1/2 [perspective:700px]" onPointerMove={move} onPointerLeave={leave}>
      <div ref={ref} className="h-full w-full transition-transform duration-200 ease-out will-change-transform">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/vault.png"
          alt="A sealed Noxvault"
          width={348}
          height={290}
          fetchPriority="high"
          className={`h-full w-full rounded-md object-cover transition-[filter] duration-700 [mask-image:radial-gradient(ellipse_at_center,black_55%,transparent_78%)] ${
            sealed ? "brightness-110 drop-shadow-[0_0_22px_rgba(46,230,214,0.45)]" : "brightness-[0.8]"
          }`}
        />
      </div>
    </div>
  );
}

export default function ConsolePanel() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [live, setLive] = useState(false);
  const [sealed, setSealed] = useState(false);
  const go = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    router.push(v ? `/vaults?q=${encodeURIComponent(v)}` : "/vaults");
  };
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-2 px-4 py-3 sm:px-5">
        <span className="text-[12px] font-medium tracking-[0.12em] text-bone">NOXVAULT CONSOLE RUNNING IN YOUR BROWSER</span>
        <span className="text-[10px] tracking-[0.08em] text-mute">{"// LOCAL • CLIENT-SIDE • NO SERVER"}</span>
      </div>
      {/* fixed aspect ratio: the canvas and the console swap without moving anything below */}
      <div className="relative aspect-[4/3] border-b border-line bg-[radial-gradient(ellipse_at_50%_30%,rgba(46,230,214,0.07),transparent_65%)] sm:aspect-[2/1]">
        {live ? (
          <div className="absolute inset-0 overflow-auto bg-ink/70">
            <KeygenConsole bare />
          </div>
        ) : (
          <>
            <TiltVault sealed={sealed} />
            <MerkleCanvas onSeal={setSealed} />
          </>
        )}
        <button
          onClick={() => setLive((l) => !l)}
          className="absolute right-3 top-3 z-20 inline-flex items-center gap-2 rounded border border-line-2 bg-ink/80 px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-mute backdrop-blur hover:border-teal/60 hover:text-teal"
        >
          {live ? <Network size={13} /> : <Terminal size={13} />}
          {live ? (
            "show tree"
          ) : (
            <>
              <span className="hidden sm:inline">run&nbsp;</span>keygen<span className="hidden sm:inline">&nbsp;live</span>
            </>
          )}
        </button>
      </div>
      <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-[0.85fr_1.15fr] [&>*]:min-w-0">
        <div>
          <div className="text-[14px] font-medium tracking-[0.08em] text-bone">POST-QUANTUM VAULT INFRASTRUCTURE</div>
          <p className="mt-3 text-[13px] leading-6 text-mute">
            Hash-based authorization. One-time keys.
            <br />
            Generated and used entirely in your browser.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 self-start [&>*]:min-w-0">
          {STATS.map((s) => (
            <div key={s.t} className="rounded-md border border-line-2 bg-ink/50 px-2.5 py-2.5 sm:px-3">
              <div className="text-[12px] font-medium leading-tight text-bone sm:text-[13px]">{s.t}</div>
              <div className="mt-1.5 text-[8.5px] leading-[13px] tracking-[0.06em] text-dim sm:text-[9.5px] sm:leading-[15px]">
                {s.s[0]}
                <br />
                {s.s[1]}
              </div>
            </div>
          ))}
        </div>
        <form
          onSubmit={go}
          className="flex items-stretch overflow-hidden rounded-md border border-line-2 bg-ink/70 focus-within:border-teal md:col-span-2"
          role="search"
        >
          <span className="flex items-center pl-3.5 text-mute">
            <Search size={16} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Look up a vault address (e.g. 7xQ8...9kLm)"
            aria-label="Vault address"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[12.5px] text-bone outline-none placeholder:text-dim"
          />
          <button type="submit" className="m-1 flex w-11 items-center justify-center rounded bg-ink-3 text-mute hover:text-teal" aria-label="Look up">
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
