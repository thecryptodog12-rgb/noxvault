// Single place for network settings and brand constants.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || "devnet") as "devnet" | "mainnet-beta" | "testnet" | "localnet";

/**
 * $NOX mint shown in the UI. On devnet this is the test token tNOX (no value); the program's own
 * protocol account (fetchProtocol) is the source of truth for tiers. Mainnet: set at launch.
 */
export const NOX_CA = NETWORK === "devnet" ? "9BGzxXGPpoQnFisTDGmEmaxy1hbzmd2yXSmivsfgbLA5" : "";
export const NOX_CA_LABEL = NETWORK === "devnet" ? "tNOX · devnet test token" : "$NOX";
export const NOX_CA_PLACEHOLDER = "soon";
/**
 * The real $NOX on Solana mainnet (fair launch on pump.fun). Set NEXT_PUBLIC_NOX_TOKEN at launch;
 * until then the site counts down to NOX_LAUNCH_AT. Tiers on devnet keep using tNOX above.
 */
export const NOX_TOKEN = process.env.NEXT_PUBLIC_NOX_TOKEN || "";
export const NOX_LAUNCH_AT = process.env.NEXT_PUBLIC_NOX_LAUNCH_AT || "2026-10-13T20:00:00+02:00";
export const PUMP_URL = NOX_TOKEN ? `https://pump.fun/coin/${NOX_TOKEN}` : "https://pump.fun";
export const CHART_URL = NOX_TOKEN ? `https://dexscreener.com/solana/${NOX_TOKEN}` : "";
export const SOLSCAN_TOKEN_URL = NOX_TOKEN ? `https://solscan.io/token/${NOX_TOKEN}` : "";
/** Wallet that receives the creator and protocol fees and sends the buyback-and-burn transactions. */
export const TREASURY = process.env.NEXT_PUBLIC_TREASURY || "";
/** Share of fees that buys back and burns $NOX (docs/WHITEPAPER.md, The flywheel). */
export const BURN_SHARE = 50;
/** Test $NOX the devnet faucet sends per request (whole tokens). */
export const FAUCET_AMOUNT = 100_000;

export const VERSION = "v1";

export function explorerUrl(value: string, kind: "address" | "tx" = "address"): string {
  const cluster =
    NETWORK === "mainnet-beta"
      ? ""
      : NETWORK === "localnet"
        ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`
        : `?cluster=${NETWORK}`;
  return `https://explorer.solana.com/${kind}/${value}${cluster}`;
}

/** Project X/Twitter link shown in the nav. */
export const X_URL = "https://x.com/noxvaultHQ";
