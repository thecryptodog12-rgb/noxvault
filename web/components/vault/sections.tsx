"use client";
// Read-and-run sections of a vault view: open approvals, schedules, budgets (incl. spending with
// the session wallet), testament, migration and invoice addresses. Everything here is either
// read-only or a permissionless / session-key instruction; one-time keys are only used in ActionPanel.
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";
import {
  RECOVERY_TREE,
  SOL_MINT,
  budgetLeft,
  canExecute,
  executeIx,
  inboxPda,
  migrateIxs,
  mintTokenProgram,
  runScheduleIx,
  spendBudgetIx,
  sweepInboxIxs,
  testamentIxs,
  testamentOpensAt,
  testamentStakeIx,
  type ApprovalView,
  type BudgetView,
  type ScheduleView,
  type VaultStateView,
} from "@nox/sdk/client";
import type { Action } from "@nox/sdk/wots";
import { Copy, Label, Note } from "@/components/ui";
import TokenName from "./TokenName";
import type { StakeSlot } from "./ActionPanel";
import { useNox } from "@/lib/hooks";
import { useRunner } from "@/lib/run";
import { errMsg, fromBaseUnits, short, sol, toBaseUnits } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import { describeAction, isSol, vaultAssets, type VaultAssets } from "@/lib/unlock";
import { dateTime, duration, useNow } from "@/lib/time";

export function RunMsg({ msg }: { msg: { kind: "ok" | "bad"; text: string; sig?: string } | null }) {
  if (!msg) return null;
  return (
    <Note kind={msg.kind}>
      {msg.text}{" "}
      {msg.sig && (
        <a className="underline" href={explorerUrl(msg.sig, "tx")} target="_blank" rel="noreferrer">
          view tx
        </a>
      )}
    </Note>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-line px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <Label>{title}</Label>
        {right}
      </div>
      {children}
    </div>
  );
}

const slotsOf = (bits: number) => [0, 1, 2, 3].filter((t) => bits & (1 << t));
const slotName = (t: number) => (t === RECOVERY_TREE ? "recovery" : `signer ${t + 1}`);

// ---------- open approvals ----------

export function Approvals({
  vault,
  state,
  approvals,
  mySlot,
  onCosign,
  onChanged,
}: {
  vault: PublicKey;
  state: VaultStateView;
  approvals: ApprovalView[];
  mySlot: number;
  onCosign: (a: Action) => void;
  onChanged: () => void;
}) {
  const { program, connection } = useNox();
  const { run, busy, msg, payer } = useRunner(onChanged);
  const now = useNow(5000);
  if (!approvals.length) return null;
  return (
    <Section title={`open approvals (${approvals.length})`}>
      <ul className="flex flex-col gap-2">
        {approvals.map((a) => {
          const ready = canExecute(state, a.trees, a.action, now);
          const mine = !!(a.trees & (1 << mySlot));
          const id = a.address.toBase58();
          // v4.2: during a lockdown the recovery phrase co-signs anything the signers approved (the escape).
          const recoveryMayCosign =
            mySlot === RECOVERY_TREE &&
            (["cancel", "cancelSchedule", "cancelBudget", "cancelLock"].includes(a.action.kind) ||
              now >= state.lastActive + Number(state.config.recoveryDelay) ||
              now < state.lockdownUntil);
          const canCosign = !mine && (mySlot !== RECOVERY_TREE || recoveryMayCosign);
          return (
            <li key={id} className="rounded-md border border-line-2 px-3 py-2.5 text-[12.5px]">
              <div>{describeAction(a.action)}</div>
              <div className="mt-1 text-[11.5px] text-dim">
                approved by {slotsOf(a.trees).map(slotName).join(", ")} · needs {state.config.threshold} signer{state.config.threshold > 1 ? "s" : ""} · opened{" "}
                {dateTime(a.createdAt)}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {ready && (
                  <button
                    className="btn sm"
                    disabled={!!busy}
                    onClick={() =>
                      run(
                        id,
                        async () => {
                          const tp = a.action.kind === "withdraw" && !isSol(a.action.mint) ? await mintTokenProgram(connection, new PublicKey(a.action.mint)) : undefined;
                          return [await executeIx(program, payer!, vault, a.action, a.creator, { tokenProgram: tp })];
                        },
                        "Executed."
                      )
                    }
                  >
                    {busy === id ? "sending…" : "execute"}
                  </button>
                )}
                {canCosign && !ready && (
                  <button className="btn outline sm" onClick={() => onCosign(a.action)}>
                    approve this too
                  </button>
                )}
                {mine && !ready && <span className="text-[11.5px] text-teal">you approved this</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <RunMsg msg={msg} />
    </Section>
  );
}

// ---------- schedules ----------

export function Schedules({ vault, schedules, onChanged }: { vault: PublicKey; schedules: ScheduleView[]; onChanged: () => void }) {
  const { program, connection } = useNox();
  const { run, busy, msg, payer } = useRunner(onChanged);
  const now = useNow(5000);
  if (!schedules.length) return null;
  return (
    <Section title={`schedules (${schedules.length})`}>
      <ul className="flex flex-col gap-2 text-[12.5px]">
        {schedules.map((s) => {
          const due = s.remaining > 0 && now >= s.nextAt;
          const id = s.address.toBase58();
          return (
            <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-2 px-3 py-2">
              <span>
                #{s.id} · {isSol(s.mint) ? `${sol(s.amount, 9)} SOL` : <>{s.amount.toString()} <TokenName mint={s.mint} /></>} → {short(s.dest.toBase58(), 4)} every{" "}
                {duration(s.interval)} · {s.remaining} left
                <span className="block text-[11.5px] text-dim">
                  {s.remaining === 0 ? "finished" : due ? "a payment is due now" : `next ${dateTime(s.nextAt)} (in ${duration(s.nextAt - now)})`}
                </span>
              </span>
              {due && (
                <button
                  className="btn sm"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      id,
                      async () => {
                        const tp = s.mint.equals(SOL_MINT) ? undefined : await mintTokenProgram(connection, s.mint);
                        return [await runScheduleIx(program, payer!, vault, s, tp)];
                      },
                      "Payment sent."
                    )
                  }
                >
                  {busy === id ? "sending…" : "run due payment"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <RunMsg msg={msg} />
    </Section>
  );
}

// ---------- budgets + spend ----------

export function Budgets({ vault, budgets, onChanged }: { vault: PublicKey; budgets: BudgetView[]; onChanged: () => void }) {
  const { program, connection, wallet } = useNox();
  const { run, busy, msg } = useRunner(onChanged);
  const now = useNow(5000);
  const [spendDest, setSpendDest] = useState<Record<number, string>>({});
  const [spendAmt, setSpendAmt] = useState<Record<number, string>>({});
  const [decimals, setDecimals] = useState<Record<string, number>>({});
  useEffect(() => {
    for (const b of budgets)
      if (!b.mint.equals(SOL_MINT) && decimals[b.mint.toBase58()] === undefined)
        connection
          .getParsedAccountInfo(b.mint)
          .then((r) => {
            const d = (r.value?.data as { parsed?: { info?: { decimals?: number } } })?.parsed?.info?.decimals;
            if (typeof d === "number") setDecimals((x) => ({ ...x, [b.mint.toBase58()]: d }));
          })
          .catch(() => {});
  }, [budgets, connection, decimals]);
  if (!budgets.length) return null;
  return (
    <Section title={`budgets (${budgets.length})`}>
      <ul className="flex flex-col gap-2 text-[12.5px]">
        {budgets.map((b) => {
          const dec = b.mint.equals(SOL_MINT) ? 9 : decimals[b.mint.toBase58()];
          const fmt = (n: bigint) => (dec === undefined ? n.toString() : fromBaseUnits(n, dec));
          const left = budgetLeft(b, now);
          const mine = !!wallet.publicKey && b.session.equals(wallet.publicKey);
          const expired = now >= b.expires;
          const id = b.address.toBase58();
          return (
            <li key={id} className="rounded-md border border-line-2 px-3 py-2.5">
              <div>
                #{b.id} · session {short(b.session.toBase58(), 4)} {mine && <span className="text-teal">(this wallet)</span>} · {fmt(b.limit)}{" "}
                {b.mint.equals(SOL_MINT) ? "SOL" : <TokenName mint={b.mint} />} per {duration(b.period)}
              </div>
              <div className="mt-0.5 text-[11.5px] text-dim">
                {expired ? "expired" : `left this period: ${fmt(left)} · expires ${dateTime(b.expires)}`}
              </div>
              {mine && !expired && (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    className="field flex-1"
                    placeholder="pay to (unrestricted address)"
                    value={spendDest[b.id] ?? ""}
                    onChange={(e) => setSpendDest((x) => ({ ...x, [b.id]: e.target.value }))}
                    spellCheck={false}
                  />
                  <input
                    className="field sm:w-32"
                    placeholder="amount"
                    inputMode="decimal"
                    value={spendAmt[b.id] ?? ""}
                    onChange={(e) => setSpendAmt((x) => ({ ...x, [b.id]: e.target.value }))}
                  />
                  <button
                    className="btn sm"
                    disabled={!!busy || dec === undefined}
                    onClick={() =>
                      run(
                        id,
                        async () => {
                          const dest = new PublicKey((spendDest[b.id] ?? "").trim());
                          const amount = toBaseUnits(spendAmt[b.id] ?? "", dec!);
                          if (amount > left) throw new Error("More than is left in this period");
                          const tp = b.mint.equals(SOL_MINT) ? undefined : await mintTokenProgram(connection, b.mint);
                          return [await spendBudgetIx(program, vault, b, dest, amount, tp)];
                        },
                        "Spent from the budget (no one-time key used)."
                      )
                    }
                  >
                    {busy === id ? "sending…" : "spend"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!budgets.some((b) => wallet.publicKey && b.session.equals(wallet.publicKey)) && (
        <p className="text-[11.5px] text-dim">Connect a budget&apos;s session wallet to spend from it here.</p>
      )}
      <RunMsg msg={msg} />
    </Section>
  );
}

// ---------- testament ----------

export function Testament({
  vault,
  state,
  assets,
  stakes,
  onChanged,
}: {
  vault: PublicKey;
  state: VaultStateView;
  assets: VaultAssets | null;
  stakes: (StakeSlot | null)[];
  onChanged: () => void;
}) {
  const { program } = useNox();
  const { run, busy, msg, payer } = useRunner(onChanged);
  const now = useNow(10_000);
  const opens = testamentOpensAt(state);
  if (opens === null) return null;
  const open = now >= opens;
  const heirs = state.config.heirs;
  return (
    <Section title="testament">
      <div className="text-[12.5px] text-mute">
        {heirs.map((h) => `${short(new PublicKey(h.addr).toBase58(), 4)} ${h.bps / 100}%`).join(" · ")}
        <span className="block text-[11.5px] text-dim">
          {open ? "Open: anyone can distribute the vault to the heirs now." : `Opens after ${duration(Number(state.config.testamentDelay))} of owner inactivity: ${dateTime(opens)} (in ${duration(opens - now)}). A ping resets it.`}
        </span>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2">
          {stakes
            .filter((s): s is StakeSlot => !!s)
            .map((s) => (
              <span key={s.seed} className="flex gap-2">
                <button className="btn ghost sm" disabled={!!busy} onClick={() => run(`d${s.seed}`, async () => [await testamentStakeIx(program, vault, s.seed, false)], "Stake deactivating.")}>
                  deactivate stake #{s.seed}
                </button>
                <button className="btn ghost sm" disabled={!!busy} onClick={() => run(`c${s.seed}`, async () => [await testamentStakeIx(program, vault, s.seed, true)], "Stake collected.")}>
                  collect stake #{s.seed}
                </button>
              </span>
            ))}
          {assets?.tokens
            .filter((t) => t.amount > 0n)
            .map((t) => (
              <button
                key={t.mint.toBase58()}
                className="btn ghost sm"
                disabled={!!busy}
                onClick={() => run(t.mint.toBase58(), () => testamentIxs(program, payer!, vault, state, { mint: t.mint, tokenProgram: t.program }), "Token distributed.")}
              >
                distribute <TokenName mint={t.mint} />
              </button>
            ))}
          <button className="btn sm" disabled={!!busy} onClick={() => run("sol", () => testamentIxs(program, payer!, vault, state), "SOL distributed to the heirs.")}>
            {busy === "sol" ? "sending…" : "distribute SOL"}
          </button>
        </div>
      )}
      {open && <p className="text-[11.5px] text-dim">Stakes first: deactivate, wait an epoch, collect. Then tokens, then SOL last.</p>}
      <RunMsg msg={msg} />
    </Section>
  );
}

// ---------- migration ----------

export function Migration({ vault, state, assets, onChanged }: { vault: PublicKey; state: VaultStateView; assets: VaultAssets | null; onChanged: () => void }) {
  const { program } = useNox();
  const { run, busy, msg, payer } = useRunner(onChanged);
  const now = useNow(5000);
  const pendingMigrate = state.pending?.kind === "migrate" ? state.pending : null;
  if (!state.migrateTo && !pendingMigrate) return null;
  return (
    <Section title="migration">
      {pendingMigrate && !state.migrateTo && (
        <div className="text-[12.5px] text-warn">
          Migration to {short(pendingMigrate.dest.toBase58(), 5)} is pending:{" "}
          {now >= pendingMigrate.executableAt ? "executable now (see pending above)." : `in ${duration(pendingMigrate.executableAt - now)}; either tree can cancel it.`}
        </div>
      )}
      {state.migrateTo && (
        <>
          <div className="text-[12.5px] text-mute">
            This vault moves to{" "}
            <a className="text-bone hover:text-teal" href={`/vaults?q=${state.migrateTo.toBase58()}`}>
              {short(state.migrateTo.toBase58(), 6)}
            </a>
            . Anyone can move everything across.
          </div>
          <button
            className="btn sm self-start"
            disabled={!!busy}
            onClick={() =>
              run(
                "migrate",
                async () => {
                  const tokens = (assets?.tokens ?? []).filter((t) => t.amount > 0n).map((t) => ({ mint: t.mint, tokenProgram: t.program }));
                  return migrateIxs(program, payer!, vault, state, tokens);
                },
                "Moved to the new vault."
              )
            }
          >
            {busy ? "sending…" : "move everything now"}
          </button>
        </>
      )}
      <RunMsg msg={msg} />
    </Section>
  );
}

// ---------- invoice addresses ----------

interface Inbox {
  name: string;
  id: number;
}

const inboxKey = (vault: string) => `nox3.inboxes.${vault}`;

export function Inboxes({ vault, onChanged }: { vault: PublicKey; onChanged: () => void }) {
  const { program, connection } = useNox();
  const { run, busy, msg, payer } = useRunner(onChanged);
  const vaultStr = vault.toBase58();
  const [list, setList] = useState<Inbox[]>([]);
  const [name, setName] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [bal, setBal] = useState<Record<number, VaultAssets | null>>({});
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      setList(JSON.parse(localStorage.getItem(inboxKey(vaultStr)) || "[]"));
    } catch {
      setList([]);
    }
  }, [vaultStr]);
  const save = (l: Inbox[]) => {
    setList(l);
    try {
      localStorage.setItem(inboxKey(vaultStr), JSON.stringify(l));
    } catch {}
  };

  useEffect(() => {
    if (open === null) return setQr(null);
    const addr = inboxPda(vault, open, program.programId).toBase58();
    QRCode.toString(`solana:${addr}`, { type: "svg", margin: 1, color: { dark: "#e6f0ef", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(null));
    vaultAssets(connection, inboxPda(vault, open, program.programId))
      .then((a) => setBal((b) => ({ ...b, [open]: a })))
      .catch((e) => setErr(errMsg(e)));
  }, [open, vault, program, connection]);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    const id = list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    save([...list, { name: n.slice(0, 40), id }]);
    setName("");
    setOpen(id);
  };

  return (
    <Section title="invoice addresses">
      <p className="text-[11.5px] text-dim">
        One deposit address per payer (e.g. &quot;client A&quot;), so you see who paid without sharing the vault address. Anyone can sweep it into
        the vault. Names are kept only in this browser; the address is derived from the vault and a number.
      </p>
      <div className="flex gap-2">
        <input className="field flex-1" placeholder="name, e.g. client A" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn ghost sm" onClick={add} disabled={!name.trim()}>
          add
        </button>
      </div>
      {list.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-[12.5px]">
          {list.map((x) => {
            const addr = inboxPda(vault, x.id, program.programId);
            const b = bal[x.id];
            return (
              <li key={x.id} className="rounded-md border border-line-2 px-3 py-2">
                <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === x.id ? null : x.id)}>
                  <span>
                    {x.name} <span className="text-dim">#{x.id}</span>
                  </span>
                  <span className="text-mute">{short(addr.toBase58(), 4)}</span>
                </button>
                {open === x.id && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_120px] [&>*]:min-w-0">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 break-all">
                        {addr.toBase58()} <Copy value={addr.toBase58()} />
                      </div>
                      <div className="text-[11.5px] text-mute">
                        {b ? `${sol(b.lamports)} SOL${b.tokens.filter((t) => t.amount > 0n).length ? ` + ${b.tokens.filter((t) => t.amount > 0n).length} token(s)` : ""}` : "…"}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="btn sm"
                          disabled={!!busy || !b || (b.lamports === 0 && !b.tokens.some((t) => t.amount > 0n))}
                          onClick={() =>
                            run(
                              `inbox${x.id}`,
                              () => sweepInboxIxs(program, payer!, vault, x.id, (b?.tokens ?? []).filter((t) => t.amount > 0n).map((t) => ({ mint: t.mint, tokenProgram: t.program }))),
                              "Swept into the vault."
                            )
                          }
                        >
                          {busy === `inbox${x.id}` ? "sending…" : "sweep into vault"}
                        </button>
                        <button className="text-[11px] uppercase tracking-[0.14em] text-dim hover:text-bad" onClick={() => save(list.filter((y) => y.id !== x.id))}>
                          [forget name]
                        </button>
                      </div>
                    </div>
                    {qr && <div className="mx-auto w-[120px] rounded-md border border-line-2 bg-ink p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {err && <Note kind="warn">{err}</Note>}
      <RunMsg msg={msg} />
    </Section>
  );
}
