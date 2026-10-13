import { PublicKey } from "@solana/web3.js";
import { DEFAULT_LAUNCH_AT } from "./launch.js";

export type Network = "devnet" | "mainnet-beta";

export interface Config {
  telegramToken: string;
  rpcUrl: string;
  network: Network;
  programId: string;
  pollSeconds: number;
  statePath: string;
  rpcDelayMs: number;
  maxWatchesPerChat: number;
  /** $NOX mainnet mint for /ca and /buy; empty until launch. */
  noxToken: string;
  noxLaunchAt: string;
}

export const DEFAULT_PROGRAM_ID = "8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4";

function num(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Error(`${name} must be a number >= ${min}`);
  return n;
}

/** Reads config from env. The Telegram token is only required when `requireToken` is true. */
export function loadConfig(requireToken = true): Config {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (requireToken && !telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is required");

  const network = (process.env.NETWORK ?? "devnet") as Network;
  if (network !== "devnet" && network !== "mainnet-beta") {
    throw new Error("NETWORK must be devnet or mainnet-beta");
  }
  const noxToken = (process.env.NOX_TOKEN ?? "").trim();
  if (noxToken) {
    // Refuse to start with a typo'd CA rather than post a wrong address.
    let ok = false;
    try {
      ok = new PublicKey(noxToken).toBase58() === noxToken;
    } catch {}
    if (!ok) throw new Error("NOX_TOKEN is not a valid Solana address");
  }
  const noxLaunchAt = process.env.NOX_LAUNCH_AT || DEFAULT_LAUNCH_AT;
  if (Number.isNaN(Date.parse(noxLaunchAt))) throw new Error("NOX_LAUNCH_AT must be an ISO date");

  const defaultRpc =
    network === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com";

  return {
    telegramToken,
    rpcUrl: process.env.RPC_URL || defaultRpc,
    network,
    programId: process.env.NOXVAULT_PROGRAM_ID || DEFAULT_PROGRAM_ID,
    pollSeconds: num("POLL_SECONDS", 20, 5),
    statePath: process.env.STATE_PATH || "./data/state.json",
    rpcDelayMs: num("RPC_DELAY_MS", 250, 0),
    maxWatchesPerChat: 10,
    noxToken,
    noxLaunchAt,
  };
}
