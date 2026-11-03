// Every vault on the cluster with its SOL balance: one getProgramAccounts plus batched balance
// reads. Shared by /stats and the homepage strip.
import type { PublicKey } from "@solana/web3.js";
import { RECOVERY_TREE, decodeState, withRetry } from "@nox/sdk/client";
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
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const infos = await withRetry(() => conn.getMultipleAccountsInfo(chunk.map((r) => r.vault), "confirmed"));
    infos.forEach((info, j) => (chunk[j].lamports = info?.lamports ?? 0));
  }
  return rows;
}
