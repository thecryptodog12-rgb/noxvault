// Keeper (docs/SPEC.md §8): one pass over every permissionless instruction that is due.
// It holds no secret of anyone's and cannot change anything that was signed: it only pays
// network fees to run what the rules already allow. Used by GET /api/keeper (Vercel cron) and
// by the long-running keeper in bot/ (bundled from this file; keep it framework-free).
import type { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import {
  SOL_MINT,
  allLinks,
  decodeState,
  escapePda,
  escapeTokenIx,
  executePendingIx,
  fetchCanary,
  fetchProtocol,
  migrateIxs,
  mintTokenProgram,
  runScheduleIx,
  testamentIxs,
  testamentOpensAt,
  tripCanaryIx,
  withRetry,
  type LinkView,
  type Noxvault,
  type ScheduleView,
  type VaultStateView,
} from "@nox/sdk/client";
import { BASE_FEE, escapeTxStatus, heldTokens, packIxs } from "./escape";
import { tiersFor } from "./tiers";

export interface KeeperStep {
  what: string;
  target: string;
  ok: boolean;
  sig?: string;
  error?: string;
}

export interface KeeperReport {
  startedAt: string;
  ms: number;
  keeper: string;
  canary: { balance: number; baseline: string; tripped: boolean } | null;
  links: number;
  vaults: number;
  steps: KeeperStep[];
  errors: string[];
  /** stopped early because maxTx was reached */
  truncated: boolean;
}

export interface KeeperOptions {
  /** transactions per pass at most (default 40) */
  maxTx?: number;
  /** unix seconds; defaults to the cluster's clock */
  now?: number;
  log?: (line: string) => void;
}

const short = (k: PublicKey) => k.toBase58();
const errText = (e: unknown) => {
  const logs = (e as { logs?: string[] })?.logs;
  const anchorErr = logs?.find((l) => /Error Code|Error Message/.test(l));
  return (anchorErr ?? (e instanceof Error ? e.message : String(e))).slice(0, 300);
};

/** One keeper pass. `payer` pays fees (and rent for any token account it has to create). */
export async function runKeeper(program: Program<Noxvault>, payer: Keypair, opts: KeeperOptions = {}): Promise<KeeperReport> {
  const t0 = Date.now();
  const conn = program.provider.connection;
  const maxTx = opts.maxTx ?? 40;
  const log = opts.log ?? (() => {});
  const report: KeeperReport = {
    startedAt: new Date(t0).toISOString(),
    ms: 0,
    keeper: payer.publicKey.toBase58(),
    canary: null,
    links: 0,
    vaults: 0,
    steps: [],
    errors: [],
    truncated: false,
  };
  let sent = 0;
  const budgetLeft = () => {
    if (sent >= maxTx) report.truncated = true;
    return sent < maxTx;
  };

  async function send(what: string, target: string, ixs: TransactionInstruction[]): Promise<boolean> {
    if (!budgetLeft()) return false;
    sent++;
    for (let attempt = 1; ; attempt++) {
      try {
        const tx = new Transaction().add(...ixs);
        tx.feePayer = payer.publicKey;
        const sig = await withRetry(() => sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" }));
        report.steps.push({ what, target, ok: true, sig });
        log(`ok   ${what} ${target} ${sig}`);
        return true;
      } catch (e) {
        if (attempt < 3 && /Blockhash not found|block height exceeded/i.test(String(e))) continue;
        report.steps.push({ what, target, ok: false, error: errText(e) });
        log(`fail ${what} ${target}: ${errText(e)}`);
        return false;
      }
    }
  }

  const slot = await withRetry(() => conn.getSlot("confirmed"));
  const now = opts.now ?? (await withRetry(() => conn.getBlockTime(slot)).catch(() => null)) ?? Math.floor(Date.now() / 1000);

  // (a) canary
  let tripped = false;
  try {
    const c = await fetchCanary(program);
    if (c) {
      tripped = c.tripped;
      if (!c.tripped && BigInt(c.balance) < c.baseline) {
        tripped = await send("trip canary", short(c.watched), [await tripCanaryIx(program)]);
        if (!tripped) tripped = !!(await fetchCanary(program))?.tripped;
      }
      report.canary = { balance: c.balance, baseline: c.baseline.toString(), tripped };
    }
  } catch (e) {
    report.errors.push(`canary: ${errText(e)}`);
  }

  // (b) Escape Hatch: evacuate linked wallets after panic or a tripped canary
  let links: LinkView[] = [];
  try {
    links = await allLinks(program);
    report.links = links.length;
  } catch (e) {
    report.errors.push(`links: ${errText(e)}`);
  }
  // Q-Day priority (whitepaper, $NOX utility): highest tier first, then most $NOX held in the vault.
  if (links.some((l) => tripped || l.panic)) {
    try {
      const protocol = await fetchProtocol(program);
      const tiers = await tiersFor(conn, links.map((l) => l.vault), protocol);
      const rank = (l: LinkView) => tiers.get(l.vault.toBase58()) ?? { tier: 0, held: 0n };
      links.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra.tier !== rb.tier) return rb.tier - ra.tier;
        return rb.held > ra.held ? 1 : rb.held < ra.held ? -1 : 0;
      });
    } catch (e) {
      report.errors.push(`priority: ${errText(e)}`);
    }
  }
  for (const link of links) {
    if (!(tripped || link.panic) || !budgetLeft()) continue;
    const w = short(link.wallet);
    try {
      // SOL: the stored, pre-signed durable-nonce transaction. Anyone may broadcast it.
      const st = await escapeTxStatus(conn, program, link);
      const lamports = await withRetry(() => conn.getBalance(link.wallet, "confirmed"));
      if (st.armed && lamports > BASE_FEE && budgetLeft()) {
        sent++;
        try {
          const sig = await conn.sendRawTransaction(link.escapeTx, { preflightCommitment: "confirmed" });
          const res = await conn.confirmTransaction(sig, "confirmed");
          if (res.value.err) throw new Error(JSON.stringify(res.value.err));
          report.steps.push({ what: "escape SOL", target: w, ok: true, sig });
          log(`ok   escape SOL ${w} ${sig}`);
        } catch (e) {
          // Already used or the nonce moved on: nothing to do.
          report.steps.push({ what: "escape SOL", target: w, ok: false, error: errText(e) });
        }
      }
      // Tokens: every account that delegated to the escape PDA.
      const escape = escapePda(link.wallet, program.programId);
      const delegated = (await heldTokens(conn, link.wallet)).filter((t) => t.delegate?.equals(escape) && t.delegatedAmount > 0n);
      const groups: TransactionInstruction[][] = [];
      for (const t of delegated) groups.push([await escapeTokenIx(program, payer.publicKey, link, t.address, t.mint, t.tokenProgram)]);
      for (const ixs of packIxs(payer.publicKey, groups, 3)) await send("escape tokens", w, ixs);
    } catch (e) {
      report.errors.push(`link ${w}: ${errText(e)}`);
    }
  }

  // (c) vaults: pending withdrawals, schedules, testaments, migrations
  let states: VaultStateView[] = [];
  try {
    const accts = await withRetry(() => conn.getProgramAccounts(program.programId, {
      commitment: "confirmed",
      filters: [{ memcmp: program.coder.accounts.memcmp("vaultState") }],
    }));
    states = accts.map((a) => decodeState(program, a.account.data as Buffer));
    report.vaults = states.length;
  } catch (e) {
    report.errors.push(`vaults: ${errText(e)}`);
  }

  let schedules = new Map<string, ScheduleView[]>();
  try {
    schedules = await allSchedules(program);
  } catch (e) {
    report.errors.push(`schedules: ${errText(e)}`);
  }

  const tokenPrograms = new Map<string, PublicKey>();
  const tokenProgramOf = async (mint: PublicKey) => {
    const k = mint.toBase58();
    if (!tokenPrograms.has(k)) tokenPrograms.set(k, await mintTokenProgram(conn, mint));
    return tokenPrograms.get(k)!;
  };

  for (const state of states) {
    if (!budgetLeft()) break;
    const vault = state.vault;
    const v = short(vault);
    try {
      if (state.pending && now >= state.pending.executableAt) {
        const p = state.pending;
        const tp = p.kind === "withdraw" && !p.mint.equals(SOL_MINT) ? await tokenProgramOf(p.mint) : undefined;
        await send(`execute pending ${p.kind}`, v, [await executePendingIx(program, payer.publicKey, vault, state, tp)]);
      }

      for (const s of schedules.get(vault.toBase58()) ?? []) {
        if (s.remaining <= 0 || s.nextAt > now) continue;
        const tp = s.mint.equals(SOL_MINT) ? undefined : await tokenProgramOf(s.mint);
        await send(`run schedule #${s.id}`, v, [await runScheduleIx(program, payer.publicKey, vault, s, tp)]);
      }

      const opensAt = testamentOpensAt(state);
      const draining = state.migrateTo || (opensAt !== null && now >= opensAt);
      if (draining) {
        const [lamports, tokens] = await Promise.all([withRetry(() => conn.getBalance(vault, "confirmed")), heldTokens(conn, vault)]);
        if (state.migrateTo) {
          if (lamports > 0 || tokens.length) {
            const mints = tokens.map((t) => ({ mint: t.mint, tokenProgram: t.tokenProgram }));
            const ixs = await migrateIxs(program, payer.publicKey, vault, state, mints);
            // token moves first, then SOL (migrateIxs ends with migrate_sol)
            for (const batch of packIxs(payer.publicKey, ixs.map((ix) => [ix]), 2)) await send("migrate", v, batch);
          }
        } else {
          for (const t of tokens) await send("testament token", v, await testamentIxs(program, payer.publicKey, vault, state, { mint: t.mint, tokenProgram: t.tokenProgram }));
          if (lamports > 0) await send("testament SOL", v, await testamentIxs(program, payer.publicKey, vault, state));
        }
      }
    } catch (e) {
      report.errors.push(`vault ${v}: ${errText(e)}`);
    }
  }

  report.ms = Date.now() - t0;
  return report;
}

async function allSchedules(program: Program<Noxvault>): Promise<Map<string, ScheduleView[]>> {
  const all = await withRetry(() => program.account.schedule.all());
  const out = new Map<string, ScheduleView[]>();
  for (const { publicKey, account: s } of all) {
    const k = (s.vault as PublicKey).toBase58();
    const list = out.get(k) ?? [];
    list.push({
      address: publicKey,
      id: s.id,
      mint: s.mint,
      dest: s.dest,
      amount: BigInt(s.amount.toString()),
      interval: Number(s.interval),
      remaining: s.remaining,
      nextAt: Number(s.nextAt),
    });
    out.set(k, list);
  }
  return out;
}
