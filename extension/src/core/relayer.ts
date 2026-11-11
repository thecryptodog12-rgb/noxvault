// The site's public relayer API (web/app/api/{relayer-info,relay,init,faucet}), called from the
// extension. Same requests the site's own pages make (web/lib/unlock.ts fetchRelayerInfo /
// relayAction, web/app/create/SetupVault.tsx initViaRelayer / faucet), with an absolute base URL.
// The relayer only ever receives public data: a finished WOTS signature, or a public vault config.
import type { Config, SignedAction } from "../../../sdk/client";
import { encodeRelayRequest } from "../../../sdk/relayer";
import { configToJson } from "../../../web/lib/configJson";
import type { RelayerInfo } from "../../../web/lib/unlock";
import { SITE } from "../lib/net";

export const RELAYER_BASE = SITE;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${RELAYER_BASE}${path}`, { cache: "no-store", ...init });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error || `${path} failed (${r.status})`);
  return j as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function fetchRelayerInfo(): Promise<RelayerInfo> {
  return call<RelayerInfo>("/api/relayer-info");
}

/** Sends a signed action through the relayer. Safe to repeat with the same action. */
export async function relayAction(s: SignedAction): Promise<string[]> {
  return (await call<{ signatures: string[] }>("/api/relay", post(encodeRelayRequest(s)))).signatures;
}

/** Asks the relayer to initialize a vault (needs ≥ 0.02 SOL in it and, with tiers on, Guardian tier). */
export function initViaRelayer(config: Config): Promise<{ vault: string; signature?: string; already?: boolean }> {
  return call("/api/init", post(configToJson(config)));
}

/** Devnet only: test $NOX (tNOX) into the vault, enough for the Sentinel tier. */
export function faucet(vault: string): Promise<{ amount: number; signature: string }> {
  return call("/api/faucet", post({ vault }));
}
