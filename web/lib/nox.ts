"use client";
// $NOX in the web app: protocol parameters (live from chain), a vault's tier, and formatting.
import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { TIER_FREE, TIER_GUARDIAN, TIER_NAMES, TIER_SENTINEL, fetchProtocol, vaultTier, withRetry, type ProtocolView, type TierView } from "@nox/sdk/client";
import { useNox } from "./hooks";
import { fromBaseUnits } from "./format";

export { TIER_FREE, TIER_GUARDIAN, TIER_SENTINEL, TIER_NAMES };

export interface Protocol extends ProtocolView {
  decimals: number;
}

let cache: Promise<Protocol | null> | null = null;

export function loadProtocol(program: ReturnType<typeof useNox>["program"]): Promise<Protocol | null> {
  cache ??= (async () => {
    const p = await fetchProtocol(program);
    if (!p) return null;
    let decimals = 0;
    try {
      const info = await withRetry(() => program.provider.connection.getParsedAccountInfo(p.noxMint, "confirmed"));
      decimals = (info.value?.data as { parsed?: { info?: { decimals?: number } } })?.parsed?.info?.decimals ?? 0;
    } catch {}
    return { ...p, decimals };
  })().catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

/** Protocol parameters (null while loading or when not initialized). */
export function useProtocol() {
  const { program } = useNox();
  const [p, setP] = useState<Protocol | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadProtocol(program)
      .then((x) => live && setP(x))
      .catch(() => live && setP(null));
    return () => {
      live = false;
    };
  }, [program]);
  return p;
}

/** A vault's tier; `nonce` re-reads it. */
export function useVaultTier(vault: PublicKey | null, nonce = 0) {
  const { program } = useNox();
  const protocol = useProtocol();
  const [t, setT] = useState<TierView | null>(null);
  const key = vault?.toBase58();
  useEffect(() => {
    if (!vault || protocol === undefined) return;
    let live = true;
    vaultTier(program, vault, protocol)
      .then((x) => live && setT(x))
      .catch(() => live && setT(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, program, protocol, nonce]);
  return { tier: t, protocol };
}

export const noxAmount = (base: bigint, decimals: number) => fromBaseUnits(base, decimals);

export function tierNeedText(need: number, t: TierView | null, p: Protocol | null | undefined): string {
  if (!p || !t || !t.tiersOn) return "";
  const target = need === TIER_SENTINEL ? p.sentinel : need === TIER_GUARDIAN ? p.guardian : 0n;
  const missing = target > t.held ? target - t.held : 0n;
  return `needs ${TIER_NAMES[need]} — add ${noxAmount(missing, p.decimals)} $NOX to the vault`;
}

export { tiersFor } from "./tiers";
