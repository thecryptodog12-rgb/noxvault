"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { ArrowRight } from "lucide-react";
import type { HomeStats } from "@/lib/homeStats";
import { NETWORK } from "@/lib/config";
import CountUp from "@/components/CountUp";

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const solFmt = (lamports: number) => (lamports / 1e9).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Tile({ k, children, sub }: { k: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1 bg-ink-2 px-4 py-3 sm:px-5">
      <span className="label truncate">{k}</span>
      <span className="truncate font-display text-[20px] tabular-nums text-bone sm:text-[22px]">{children}</span>
      <span className="truncate text-[10.5px] text-dim">{sub ?? " "}</span>
    </div>
  );
}

/**
 * Live protocol numbers, read from the chain after the page has rendered. The tiles are the same
 * size while loading ("…"), loaded, or when the RPC refuses getProgramAccounts, so nothing shifts.
 */
export default function LiveStrip() {
  const { connection } = useConnection();
  const [data, setData] = useState<HomeStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const run = () =>
      import("@/lib/homeStats")
        .then((m) => m.fetchHomeStats(connection))
        .then((d) => live && setData(d))
        .catch(() => live && setFailed(true));
    // wait until the browser is idle so the fetch never competes with first paint
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = ric ? ric(run, { timeout: 1500 }) : window.setTimeout(run, 300);
    return () => {
      live = false;
      if (!ric) clearTimeout(id);
    };
  }, [connection]);

  const loading = !data && !failed;
  const v = data?.vaults ?? null;
  const c = data?.canary ?? null;

  return (
    <section aria-label="Live protocol stats" className="panel overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-[auto_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 flex items-center justify-between gap-3 bg-ink-2 px-4 py-2.5 sm:col-span-1 sm:flex-col sm:items-start sm:justify-center sm:px-5">
          <span className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.16em] text-teal">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" /> live // {NETWORK}
          </span>
          <Link href="/stats" className="flex items-center gap-1 text-[10.5px] uppercase tracking-[0.14em] text-mute hover:text-teal">
            all stats <ArrowRight size={12} />
          </Link>
        </div>
        {loading || v ? (
          <>
            <Tile k="vaults" sub="initialized on chain">
              {v ? <CountUp value={v.count} format={int} /> : "…"}
            </Tile>
            <Tile k="SOL in vaults" sub="native SOL, devnet">
              {v ? <CountUp value={v.lamports} format={solFmt} /> : "…"}
            </Tile>
            <Tile k="actions signed" sub="one-time keys used">
              {v ? <CountUp value={v.actions} format={int} /> : "…"}
            </Tile>
          </>
        ) : (
          <div className="col-span-2 flex flex-col justify-center gap-1 bg-ink-2 px-4 py-3 sm:col-span-3 sm:px-5">
            <span className="label">vault totals</span>
            <span className="text-[12.5px] text-mute">This RPC did not answer the vault scan right now.</span>
            <span className="text-[10.5px] text-dim">The canary and every vault page still read live.</span>
          </div>
        )}
        <Tile
          k="quantum canary"
          sub={
            c ? (
              <>
                bounty <CountUp value={c.bounty} format={(n) => `${solFmt(n)} SOL`} />
              </>
            ) : loading ? undefined : (
              "not readable now"
            )
          }
        >
          {c ? <span className={c.tripped ? "text-bad" : "text-teal"}>{c.tripped ? "TRIPPED" : "ARMED"}</span> : loading ? "…" : "–"}
        </Tile>
      </div>
    </section>
  );
}
