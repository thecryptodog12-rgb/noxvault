// Public treasury view: a vault's rules in plain words plus its holdings, for /t/<vault>,
// the JSON API and the badge. Pure data; no browser APIs, so it runs on the server too.
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { RECOVERY_TREE, fetchState, vaultSchedules, vaultStakes, type VaultStateView } from "@nox/sdk/client";
import { readProgram } from "./program";

export interface TreasuryToken {
  mint: string;
  amount: string; // base units
  decimals: number;
}

export interface TreasurySchedule {
  mint: string;
  dest: string;
  amount: string;
  everySecs: number;
  remaining: number;
  nextAt: number;
}

export interface Treasury {
  vault: string;
  initialized: boolean;
  lamports: number;
  stakedLamports: number;
  tokens: TreasuryToken[];
  signers: number;
  threshold: number;
  createdAt: number;
  lastActive: number;
  actions: number;
  pending: { mint: string; dest: string; amount: string; executableAt: number } | null;
  schedules: TreasurySchedule[];
  /** Guarantees enforced by the program, in plain words. */
  rules: string[];
  /** Things a holder should know that weaken the guarantees. */
  caveats: string[];
  /** 0–5: one point per protection present. */
  score: number;
  checkedAt: number;
}

const SOL = PublicKey.default.toBase58();

// Own copy: lib/time.ts is a client module.
function duration(secs: number): string {
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  if (d > 0) return h ? `${d} days ${h} h` : `${d} day${d > 1 ? "s" : ""}`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} hours`;
  return `${Math.max(m, 1)} min`;
}
const sol = (l: bigint | number) => `${(Number(l) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;

export function rulesOf(s: VaultStateView): { rules: string[]; caveats: string[]; score: number } {
  const c = s.config;
  const signers = [0, 1, 2].filter((t) => c.trees[t].height > 0).length;
  const rules: string[] = ["Every action needs a hash-based one-time signature; no ordinary wallet key can move funds."];
  const caveats: string[] = [];
  let score = 0;

  if (signers > 1) {
    rules.push(`${c.threshold} of ${signers} signers must approve every action.`);
    if (c.threshold > 1) score++;
    else caveats.push("Any single signer can act alone (threshold 1).");
  } else {
    caveats.push("One signer controls the treasury.");
  }

  const wl = c.whitelist.length;
  if (wl > 0) {
    rules.push(`Payouts to ${wl} pre-approved address${wl > 1 ? "es" : ""} are immediate.`);
  }
  if (wl > 0 || c.instantLimit > 0n) {
    if (c.slowDelay > 0n) {
      rules.push(
        `Any other payout ${c.instantLimit > 0n ? `above ${sol(c.instantLimit)} per 24 h ` : ""}waits ${duration(Number(c.slowDelay))} in public before it can execute.`
      );
      score++;
      if (Number(c.slowDelay) >= 48 * 3600) score++;
    } else {
      rules.push(`Payouts to any other address are refused${c.instantLimit > 0n ? ` above ${sol(c.instantLimit)} per 24 h` : ""}.`);
      score += 2;
    }
  } else {
    caveats.push("No delay or whitelist: approved payouts go anywhere immediately.");
  }

  if (c.trees[RECOVERY_TREE].height > 0) {
    rules.push(`A recovery key can cancel any pending payout, and takes over after ${duration(Number(c.recoveryDelay))} of inactivity.`);
    score++;
  }
  if (c.heirs.length > 0) {
    rules.push(`After ${duration(Number(c.testamentDelay))} without activity, funds go to ${c.heirs.length} preset address${c.heirs.length > 1 ? "es" : ""}.`);
  }
  if (s.migrateTo) caveats.push(`This treasury is moving to ${s.migrateTo.toBase58()}.`);
  return { rules, caveats, score: Math.min(score, 5) };
}

export async function loadTreasury(conn: Connection, vault: PublicKey): Promise<Treasury> {
  const program = readProgram(conn);
  const [state, lamports, stakes, ...lists] = await Promise.all([
    fetchState(program, vault),
    conn.getBalance(vault, "confirmed"),
    vaultStakes(program, vault).catch(() => []),
    ...[TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) => conn.getParsedTokenAccountsByOwner(vault, { programId }, "confirmed")),
  ]);
  const tokens: TreasuryToken[] = [];
  for (const r of lists) {
    for (const a of r.value) {
      const info = (a.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } }).parsed.info;
      if (info.tokenAmount.amount !== "0") tokens.push({ mint: info.mint, amount: info.tokenAmount.amount, decimals: info.tokenAmount.decimals });
    }
  }
  const staked = stakes.reduce((t, s) => t + (s?.lamports ?? 0), 0);
  const base = { vault: vault.toBase58(), lamports, stakedLamports: staked, tokens, checkedAt: Math.floor(Date.now() / 1000) };
  if (!state) {
    return { ...base, initialized: false, signers: 0, threshold: 0, createdAt: 0, lastActive: 0, actions: 0, pending: null, schedules: [], rules: [], caveats: ["Not an initialized Noxvault."], score: 0 };
  }
  const schedules = (await vaultSchedules(program, vault).catch(() => [])).map((s) => ({
    mint: s.mint.toBase58(),
    dest: s.dest.toBase58(),
    amount: s.amount.toString(),
    everySecs: s.interval,
    remaining: s.remaining,
    nextAt: s.nextAt,
  }));
  const { rules, caveats, score } = rulesOf(state);
  if (schedules.length) rules.push(`${schedules.length} scheduled payout${schedules.length > 1 ? "s" : ""} (vesting) run on fixed dates; nobody can speed them up.`);
  return {
    ...base,
    initialized: true,
    signers: [0, 1, 2].filter((t) => state.config.trees[t].height > 0).length,
    threshold: state.config.threshold,
    createdAt: state.createdAt,
    lastActive: state.lastActive,
    actions: state.actions,
    pending: state.pending
      ? { mint: state.pending.mint.toBase58(), dest: state.pending.dest.toBase58(), amount: state.pending.amount.toString(), executableAt: state.pending.executableAt }
      : null,
    schedules,
    rules,
    caveats,
    score,
  };
}

export const isSolMint = (m: string) => m === SOL;

export interface RuleTag {
  t: string;
  /** "good": a protection; "warn": a caveat a holder should see */
  tone: "good" | "warn";
}

/**
 * Short labels for the leaderboard, from the same on-chain config rulesOf reads. `schedules` is
 * the number of schedule (vesting) accounts of the vault.
 */
export function ruleTags(s: VaultStateView, schedules = 0): RuleTag[] {
  const c = s.config;
  const signers = [0, 1, 2].filter((t) => c.trees[t].height > 0).length;
  const tags: RuleTag[] = [];
  if (signers > 1) tags.push({ t: `${c.threshold} of ${signers}`, tone: c.threshold > 1 ? "good" : "warn" });
  const gated = c.whitelist.length > 0 || c.instantLimit > 0n;
  if (gated) tags.push(c.slowDelay > 0n ? { t: `delay ${duration(Number(c.slowDelay))}`, tone: "good" } : { t: "allowlist only", tone: "good" });
  if (c.trees[RECOVERY_TREE].height > 0) tags.push({ t: "recovery", tone: "good" });
  if (c.heirs.length > 0) tags.push({ t: "testament", tone: "good" });
  if (schedules > 0) tags.push({ t: `vesting ×${schedules}`, tone: "good" });
  if (s.migrateTo) tags.push({ t: "migrating", tone: "warn" });
  return tags;
}

/** The payout delay in words: a duration, "refused" (allowlist only) or "none". */
export function delayOf(s: VaultStateView): string {
  const c = s.config;
  if (!(c.whitelist.length > 0 || c.instantLimit > 0n)) return "none";
  return c.slowDelay > 0n ? duration(Number(c.slowDelay)) : "refused";
}
