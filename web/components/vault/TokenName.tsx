"use client";
import type { PublicKey } from "@solana/web3.js";
import { useNox } from "@/lib/hooks";
import { useTokenInfo } from "@/lib/tokens";
import { short } from "@/lib/format";

/** Symbol of a mint (or its shortened address while loading / unknown). */
export default function TokenName({ mint }: { mint: PublicKey }) {
  const { connection } = useNox();
  const info = useTokenInfo(connection, mint);
  return <span title={mint.toBase58()}>{info?.known ? info.symbol : short(mint.toBase58(), 4)}</span>;
}
