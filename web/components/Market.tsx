"use client";
import { useEffect, useState } from "react";
import { Label } from "./ui";
import { CHART_URL, NOX_TOKEN } from "@/lib/config";

const REFRESH_MS = 30_000;

/** The fields we use from a DexScreener pair (https://api.dexscreener.com/tokens/v1/solana/<mint>). */
type Pair = {
  dexId: string;
  baseToken: { address: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
};

type Market = {
  price: number | null;
  mcap: number | null;
  volume: number;
  change: number | null;
  /** null while on the pump.fun bonding curve (DexScreener reports no pool liquidity there). */
  liquidity: number | null;
  dex: string;
};

/** Picks the deepest pool (or busiest, on the bonding curve) and sums 24h volume over all pools. */
export function toMarket(pairs: Pair[], mint: string): Market | null {
  const ours = pairs.filter((p) => p.baseToken?.address === mint);
  if (!ours.length) return null;
  const best = [...ours].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0) || (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0),
  )[0];
  const price = Number(best.priceUsd);
  return {
    price: Number.isFinite(price) ? price : null,
    mcap: best.marketCap ?? best.fdv ?? null,
    volume: ours.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0),
    change: best.priceChange?.h24 ?? null,
    liquidity: best.liquidity?.usd ?? null,
    dex: best.dexId,
  };
}

/** $ amounts: compact above $10k, sub-cent prices with 4 significant digits. */
export function usd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 10_000) return "$" + v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
  if (v >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v === 0) return "$0";
  return "$" + v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

function useMarket(mint: string) {
  const [state, setState] = useState<{ market: Market | null; loaded: boolean; error: boolean; at: number | null }>({
    market: null,
    loaded: false,
    error: false,
    at: null,
  });
  useEffect(() => {
    if (!mint) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const pairs = (await r.json()) as Pair[];
        if (alive) setState({ market: Array.isArray(pairs) ? toMarket(pairs, mint) : null, loaded: true, error: false, at: Date.now() });
      } catch {
        // Keep the last good numbers on a failed refresh.
        if (alive) setState((s) => ({ ...s, loaded: true, error: true }));
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint]);
  return state;
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className={`mt-1.5 truncate text-[16px] font-bold tabular-nums sm:text-[18px] ${className}`}>{value}</div>
    </div>
  );
}

/** Live $NOX market numbers from DexScreener. Renders nothing until NEXT_PUBLIC_NOX_TOKEN is set. */
export default function MarketStats() {
  const { market, loaded, error, at } = useMarket(NOX_TOKEN);
  if (!NOX_TOKEN) return null;

  if (!market) {
    return (
      <div className="border-t border-line px-4 py-3 text-[12px] text-mute sm:px-5">
        {!loaded
          ? "Loading market data…"
          : error
            ? "Market data is unavailable right now. Retrying every 30 s."
            : "Not on DexScreener yet. New pump.fun tokens usually show up within a minute or two; this refreshes every 30 s."}
      </div>
    );
  }

  const ch = market.change;
  return (
    <div className="border-t border-line px-4 py-4 sm:px-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="price" value={usd(market.price)} className="text-teal" />
        <Stat label="market cap" value={usd(market.mcap)} />
        <Stat label="24h volume" value={usd(market.volume)} />
        <Stat
          label="24h change"
          value={ch === null ? "—" : `${ch > 0 ? "+" : ""}${ch.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
          className={ch === null ? "" : ch >= 0 ? "text-teal" : "text-bad"}
        />
        <Stat label="liquidity" value={market.liquidity === null ? "bonding curve" : usd(market.liquidity)} />
      </div>
      <p className="mt-3 text-[11px] text-dim">
        Live from{" "}
        <a href={CHART_URL} target="_blank" rel="noreferrer" className="underline">
          DexScreener
        </a>{" "}
        ({market.dex}), refreshed every 30 s
        {at ? ` · updated ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
        {error ? " · last refresh failed, showing the previous numbers" : ""}. Not financial advice.
      </p>
    </div>
  );
}
