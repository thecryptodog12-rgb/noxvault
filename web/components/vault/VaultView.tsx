"use client";
// One v3 vault: balances, rules, signers, recovery / testament clocks, pending, approvals,
// schedules, budgets, migration, invoice addresses and the action form.
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  RECOVERY_TREE,
  executePendingIx,
  fetchState,
  keysLeft,
  mintTokenProgram,
  vaultApprovals,
  vaultBudgets,
  vaultSchedules,
  vaultStakes,
  withRetry,
  type ApprovalView,
  type BudgetView,
  type ScheduleView,
  type Signer,
  type VaultStateView,
} from "@nox/sdk/client";
import type { Action } from "@nox/sdk/wots";
import { Copy, Label, Note, Panel } from "@/components/ui";
import ActionPanel, { type StakeSlot } from "./ActionPanel";
import TokenName from "./TokenName";
import { Approvals, Budgets, Inboxes, Migration, RunMsg, Schedules, Section, Testament } from "./sections";
import { useNox } from "@/lib/hooks";
import { useRunner } from "@/lib/run";
import { errMsg, fromBaseUnits, short, sol } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import { isSol, vaultAssets, type VaultAssets } from "@/lib/unlock";
import { dateTime, duration, useNow } from "@/lib/time";

const slotName = (t: number) => (t === RECOVERY_TREE ? "recovery" : `signer ${t + 1}`);

export default function VaultView({
  vault,
  initialState,
  signer,
  title,
}: {
  vault: PublicKey;
  initialState: VaultStateView;
  signer: Signer;
  title?: string;
}) {
  const { connection, program } = useNox();
  const now = useNow();
  const [state, setState] = useState(initialState);
  const [assets, setAssets] = useState<VaultAssets | null>(null);
  const [stakes, setStakes] = useState<(StakeSlot | null)[]>([]);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [budgets, setBudgets] = useState<BudgetView[]>([]);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Action | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, a, st] = await withRetry(() => Promise.all([fetchState(program, vault), vaultAssets(connection, vault), vaultStakes(program, vault)]));
      if (s) setState(s);
      setAssets(a);
      setStakes(st);
      setReadErr(null);
      // these use getProgramAccounts; a public RPC may refuse them
      const [ap, sc, bu] = await Promise.all([
        vaultApprovals(program, vault).catch(() => null),
        vaultSchedules(program, vault).catch(() => null),
        vaultBudgets(program, vault).catch(() => null),
      ]);
      if (ap) setApprovals(ap);
      if (sc) setSchedules(sc);
      if (bu) setBudgets(bu);
      if (!ap || !sc || !bu) setReadErr("Approvals, schedules or budgets could not be listed (the RPC may block getProgramAccounts).");
    } catch (e) {
      setReadErr(errMsg(e));
    }
  }, [program, connection, vault]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const c = state.config;
  const mySlot = signer.tree;
  const signerSlots = [0, 1, 2].filter((t) => c.trees[t].height > 0);
  const hasRecovery = c.trees[RECOVERY_TREE].height > 0;
  const recoveryAt = state.lastActive + Number(c.recoveryDelay);
  const left = keysLeft(state, mySlot);
  const total = 1 << c.trees[mySlot].height;
  const stakeTotal = stakes.reduce((s, x) => s + (x?.lamports ?? 0), 0);
  const tokenList = assets?.tokens.filter((t) => t.amount > 0n) ?? [];
  const windowSpent = now >= state.windowStart + 86400 ? 0n : state.windowSpent;

  return (
    <Panel lit={open}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-2 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="text-[13px] font-medium tracking-[0.12em]">{title ?? "VAULT"}</span>
          <a href={explorerUrl(vault.toBase58())} target="_blank" rel="noreferrer" className="truncate text-[12.5px] text-mute hover:text-teal">
            {short(vault.toBase58(), 8)}
          </a>
          <Copy value={vault.toBase58()} />
          <span className="rounded-full border border-teal/50 px-2 py-0.5 text-[10.5px] uppercase tracking-[0.12em] text-teal">you: {slotName(mySlot)}</span>
        </div>
        <button className="text-[10.5px] uppercase tracking-[0.14em] text-dim hover:text-teal" onClick={refresh}>
          [refresh]
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4 [&>*]:min-w-0">
        <Tile k="sol" v={assets ? sol(assets.lamports) : "…"} />
        <Tile k="tokens" v={assets ? String(tokenList.length) : "…"} />
        <Tile k="staked" v={stakes.length ? sol(stakeTotal) : "…"} />
        <Tile k={`your keys left`} v={`${left}/${total}`} warn={left < (mySlot === RECOVERY_TREE ? 4 : 20)} />
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-3 text-[12.5px]">
          <div>
            <Label>signers</Label>
            <div className="mt-1.5 text-mute">
              {signerSlots.map((t) => (t === mySlot ? `${slotName(t)} (you)` : slotName(t))).join(" · ")} — {c.threshold} of {signerSlots.length} must approve
            </div>
          </div>
          <div>
            <Label>destinations</Label>
            <div className="mt-1.5 text-mute">
              {c.whitelist.length ? `whitelist: ${c.whitelist.map((k) => short(new PublicKey(k).toBase58(), 4)).join(", ")}` : "no whitelist"}
              <span className="block text-[11.5px] text-dim">
                {c.whitelist.length || c.instantLimit > 0n
                  ? `others ${c.slowDelay === 0n ? "refused" : `wait ${duration(Number(c.slowDelay))}, cancellable`}${
                      c.instantLimit > 0n ? ` · up to ${sol(c.instantLimit)} SOL per 24 h instant (${sol(windowSpent)} used)` : ""
                    }`
                  : "every destination is immediate"}
              </span>
            </div>
          </div>
          {tokenList.length > 0 && (
            <div>
              <Label>tokens</Label>
              <ul className="mt-1.5 flex flex-col gap-1">
                {tokenList.map((t) => (
                  <li key={t.mint.toBase58()} className="flex justify-between gap-3">
                    <span className="text-mute">
                      <TokenName mint={t.mint} />
                    </span>
                    <span>{fromBaseUnits(t.amount, t.decimals)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {stakes.some(Boolean) && (
            <div>
              <Label>stake accounts</Label>
              <ul className="mt-1.5 flex flex-col gap-1">
                {stakes.filter(Boolean).map((s) => (
                  <li key={s!.seed} className="flex justify-between gap-3">
                    <a className="text-mute hover:text-teal" href={explorerUrl(s!.address.toBase58())} target="_blank" rel="noreferrer">
                      #{s!.seed} {short(s!.address.toBase58(), 4)}
                    </a>
                    <span>{sol(s!.lamports)} SOL</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 text-[12.5px]">
          <div>
            <Label>recovery</Label>
            {hasRecovery ? (
              <div className="mt-1.5 text-mute">
                Owner last active <span className="text-bone">{dateTime(state.lastActive)}</span>. Recovery can always cancel; full control{" "}
                {now >= recoveryAt ? <span className="text-warn">is open now</span> : <>opens in <span className="text-bone">{duration(recoveryAt - now)}</span></>}. A
                ping resets this.
              </div>
            ) : (
              <div className="mt-1.5 text-mute">No recovery key.</div>
            )}
          </div>
          <div>
            <Label>testament</Label>
            <div className="mt-1.5 text-mute">
              {c.heirs.length ? `${c.heirs.length} heir(s), after ${duration(Number(c.testamentDelay))} of inactivity` : "none"}
            </div>
          </div>
          <Pending vault={vault} state={state} onChanged={refresh} />
          {readErr && <Note kind="warn">{readErr}</Note>}
        </div>
      </div>

      <Approvals vault={vault} state={state} approvals={approvals} mySlot={mySlot} onChanged={refresh} onCosign={(a) => (setPreset(a), setOpen(true))} />
      <Migration vault={vault} state={state} assets={assets} onChanged={refresh} />
      <Schedules vault={vault} schedules={schedules} onChanged={refresh} />
      <Budgets vault={vault} budgets={budgets} onChanged={refresh} />
      <Testament vault={vault} state={state} assets={assets} stakes={stakes} onChanged={refresh} />
      <Inboxes vault={vault} onChanged={refresh} />

      <Section title={mySlot === RECOVERY_TREE ? "recovery actions" : "actions"}>
        {!open ? (
          <button className="btn self-start" onClick={() => setOpen(true)}>
            {mySlot === RECOVERY_TREE ? "recovery actions →" : "new action →"}
          </button>
        ) : (
          <ActionPanel
            key={preset ? "preset" : "form"}
            vault={vault}
            state={state}
            signer={signer}
            assets={assets}
            stakes={stakes}
            schedules={schedules}
            budgets={budgets}
            preset={preset}
            onPresetDone={() => setPreset(null)}
            onChanged={refresh}
          />
        )}
      </Section>
    </Panel>
  );
}

function Pending({ vault, state, onChanged }: { vault: PublicKey; state: VaultStateView; onChanged: () => void }) {
  const { program, connection } = useNox();
  const { run, busy, msg, payer } = useRunner(onChanged);
  const now = useNow();
  const p = state.pending;
  if (!p) return null;
  return (
    <div className="rounded-md border border-warn/50 bg-warn/[0.04] p-3">
      <Label className="!text-warn">pending {p.kind}</Label>
      <div className="mt-1.5">
        {p.kind === "migrate" ? (
          <>migrate to {short(p.dest.toBase58(), 5)}</>
        ) : (
          <>
            {isSol(p.mint) ? `${sol(p.amount, 9)} SOL` : <>{p.amount.toString()} <TokenName mint={p.mint} /></>} → {short(p.dest.toBase58(), 5)}
          </>
        )}
      </div>
      <div className="mt-1 text-[11.5px] text-mute">
        {now >= p.executableAt ? "Executable now by anyone." : `Executable in ${duration(p.executableAt - now)} (${dateTime(p.executableAt)}). Either tree can cancel it before then.`}
      </div>
      {now >= p.executableAt && (
        <button
          className="btn sm mt-2"
          disabled={!!busy}
          onClick={() =>
            run(
              "pending",
              async () => {
                const tp = p.kind === "withdraw" && !isSol(p.mint) ? await mintTokenProgram(connection, p.mint) : undefined;
                return [await executePendingIx(program, payer!, vault, state, tp)];
              },
              "Pending action executed."
            )
          }
        >
          {busy ? "sending…" : payer ? "execute" : "connect wallet to execute"}
        </button>
      )}
      <div className="mt-2">
        <RunMsg msg={msg} />
      </div>
    </div>
  );
}

function Tile({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="bg-ink-2 px-4 py-3">
      <Label>{k}</Label>
      <div className={`mt-1 truncate text-[18px] font-bold ${warn ? "text-warn" : ""}`}>{v}</div>
    </div>
  );
}

export function signerCount(state: VaultStateView) {
  return [0, 1, 2].filter((t) => state.config.trees[t].height > 0).length;
}
