// Every vault on the cluster with its SOL balance: one getProgramAccounts plus batched balance
// reads. Shared by /stats and the homepage strip.
import type { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { RECOVERY_TREE, decodeState, withRetry, type VaultStateView } from "@nox/sdk/client";
import type { useNox } from "./hooks";

type Program = ReturnType<typeof useNox>["program"];

export interface VaultRow {
  vault: PublicKey;
  actions: number;
  createdAt: number;
  recovery: boolean;
  whitelist: boolean;
  multisig: boolean;
  heirs: boolean;
  migrating: boolean;
  pending: boolean;
  lamports: number;
}

export async function loadVaultRows(program: Program): Promise<VaultRow[]> {
  const conn = program.provider.connection;
  const accts = await withRetry(() =>
    conn.getProgramAccounts(program.programId, { commitment: "confirmed", filters: [{ memcmp: program.coder.accounts.memcmp("vaultState") }] })
  );
  const rows: VaultRow[] = accts.flatMap(({ account }) => {
    try {
      const s = decodeState(program, account.data);
      return [
        {
          vault: s.vault,
          actions: s.actions,
          createdAt: s.createdAt,
          recovery: s.config.trees[RECOVERY_TREE].height > 0,
          whitelist: s.config.whitelist.length > 0,
          multisig: [0, 1, 2].filter((t) => s.config.trees[t].height > 0).length > 1,
          heirs: s.config.heirs.length > 0,
          migrating: !!s.migrateTo,
          pending: !!s.pending,
          lamports: 0,
        },
      ];
    } catch {
      return []; // account from an older program version
    }
  });
  const bal = await balancesOf(conn, rows.map((r) => r.vault));
  rows.forEach((r, i) => (r.lamports = bal[i]));
  return rows;
}

/** Lamports of many accounts, 100 per getMultipleAccountsInfo call (0 for missing accounts). */
export async function balancesOf(conn: Connection, keys: PublicKey[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const infos = await withRetry(() => conn.getMultipleAccountsInfo(keys.slice(i, i + 100), "confirmed"));
    infos.forEach((info) => out.push(info?.lamports ?? 0));
  }
  return out;
}

export interface TreasuryRow {
  state: VaultStateView;
  lamports: number;
  /** vesting / payout schedules attached to the vault */
  schedules: number;
}

/**
 * Every vault plus its schedule count in ONE getProgramAccounts call: the scan is unfiltered and
 * split by account discriminator, because vesting lives in separate schedule accounts and a
 * per-vault schedule query would be a scan per row. Balances follow in batched reads.
 */
export async function scanTreasuries(program: Program): Promise<TreasuryRow[]> {
  const conn = program.provider.connection;
  const disc = (name: string) => bs58.decode(program.coder.accounts.memcmp(name).bytes as string);
  const stateDisc = disc("vaultState");
  const schedDisc = disc("schedule");
  const is = (data: Buffer, d: Uint8Array) => d.every((b, i) => data[i] === b);
  const accts = await withRetry(() => conn.getProgramAccounts(program.programId, { commitment: "confirmed" }));
  const states: VaultStateView[] = [];
  const schedules = new Map<string, number>();
  for (const { account } of accts) {
    const data = account.data;
    if (is(data, stateDisc)) {
      try {
        states.push(decodeState(program, data));
      } catch {
        /* account from an older program version */
      }
    } else if (is(data, schedDisc) && data.length >= 40) {
      const v = bs58.encode(data.subarray(8, 40)); // Schedule.vault sits right after the discriminator
      schedules.set(v, (schedules.get(v) ?? 0) + 1);
    }
  }
  const bal = await balancesOf(conn, states.map((s) => s.vault));
  return states.map((state, i) => ({ state, lamports: bal[i], schedules: schedules.get(state.vault.toBase58()) ?? 0 }));
}
