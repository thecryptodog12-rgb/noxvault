// Reads a vault from chain into an ExtSnapshot. Same reads as the site's Telegram bot
// (web/lib/alerts/chain.ts readSnapshot), using the SDK's decoders, plus the rules, token balances
// and keys left for the popup. Read-only JSON-RPC calls; nothing is signed or sent.
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { RECOVERY_TREE, TREE_PRIMARY, fetchState, keysLeft, testamentOpensAt, vaultLetters, vaultSchedules } from "../../../sdk/client";
import { readProgram } from "../../../sdk/integrate";
import { quicknetRoundTime } from "../../../web/lib/alerts/logic";
import { rulesFromConfig } from "./rules";
import type { ClusterId, ExtSnapshot, TokenBalance } from "./types";

const conns = new Map<string, Connection>();
export function connection(rpc: string): Connection {
  let c = conns.get(rpc);
  if (!c) {
    c = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: false });
    conns.set(rpc, c);
  }
  return c;
}

/** Optional reads (gPA, token lists) must not sink the whole snapshot when a public RPC refuses them. */
const soft = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

async function tokenBalances(conn: Connection, owner: PublicKey): Promise<TokenBalance[]> {
  const out: TokenBalance[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    for (const { account } of res.value) {
      const info = (account.data as { parsed?: { info?: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmountString: string } } } }).parsed?.info;
      if (!info || info.tokenAmount.amount === "0") continue;
      out.push({ mint: info.mint, ui: info.tokenAmount.uiAmountString, raw: info.tokenAmount.amount, decimals: info.tokenAmount.decimals });
    }
  }
  return out;
}

/** null when the address holds no Noxvault state on this cluster. Throws on RPC failure. */
export async function readSnapshot(vault: string, cluster: ClusterId, rpc: string): Promise<ExtSnapshot | null> {
  const conn = connection(rpc);
  const key = new PublicKey(vault);
  const program = readProgram(conn);
  const state = await fetchState(program, key);
  if (!state) return null;
  const [lamports, schedules, letters, tokens] = await Promise.all([
    conn.getBalance(key, "confirmed"),
    soft(vaultSchedules(program, key), []),
    soft(vaultLetters(program, key), []),
    soft(tokenBalances(conn, key), []),
  ]);
  const c = state.config;
  return {
    vault: key.toBase58(),
    cluster,
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
    rules: rulesFromConfig(c, keysLeft(state, TREE_PRIMARY)),
    tokens,
    createdAt: state.createdAt,
    lastActive: state.lastActive,
    actions: state.actions,
  };
}
