"use client";
import Link from "next/link";
import type { TierView } from "@nox/sdk/client";
import { TIER_GUARDIAN, TIER_NAMES, TIER_SENTINEL, noxAmount, type Protocol } from "@/lib/nox";

const tone = ["border-line-2 text-mute", "border-teal/60 text-teal", "border-warn/70 text-warn"];

/** Free / Guardian / Sentinel, with the $NOX held and what the next tier needs. */
export default function TierBadge({ tier, protocol, compact = false }: { tier: TierView | null; protocol: Protocol | null | undefined; compact?: boolean }) {
  if (!tier) return <span className="text-[11px] text-dim">tier …</span>;
  if (!tier.tiersOn) return <span className="rounded-full border border-line-2 px-2 py-0.5 text-[10.5px] text-mute">tiers off</span>;
  const d = protocol?.decimals ?? 0;
  const next = tier.tier < TIER_SENTINEL ? TIER_NAMES[tier.tier + 1] : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] ${tone[tier.tier]}`}>
        {tier.tier === TIER_SENTINEL ? "◆ " : tier.tier === TIER_GUARDIAN ? "◇ " : ""}
        {tier.name}
      </span>
      {!compact && (
        <span className="text-[11px] text-dim">
          {noxAmount(tier.held, d)} $NOX held
          {next && tier.next !== null && (
            <>
              {" · "}
              <Link href="/token" className="text-mute underline decoration-dotted hover:text-teal">
                {noxAmount(tier.next, d)} more for {next}
              </Link>
            </>
          )}
        </span>
      )}
    </span>
  );
}
