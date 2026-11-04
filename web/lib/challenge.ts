// "Crack this vault": a public vault whose only secret is the owner's phrase. Config-driven, so
// the page shows a "coming after the audit" state until the vault is set. Pure; runs on both sides.
import { PublicKey, clusterApiUrl } from "@solana/web3.js";
import { NETWORK, NOX_MAINNET_RPC_URL, RPC_URL } from "./config";

export type Cluster = "devnet" | "mainnet-beta" | "testnet" | "localnet";

const CLUSTERS: readonly Cluster[] = ["devnet", "mainnet-beta", "testnet", "localnet"];

/** A valid base58 public key, or "" for an empty or malformed value. */
export function parseVault(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  try {
    return new PublicKey(v).toBase58();
  } catch {
    return "";
  }
}

/** The challenge cluster; the bounty is meant for mainnet, so that is the default. */
export function parseCluster(raw: string | undefined): Cluster {
  const v = (raw ?? "").trim() as Cluster;
  return CLUSTERS.includes(v) ? v : "mainnet-beta";
}

/** Unix seconds for an ISO date, or null when empty or unparsable. */
export function parseStart(raw: string | undefined): number | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Whole days between start and now; 0 before the start or without one. */
export function daysUnbroken(startUnix: number | null, nowUnix: number): number {
  if (!startUnix || nowUnix <= startUnix) return 0;
  return Math.floor((nowUnix - startUnix) / 86400);
}

/** Address of the challenge vault. Empty until the challenge opens (after the external audit). */
export const CHALLENGE_VAULT = parseVault(process.env.NEXT_PUBLIC_CHALLENGE_VAULT);
export const CHALLENGE_CLUSTER = parseCluster(process.env.NEXT_PUBLIC_CHALLENGE_CLUSTER);
/** Optional official start (ISO date); without it the counter starts at the vault's creation. */
export const CHALLENGE_START = parseStart(process.env.NEXT_PUBLIC_CHALLENGE_START);

/** True when the challenge vault lives on the cluster this site reads, so /t/<vault> shows it. */
export const CHALLENGE_ON_SITE_NETWORK = CHALLENGE_CLUSTER === NETWORK;

/** RPC for the challenge cluster: the site's own when it matches, else the configured mainnet RPC or a public one. */
export function challengeRpcUrl(cluster: Cluster = CHALLENGE_CLUSTER): string {
  if (cluster === NETWORK) return RPC_URL;
  if (cluster === "mainnet-beta") return NOX_MAINNET_RPC_URL;
  if (cluster === "localnet") return "http://127.0.0.1:8899";
  return clusterApiUrl(cluster);
}

/** Explorer link on the challenge cluster (explorerUrl in config.ts follows the site's network). */
export function challengeExplorerUrl(value: string, kind: "address" | "tx" = "address", cluster: Cluster = CHALLENGE_CLUSTER): string {
  const q =
    cluster === "mainnet-beta"
      ? ""
      : cluster === "localnet"
        ? `?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:8899")}`
        : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${kind}/${value}${q}`;
}

/** Tree slots in a vault config, in order: three signer trees, recovery, duress. */
export const TREE_NAMES = ["signer 1", "signer 2", "signer 3", "recovery", "duress"];
