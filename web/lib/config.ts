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
export const X_URL = "https://x.com";
