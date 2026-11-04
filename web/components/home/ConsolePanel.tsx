"use client";
import { useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, Terminal, Image as ImageIcon } from "lucide-react";

// The keygen console pulls in the SDK, so it only loads when someone asks for it.
const KeygenConsole = dynamic(() => import("../KeygenConsole"), {
  ssr: false,
  loading: () => <div className="p-5 text-[12px] text-dim">loading keygen…</div>,
});

const STATS = [
  { t: "WOTS+", s: ["WINTERNITZ", "ONE-TIME SIGS"] },
  { t: "SHA-256", s: ["HASH-BASED", "AUTHORIZATION"] },
  { t: "1 KEY = 1 USE", s: ["NO KEY REUSE", "BY DESIGN"] },
];

export default function ConsolePanel() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [live, setLive] = useState(false);
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
      <div className="grid [&>*]:min-w-0 md:grid-cols-[0.8fr_1.2fr]">
        <div className="relative min-h-[240px] border-b border-line md:border-b-0">
          {live ? (
            <div className="h-full bg-ink/70">
              <KeygenConsole bare />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/vault.png" alt="A sealed Noxvault" fetchPriority="high" className="h-full w-full object-cover" />
          )}
          <button
            onClick={() => setLive((l) => !l)}
            className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded border border-line-2 bg-ink/80 px-2.5 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-mute backdrop-blur hover:border-teal/60 hover:text-teal"
          >
            {live ? <ImageIcon size={13} /> : <Terminal size={13} />}
            {live ? "show vault" : "run keygen live"}
          </button>
        </div>
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div>
            <div className="text-[14px] font-medium tracking-[0.08em] text-bone">POST-QUANTUM VAULT INFRASTRUCTURE</div>
            <p className="mt-3 text-[13px] leading-6 text-mute">
              Hash-based authorization. One-time keys.
              <br />
              Generated and used entirely in your browser.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 [&>*]:min-w-0">
            {STATS.map((s) => (
              <div key={s.t} className="rounded-md border border-line-2 bg-ink/50 px-3 py-3">
                <div className="whitespace-nowrap text-[13.5px] font-medium text-bone">{s.t}</div>
                <div className="mt-2 text-[9.5px] leading-[15px] tracking-[0.06em] text-dim">
                  {s.s[0]}
                  <br />
                  {s.s[1]}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={go} className="flex items-stretch overflow-hidden rounded-md border border-line-2 bg-ink/70 focus-within:border-teal" role="search">
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
    </div>
  );
}
