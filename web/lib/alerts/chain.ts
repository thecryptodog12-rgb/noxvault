// Reads a vault into a VaultSnapshot for the Telegram bot. Server-side; read-only RPC calls.
import { Connection, PublicKey } from "@solana/web3.js";
import { RECOVERY_TREE, fetchState, testamentOpensAt, vaultLetters, vaultSchedules, withRetry } from "@nox/sdk/client";
import { RPC_URL } from "@/lib/config";
import { readProgram } from "@/lib/program";
import { quicknetRoundTime, type VaultSnapshot } from "./logic";

export function parseAddress(s: string): string | null {
  try {
    return new PublicKey(s.trim()).toBase58();
  } catch {
    return null;
  }
}

/** null when the address is not an initialized Noxvault. */
export async function readSnapshot(vault: string, conn = new Connection(RPC_URL, "confirmed")): Promise<VaultSnapshot | null> {
  const key = new PublicKey(vault);
  const program = readProgram(conn);
  const state = await fetchState(program, key);
  if (!state) return null;
  const [lamports, schedules, letters] = await Promise.all([
    withRetry(() => conn.getBalance(key, "confirmed")),
    vaultSchedules(program, key),
    vaultLetters(program, key),
  ]);
  const c = state.config;
  return {
    vault: key.toBase58(),
    takenAt: Math.floor(Date.now() / 1000),
    lamports,
    pending: state.pending
      ? {
          kind: state.pending.kind,
          mint: state.pending.mint.toBase58(),
          dest: state.pending.dest.toBase58(),
          amount: state.pending.amount.toString(),
          executableAt: state.pending.executableAt,
        }
      : null,
    lockdownUntil: state.lockdownUntil,
    recoveryAt: c.trees[RECOVERY_TREE].height > 0 ? state.lastActive + Number(c.recoveryDelay) : null,
    testamentAt: testamentOpensAt(state),
    schedules: schedules
      .map((s) => ({ id: s.id, mint: s.mint.toBase58(), dest: s.dest.toBase58(), amount: s.amount.toString(), remaining: s.remaining, nextAt: s.nextAt }))
      .sort((a, b) => a.id - b.id),
    letters: letters.map((l) => ({ id: l.id, label: l.label, unlockRound: l.unlockRound.toString(), opensAt: quicknetRoundTime(l.unlockRound) })),
  };
}
