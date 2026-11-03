// Numbers for the homepage strip. Imported dynamically by components/home/LiveStrip, so the
// program IDL and anchor only load after the page has rendered.
import type { Connection } from "@solana/web3.js";
import { fetchCanary } from "@nox/sdk/client";
import { readProgram } from "./program";
import { loadVaultRows } from "./stats";

export interface HomeStats {
  vaults: { count: number; lamports: number; actions: number } | null; // null: the RPC refused the scan
  canary: { tripped: boolean; bounty: number } | null; // null: not initialized / unreadable
}

export async function fetchHomeStats(conn: Connection): Promise<HomeStats> {
  const program = readProgram(conn);
  const [rows, canary] = await Promise.all([loadVaultRows(program).catch(() => null), fetchCanary(program).catch(() => null)]);
  return {
    vaults: rows
      ? { count: rows.length, lamports: rows.reduce((s, r) => s + r.lamports, 0), actions: rows.reduce((s, r) => s + r.actions, 0) }
      : null,
    canary: canary ? { tripped: canary.tripped, bounty: canary.balance } : null,
  };
}
