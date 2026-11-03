"use client";
import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { Copy, Label, Panel } from "@/components/ui";
import CountUp from "@/components/CountUp";
import type { BurnResponse } from "@/lib/burns";
import { BURN_SHARE, NOX_INITIAL_SUPPLY } from "@/lib/config";
import { fromBaseUnits, short } from "@/lib/format";
import { dateTime } from "@/lib/time";

// Burns happen on mainnet (where $NOX trades), whatever network the vaults run on.
const txUrl = (sig: string) => `https://solscan.io/tx/${sig}`;
const accountUrl = (a: string) => `https://solscan.io/account/${a}`;
const whole = (base: string, decimals: number) => Number(BigInt(base)) / 10 ** decimals;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 1000 ? 2 : 0 });

/** Running total of $NOX burned by the flywheel wallet, with the latest burns. Reads /api/burns. */
export default function Burns() {
  const [data, setData] = useState<BurnResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/burns")
        .then((r) => r.json() as Promise<BurnResponse>)
        .then((j) => live && (setData(j), setFailed(false)))
        .catch(() => live && setFailed(true));
    load();
    const t = setInterval(load, 120_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const title = (
    <span className="inline-flex items-center gap-2">
      <Flame size={13} className="text-warn" /> buyback and burn // counter
    </span>
  );

  if (data && !data.configured) {
    return (
      <Panel title={title}>
        <div className="grid gap-px bg-line md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col justify-center gap-1 bg-ink p-4 sm:p-5">
            <Label>$NOX burned</Label>
            <div className="font-display text-[34px] font-bold tabular-nums text-dim sm:text-[40px]">—</div>
            <span className="text-[12px] uppercase tracking-[0.14em] text-warn">launching soon</span>
          </div>
          <div className="flex flex-col gap-2 bg-ink p-4 text-[12.5px] leading-6 text-mute sm:p-5">
            <p>
              {BURN_SHARE}% of the pump.fun creator fees, and after mainnet {BURN_SHARE}% of the protocol fees, buy $NOX on the market and burn
              it. Every burn is a public transaction from one published wallet.
            </p>
            <p>Once that is live, this panel shows the running total and each burn with its transaction and time, read from the chain.</p>
            <ul className="mt-1 flex flex-col gap-1 text-[11.5px] text-dim">
              <li>$NOX mint: {data.missing.includes("mint") ? "launching soon" : "set"}</li>
              <li>burn wallet: {data.missing.includes("wallet") ? "published at launch" : "set"}</li>
            </ul>
          </div>
        </div>
      </Panel>
    );
  }

  if (failed || (data && "error" in data)) {
    return (
      <Panel title={title}>
        <p className="p-4 text-[12.5px] text-mute sm:p-5">The burn history could not be read right now. It retries every two minutes.</p>
      </Panel>
    );
  }

  if (!data || "error" in data) {
    return (
      <Panel title={title}>
        <div className="p-4 sm:p-5">
          <Label>$NOX burned</Label>
          <div className="mt-1 font-display text-[34px] font-bold text-dim sm:text-[40px]">…</div>
        </div>
      </Panel>
    );
  }

  const d = data.decimals;
  const total = whole(data.total, d);
  const supply = whole(data.supply, d);
  const initial = Number(NOX_INITIAL_SUPPLY) || 0;
  const pct = supply + total > 0 ? (total / (supply + total)) * 100 : 0;

  return (
    <Panel title={title} right={<span className="text-[10.5px] text-dim">mainnet · refreshes every 2 min</span>}>
      <div className="grid gap-px bg-line md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-1 bg-ink p-4 sm:p-5">
          <Label>$NOX burned by the flywheel{data.complete ? "" : " (at least)"}</Label>
          <div className="truncate font-display text-[34px] font-bold tabular-nums text-warn sm:text-[40px]">
            <CountUp value={total} format={fmt} />
          </div>
          <div className="text-[11.5px] text-dim">
            {data.count} burn{data.count === 1 ? "" : "s"} · about {pct.toLocaleString("en-US", { maximumFractionDigits: 3 })}% of supply
          </div>
          <div className="mt-3 flex flex-col gap-1 text-[11.5px] text-dim">
            <span>supply now: {fmt(supply)} $NOX</span>
            {initial > 0 && <span>supply down since launch (all burns, by anyone): {fmt(Math.max(0, initial - supply))} $NOX</span>}
            <span className="flex flex-wrap items-center gap-2">
              burn wallet:{" "}
              <a href={accountUrl(data.wallet)} target="_blank" rel="noreferrer" className="underline">
                {short(data.wallet, 6)}
              </a>
              <Copy value={data.wallet} />
            </span>
          </div>
        </div>
        <div className="bg-ink">
          <div className="border-b border-line px-4 py-2.5 sm:px-5">
            <Label>latest burns</Label>
          </div>
          {data.recent.length === 0 ? (
            <p className="px-4 py-4 text-[12.5px] text-mute sm:px-5">No burns yet. The first one shows up here within a few minutes of landing.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recent.map((b) => (
                <li key={b.signature} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[12px] sm:px-5">
                  <span className="tabular-nums text-bone">{fromBaseUnits(BigInt(b.amount), d)} $NOX</span>
                  <span className="text-dim">{b.time ? dateTime(b.time) : "time unknown"}</span>
                  <a href={txUrl(b.signature)} target="_blank" rel="noreferrer" className="text-mute underline hover:text-teal">
                    {short(b.signature, 6)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="border-t border-line px-4 py-3 text-[11.5px] text-dim sm:px-5">
        Counted from the burn instructions this wallet signed on the $NOX mint; every row links to its transaction, so the total can be re-added by
        anyone.
      </p>
    </Panel>
  );
}
