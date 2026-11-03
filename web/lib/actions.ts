// Solana Actions / Blinks helpers (solana.com/docs/advanced/actions). Server-side only.
import { ACTIONS_CORS_HEADERS, BLOCKCHAIN_IDS, createActionHeaders } from "@solana/actions";
import { NETWORK } from "./config";

/** Actions spec version this server implements. */
export const ACTION_VERSION = "2.4";

/** CAIP-2 id of the cluster the site runs on (devnet unless NEXT_PUBLIC_NETWORK says otherwise). */
export const CHAIN_ID = NETWORK === "mainnet-beta" ? BLOCKCHAIN_IDS.mainnet : NETWORK === "testnet" ? BLOCKCHAIN_IDS.testnet : BLOCKCHAIN_IDS.devnet;

/** CORS + X-Action-Version + X-Blockchain-Ids, for every Actions response (errors included). */
export const ACTION_HEADERS: Record<string, string> = createActionHeaders({ headers: ACTIONS_CORS_HEADERS, chainId: CHAIN_ID, actionVersion: ACTION_VERSION });

export function actionJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: ACTION_HEADERS });
}

/** Actions errors are `{ message }` with a 4xx/5xx status. */
export function actionError(message: string, status = 400): Response {
  return actionJson({ message }, status);
}

/** Preflight answer shared by all Actions routes. */
export function actionOptions(): Response {
  return new Response(null, { status: 204, headers: ACTION_HEADERS });
}

/** Public origin of this request (Vercel sets the host; locally it is localhost). */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const FUND_PRESETS = ["0.1", "0.5", "1"] as const;
export const FUND_MIN_LAMPORTS = 1_000_000n; // 0.001 SOL
export const FUND_MAX_LAMPORTS = 10_000n * 1_000_000_000n; // 10 000 SOL, a typo guard

/**
 * Parses a SOL amount ("0.5", "1", "2.25") into lamports without floating point.
 * Returns null for anything that is not a plain positive decimal with at most 9 decimals.
 */
export function solToLamports(input: string | null | undefined): bigint | null {
  if (input == null) return null;
  const s = String(input).trim().replace(",", ".");
  const m = /^(\d{1,12})(?:\.(\d{1,9}))?$/.exec(s) ?? /^()\.(\d{1,9})$/.exec(s);
  if (!m) return null;
  const whole = BigInt(m[1] || "0");
  const frac = BigInt((m[2] || "").padEnd(9, "0") || "0");
  const l = whole * 1_000_000_000n + frac;
  return l > 0n ? l : null;
}

/** Text shown on the fund Blink: the vault's enforced rules, then its caveats. Blink clients show ~a paragraph. */
export function fundDescription(rules: string[], caveats: string[], balanceLamports: number): string {
  const bal = (balanceLamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const lines = [
    `Send SOL to this Noxvault (holds ${bal} SOL). Rules enforced on-chain:`,
    ...rules.map((r) => `• ${r}`),
    ...caveats.map((c) => `! ${c}`),
    `${NETWORK === "mainnet-beta" ? "Unaudited." : `Unaudited, ${NETWORK}.`} Funding is a plain SOL transfer to the vault address.`,
  ];
  return lines.join("\n");
}
