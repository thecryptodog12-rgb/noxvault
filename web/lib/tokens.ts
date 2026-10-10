// Token names for display: Token-2022 metadata extension or the Metaplex metadata account.
// Cached in memory and in localStorage. Falls back to a shortened mint address.
import { useEffect, useState } from "react";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  getTokenMetadata,
  unpackMint,
} from "@solana/spl-token";
import { withRetry } from "@nox/sdk/client";
import { NETWORK } from "./config";

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  /** false when no metadata was found and symbol/name are just the shortened mint */
  known: boolean;
  program?: "spl-token" | "token-2022";
}

export const METAPLEX_METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SOL_MINT = PublicKey.default.toBase58();
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const TTL_MS = 7 * 86400_000;
const LS_PREFIX = `nox.token.${NETWORK}.`;

const memory = new Map<string, Promise<TokenInfo>>();

const shortMint = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;

export function metaplexPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("metadata"), METAPLEX_METADATA_PROGRAM.toBytes(), mint.toBytes()],
    METAPLEX_METADATA_PROGRAM
  )[0];
}

/** Decodes name/symbol/uri from a Metaplex metadata account (key, update authority, mint, then 3 borsh strings). */
export function decodeMetaplex(data: Uint8Array): { name: string; symbol: string; uri: string } | null {
  try {
    let o = 1 + 32 + 32;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const str = (max: number) => {
      const len = view.getUint32(o, true);
      if (len > max) throw new Error("bad string");
      o += 4;
      const s = new TextDecoder().decode(data.subarray(o, o + len));
      o += len;
      return s.replace(/\0/g, "").trim();
    };
    const name = str(64);
    const symbol = str(32);
    const uri = str(400);
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

function fromStorage(mint: string): TokenInfo | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + mint);
    if (!raw) return null;
    const { at, info } = JSON.parse(raw) as { at: number; info: TokenInfo };
    if (Date.now() - at > (info.known ? TTL_MS : TTL_MS / 7)) return null;
    return info;
  } catch {
    return null;
  }
}

function toStorage(info: TokenInfo) {
  try {
    localStorage.setItem(LS_PREFIX + info.mint, JSON.stringify({ at: Date.now(), info }));
  } catch {}
}

async function logoFromUri(uri: string): Promise<string | undefined> {
  if (!/^https:\/\//.test(uri)) return undefined;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(uri, { signal: ctl.signal });
    clearTimeout(t);
    const j = (await r.json()) as { image?: unknown };
    return typeof j.image === "string" && /^https:\/\//.test(j.image) ? j.image : undefined;
  } catch {
    return undefined;
  }
}

async function load(conn: Connection, mint: PublicKey): Promise<TokenInfo> {
  const m = mint.toBase58();
  const fallback: TokenInfo = { mint: m, symbol: shortMint(m), name: shortMint(m), decimals: 0, known: false };
  const [mintInfo, mpInfo] = await withRetry(() => conn.getMultipleAccountsInfo([mint, metaplexPda(mint)], "confirmed"));
  if (!mintInfo) return fallback;
  const owner = mintInfo.owner;
  if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) return fallback;
  const parsed = unpackMint(mint, mintInfo, owner);
  const base: TokenInfo = {
    ...fallback,
    decimals: parsed.decimals,
    program: owner.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : "spl-token",
  };

  let meta: { name: string; symbol: string; uri: string } | null = null;
  if (owner.equals(TOKEN_2022_PROGRAM_ID) && getExtensionTypes(parsed.tlvData).includes(ExtensionType.TokenMetadata)) {
    try {
      const tm = await withRetry(() => getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID));
      if (tm) meta = { name: tm.name, symbol: tm.symbol, uri: tm.uri };
    } catch {}
  }
  if (!meta && mpInfo && mpInfo.owner.equals(METAPLEX_METADATA_PROGRAM)) meta = decodeMetaplex(mpInfo.data);
  if (!meta || (!meta.name && !meta.symbol)) return base;
  return {
    ...base,
    name: meta.name || meta.symbol,
    symbol: meta.symbol || meta.name.slice(0, 10),
    logo: await logoFromUri(meta.uri),
    known: true,
  };
}

/**
 * Display info for a mint. Pass PublicKey.default (all-zero) for native SOL.
 * Never throws: on any RPC error it returns the shortened mint (and does not cache that).
 */
export function tokenInfo(conn: Connection, mint: PublicKey | string): Promise<TokenInfo> {
  const key = typeof mint === "string" ? new PublicKey(mint) : mint;
  const m = key.toBase58();
  if (m === SOL_MINT) return Promise.resolve({ mint: m, symbol: "SOL", name: "Solana", decimals: 9, known: true });
  if (m === WSOL_MINT) return Promise.resolve({ mint: m, symbol: "wSOL", name: "Wrapped SOL", decimals: 9, known: true, program: "spl-token" });
  const hit = memory.get(m);
  if (hit) return hit;
  const stored = typeof window !== "undefined" ? fromStorage(m) : null;
  if (stored) {
    const p = Promise.resolve(stored);
    memory.set(m, p);
    return p;
  }
  const p = load(conn, key).then(
    (info) => {
      toStorage(info);
      return info;
    },
    () => {
      memory.delete(m); // retry next time
      return { mint: m, symbol: shortMint(m), name: shortMint(m), decimals: 0, known: false } as TokenInfo;
    }
  );
  memory.set(m, p);
  return p;
}

/** React helper: token info for a mint, null while loading. */
export function useTokenInfo(conn: Connection, mint: PublicKey | string | null | undefined): TokenInfo | null {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const key = mint ? (typeof mint === "string" ? mint : mint.toBase58()) : null;
  useEffect(() => {
    let live = true;
    setInfo(null);
    if (!key) return;
    tokenInfo(conn, key).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [conn, key]);
  return info;
}
