// Single place for network settings and brand constants.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || "devnet") as "devnet" | "mainnet-beta" | "testnet" | "localnet";

/** $NOX contract address. Leave empty until launch; the sidebar shows NOX_CA_PLACEHOLDER. */
export const NOX_CA = "";
export const NOX_CA_PLACEHOLDER = "soon";

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
