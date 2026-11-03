"use client";
// One inline hint for every tier-gated feature, plus the compact tier bar on the vault view.
// Shows what the vault holds, what it still needs, and where to get $NOX. Renders nothing while
// loading, when tiers are off on this network, or when the vault already has the tier.
import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import type { TierView } from "@nox/sdk/client";
import { TIER_GUARDIAN, TIER_NAMES, TIER_SENTINEL, noxAmount, type Protocol } from "@/lib/nox";
import { tierGap, tierProgress, tierTarget } from "@/lib/tiers";
import { NETWORK } from "@/lib/config";

type Props = {
  /** TIER_GUARDIAN or TIER_SENTINEL */
  need: number;
  tier: TierView | null | undefined;
  protocol: Protocol | null | undefined;
  /** What needs the tier, as the subject of the sentence: "Schedules", "Multi-signer vaults". */
  feature: string;
  /** "required": the feature is locked below the tier. "perk": it works, the tier makes it better (free relayer). */
  kind?: "required" | "perk";
  className?: string;
};

function GetNox() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link href="/buy" className="text-teal underline decoration-dotted hover:decoration-solid">
        get $NOX →
      </Link>
      {NETWORK === "devnet" && (
        <Link href="/token" className="text-mute underline decoration-dotted hover:text-teal">
          test $NOX (devnet faucet)
        </Link>
      )}
    </span>
  );
}

export default function TierHint({ need, tier, protocol, feature, kind = "required", className = "" }: Props) {
  if (!tier || !tier.tiersOn || !protocol || tier.tier >= need) return null;
  const d = protocol.decimals;
  const target = tierTarget(need, protocol);
  const gap = tierGap(tier.held, target);
  const pct = target > 0n ? Math.min(100, Number((tier.held * 10000n) / target) / 100) : 100;
  const name = TIER_NAMES[need];
  const required = kind === "required";
  return (
    <div
      role="note"
      className={`flex flex-col gap-2 rounded-md border px-3 py-2.5 text-[12px] leading-5 ${
        required ? "border-warn/40 bg-warn/[0.05]" : "border-teal/30 bg-teal/[0.04]"
      } ${className}`}
    >
      <div className="flex items-start gap-2">
        {required ? <Lock size={13} className="mt-[3px] shrink-0 text-warn" /> : <Sparkles size={13} className="mt-[3px] shrink-0 text-teal" />}
        <p className="min-w-0 text-mute">
          <span className={required ? "text-warn" : "text-teal"}>
            {feature} {required ? "need" : "with"} {name}
          </span>{" "}
          ({noxAmount(target, d)} $NOX in the vault). This vault holds <span className="text-bone">{noxAmount(tier.held, d)}</span>; add{" "}
          <span className="text-bone">{noxAmount(gap, d)} more</span>.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[21px]">
        <span className="h-1 w-28 overflow-hidden rounded-full bg-line" aria-hidden>
          <span className={`block h-full ${required ? "bg-warn/80" : "bg-teal/80"}`} style={{ width: `${pct}%` }} />
        </span>
        <GetNox />
      </div>
    </div>
  );
}

/** Compact bar: $NOX held against the Guardian and Sentinel thresholds. */
export function TierProgress({ tier, protocol }: { tier: TierView | null | undefined; protocol: Protocol | null | undefined }) {
  if (!tier || !tier.tiersOn || !protocol) return null;
  const d = protocol.decimals;
  const pct = tierProgress(tier.held, protocol);
  const nextNeed = tier.tier < TIER_SENTINEL ? tier.tier + 1 : null;
  const gap = nextNeed ? tierGap(tier.held, tierTarget(nextNeed, protocol)) : 0n;
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <span className="label shrink-0">tier progress</span>
      <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="$NOX tier progress">
        <span className="absolute inset-y-0 left-0 bg-gradient-to-r from-teal/70 to-teal" style={{ width: `${pct}%` }} />
        <span className="absolute inset-y-0 left-1/2 w-px bg-ink" title={`Guardian: ${noxAmount(protocol.guardian, d)} $NOX`} />
      </div>
      <span className="flex shrink-0 flex-wrap items-center gap-x-3 text-[11px] text-dim">
        <span>
          <span className={tier.tier >= TIER_GUARDIAN ? "text-teal" : ""}>G {noxAmount(protocol.guardian, d)}</span>
          {" · "}
          <span className={tier.tier >= TIER_SENTINEL ? "text-warn" : ""}>S {noxAmount(protocol.sentinel, d)}</span>
        </span>
        {nextNeed ? (
          <Link href="/buy" className="text-mute underline decoration-dotted hover:text-teal">
            {noxAmount(gap, d)} more for {TIER_NAMES[nextNeed]}
          </Link>
        ) : (
          <span className="text-warn">top tier</span>
        )}
      </span>
    </div>
  );
}
