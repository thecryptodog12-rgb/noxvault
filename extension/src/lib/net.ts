// Clusters, RPC endpoints, address validation and the nox-vault.com deep links. Pure; no chrome.*.
import type { ClusterId } from "./types";

export const SITE = "https://www.nox-vault.com";

export const RPC: Record<Exclude<ClusterId, "custom">, string> = {
  devnet: "https://api.devnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export const CLUSTER_LABEL: Record<ClusterId, string> = { devnet: "devnet", "mainnet-beta": "mainnet-beta", custom: "custom RPC" };

export function rpcFor(cluster: ClusterId, customRpc: string): string {
  return cluster === "custom" ? customRpc : RPC[cluster];
}

/**
 * Validates a custom RPC URL and returns the host-permission pattern to request for it.
 * https only (plain http allowed for localhost). null when the URL is unusable.
 */
export function rpcOriginPattern(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password) return null;
  return `${u.protocol}//${u.hostname}/*`;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decodes base58; null on a bad character. */
export function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

/** A trimmed base58 Solana address (32 bytes), or null. */
export function parseAddress(input: string): string | null {
  const s = input.trim();
  if (s.length < 32 || s.length > 44) return null;
  const b = base58Decode(s);
  return b && b.length === 32 ? s : null;
}

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Deep links into nox-vault.com. Signing always happens there, never in the extension. */
export function siteLinks(vault: string) {
  const v = encodeURIComponent(vault);
  return {
    /** Public treasury view: rules, history, balance. */
    view: `${SITE}/t/${v}`,
    /** Deposit page (wallet connect, Blink). */
    fund: `${SITE}/fund/${v}`,
    /** Owner: open with your phrase on the site to withdraw, ping or cancel. */
    owner: `${SITE}/mine`,
    /** Recovery key holder: cancel a pending withdrawal, end a lockdown, take over after inactivity. */
    recovery: `${SITE}/recovery?vault=${v}`,
    letters: `${SITE}/letters/${v}`,
    create: `${SITE}/create`,
  };
}

/** Solana Explorer link for an address on a cluster. */
export function explorerUrl(address: string, cluster: ClusterId, customRpc = ""): string {
  const base = `https://explorer.solana.com/address/${encodeURIComponent(address)}`;
  if (cluster === "mainnet-beta") return base;
  if (cluster === "devnet") return `${base}?cluster=devnet`;
  return `${base}?cluster=custom&customUrl=${encodeURIComponent(customRpc)}`;
}
