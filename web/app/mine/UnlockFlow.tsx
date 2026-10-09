"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  SOL_MINT,
  findSignedMessages,
  planUnlock,
  preflightUnlock,
  unlockPda,
  vaultKey,
  type SignedMessage,
} from "@nox/sdk/client";
import { messageDigest } from "@nox/sdk/wots";
import { Label, Note, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { errMsg, fromBaseUnits, hex, short, sol, toBaseUnits } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import {
  cancelUnlockIx,
  clearFinished,
  clearPending,
  decodeUnlock,
  isSol,
  isSpent,
  loadPending,
  markAttempted,
  mintTokenProgram,
  savePending,
  sendIxs,
  sendSteps,
  sweepIx,
  sweepTokenIx,
  vaultAssets,
  wasAttempted,
  type PendingUnlock,
  type SendStep,
  type VaultAssets,
} from "@/lib/unlock";
import type { VaultRow } from "./MyVaults";

type StepState = "todo" | "sending" | "done" | "failed";
type History =
  | { kind: "loading" }
  | { kind: "error"; msg: string }
  | { kind: "none" }
  | { kind: "one"; m: SignedMessage }
  | { kind: "many"; ms: SignedMessage[] };

const fmtAmount = (m: { mint: PublicKey; amount: bigint }) =>
  isSol(m.mint) ? `${sol(m.amount, 9)} SOL` : `${m.amount.toString()} base units of ${short(m.mint.toBase58(), 4)}`;

export default function UnlockFlow({
  master,
  row,
  nextFresh,
  onDone,
  onClose,
}: {
  master: Uint8Array;
  row: VaultRow;
  nextFresh: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const { connection, program, wallet, deployed } = useNox();
  const { setVisible } = useWalletModal();
  const vault = row.vault;
  const vaultStr = vault.toBase58();
  const key = useMemo(() => vaultKey(master, row.index, program.programId), [master, row.index, program]);
  const freshNext = useMemo(() => vaultKey(master, nextFresh, program.programId).vault, [master, nextFresh, program]);

  // what this key has already signed, read from the vault's whole history
  const [history, setHistory] = useState<History>({ kind: "loading" });
  const [pending, setPending] = useState<PendingUnlock | null>(null);
  const [lockSource, setLockSource] = useState<"local" | "chain" | null>(null);
  const [chainNote, setChainNote] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(true);

  // form
  const tokens = row.assets?.tokens.filter((t) => t.amount > 0n) ?? [];
  const [asset, setAsset] = useState<string>(SOL_MINT.toBase58());
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [pre, setPre] = useState<{ errors: string[]; warnings: string[]; key: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [checkingPre, setCheckingPre] = useState(false);
  useEffect(() => {
    setPre(null);
    setConsent(false);
  }, [asset, amount, dest]);
  const [rentMin, setRentMin] = useState(890_880);

  // plan / progress
  const [plan, setPlan] = useState<SendStep[] | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [sigs, setSigs] = useState<(string | null)[]>([]);
  const [stepErr, setStepErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [left, setLeft] = useState<VaultAssets | null>(null);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!dest && wallet.publicKey) setDest(wallet.publicKey.toBase58());
  }, [wallet.publicKey, dest]);

  useEffect(() => {
    connection.getMinimumBalanceForRentExemption(0).then(setRentMin).catch(() => {});
  }, [connection]);

  const pendingFrom = useCallback(
    (m: SignedMessage, createdAt = Date.now()): PendingUnlock => ({
      v: 1,
      vault: vaultStr,
      index: row.index,
      mint: m.mint.toBase58(),
      dest: m.dest.toBase58(),
      next: m.next.toBase58(),
      amount: m.amount.toString(),
      digest: hex(m.digest),
      createdAt,
      done: [],
    }),
    [vaultStr, row.index]
  );

  // ---- source of truth: every message this key ever published signature values for ----
  const loadHistory = useCallback(async () => {
    setHistory({ kind: "loading" });
    setChainNote(null);
    setAttempted(wasAttempted(vaultStr));
    const local = loadPending(vaultStr);
    let signed: SignedMessage[];
    try {
      signed = await findSignedMessages(program, key);
    } catch (e) {
      setHistory({ kind: "error", msg: errMsg(e) });
      setPending(null);
      return;
    }
    if (signed.length > 1) {
      setHistory({ kind: "many", ms: signed });
      setPending(null);
      return;
    }
    if (signed.length === 1) {
      const p = pendingFrom(signed[0], local?.createdAt);
      if (local && local.digest !== p.digest)
        setChainNote(
          "This browser remembered a different withdrawal, but the chain shows the key already published part of a signature for the one below. Only that one can ever be completed."
        );
      savePending(p);
      setPending(p);
      setLockSource("chain");
      setHistory({ kind: "one", m: signed[0] });
      return;
    }
    setHistory({ kind: "none" });
    if (local) {
      setPending(local);
      setLockSource("local");
    } else {
      setPending(null);
      setLockSource(null);
    }
  }, [program, key, vaultStr, pendingFrom]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const holding = isSol(asset) ? null : tokens.find((t) => t.mint.toBase58() === asset) ?? null;
  const decimals = holding ? holding.decimals : 9;
  const max = holding ? holding.amount : BigInt(row.lamports);

  // ---- build the plan for the frozen message ----
  const buildPlan = useCallback(
    async (p: PendingUnlock): Promise<{ list: SendStep[]; st: StepState[] } | null> => {
      if (!wallet.publicKey) return null;
      setStepErr(null);
      const payer = wallet.publicKey;
      const mint = isSol(p.mint) ? undefined : new PublicKey(p.mint);
      const tokenProgram = mint ? await mintTokenProgram(connection, mint) : undefined; // from chain, not storage
      const pl = await planUnlock({
        program,
        payer,
        key,
        next: new PublicKey(p.next),
        dest: new PublicKey(p.dest),
        amount: BigInt(p.amount),
        mint,
        tokenProgram,
      });
      if (hex(pl.digest) !== p.digest) throw new Error("Plan digest does not match the frozen message. Refusing to sign.");
      const unlock = unlockPda(vault, payer, program.programId);
      const [bufInfo, spent, cancel] = await Promise.all([
        connection.getAccountInfo(unlock, "confirmed"),
        isSpent(connection, program.programId, vault),
        cancelUnlockIx(program, payer, vault),
      ]);
      const buf = bufInfo ? decodeUnlock(unlock, bufInfo.data) : null;
      const list = sendSteps(pl, buf, spent, p, key.pkSeed, cancel);
      const st: StepState[] = list.map((r) => (r.ixs ? "todo" : "done"));
      setPlan(list);
      setSteps(st);
      setSigs((old) => (old.length === st.length ? old : list.map(() => null)));
      if (spent) markFinished();
      return { list, st };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet.publicKey, program, key, connection, vault]
  );

  useEffect(() => {
    if (pending && wallet.publicKey) buildPlan(pending).catch((e) => setStepErr(errMsg(e)));
  }, [pending, wallet.publicKey, buildPlan]);

  const markFinished = async () => {
    setFinished(true);
    clearFinished(vaultStr);
    try {
      setLeft(await vaultAssets(connection, vault));
    } catch {}
  };

  // ---- freeze a new message ----
  const prepare = async () => {
    setFormErr(null);
    try {
      if (!wallet.publicKey) throw new Error("Connect a wallet first: it pays the fees");
      const units = toBaseUnits(amount, decimals);
      if (units <= 0n) throw new Error("Amount must be above zero");
      if (units > max) throw new Error("More than the vault holds");
      let destPk: PublicKey;
      try {
        destPk = new PublicKey(dest.trim());
      } catch {
        throw new Error("Destination is not a valid address");
      }
      if (destPk.equals(vault)) throw new Error("Destination cannot be the vault itself");
      const mint = isSol(asset) ? SOL_MINT : new PublicKey(asset);
      const tokenProgram = isSol(asset) ? undefined : await mintTokenProgram(connection, mint);
      const digest = messageDigest({
        programId: program.programId.toBytes(),
        vault: vault.toBytes(),
        mint: mint.toBytes(),
        dest: destPk.toBytes(),
        nextVault: freshNext.toBytes(),
        amount: units,
      });
      // Preflight BEFORE signing: a one-time key gets one message, so it must be payable
      // and must not conflict with anything this key already published.
      const preKey = [mint.toBase58(), destPk.toBase58(), freshNext.toBase58(), units.toString()].join("|");
      setCheckingPre(true);
      let res: { errors: string[]; warnings: string[] };
      try {
        res = await preflightUnlock({
          program,
          payer: wallet.publicKey,
          key,
          next: freshNext,
          dest: destPk,
          amount: units,
          mint: isSol(asset) ? undefined : mint,
          tokenProgram,
        });
        // Re-read the history right before freezing (it may have changed since the page loaded).
        const signed = await findSignedMessages(program, key);
        if (signed.length > 1) res.errors.push("This vault's key already signed two different messages.");
        else if (signed.length === 1 && hex(signed[0].digest) !== hex(digest))
          res.errors.push(`This key already signed a different withdrawal (${fmtAmount(signed[0])} to ${short(signed[0].dest.toBase58(), 4)}). Only that one can be completed.`);
      } catch (e) {
        res = { errors: [`Could not read this vault's history, so it is not safe to sign (${errMsg(e)}).`], warnings: [] };
      } finally {
        setCheckingPre(false);
      }
      const sameAsShown = pre?.key === preKey;
      setPre({ ...res, key: preKey });
      if (!sameAsShown) setConsent(false);
      if (res.errors.length) {
        if (res.errors.some((e) => /already signed/.test(e))) loadHistory();
        return;
      }
      if (res.warnings.length && !(sameAsShown && consent)) return;
      const p: PendingUnlock = {
        v: 1,
        vault: vaultStr,
        index: row.index,
        mint: mint.toBase58(),
        dest: destPk.toBase58(),
        next: freshNext.toBase58(),
        amount: units.toString(),
        digest: hex(digest),
        createdAt: Date.now(),
        done: [],
      };
      savePending(p); // persisted BEFORE anything is signed or sent
      setPending(p);
      setLockSource("local");
    } catch (e) {
      setFormErr(errMsg(e));
    }
  };

  const discard = async () => {
    if (lockSource !== "local" || wasAttempted(vaultStr)) return;
    let signed: SignedMessage[];
    try {
      signed = await findSignedMessages(program, key);
    } catch (e) {
      setChainNote(`Cannot discard: the vault's history could not be read (${errMsg(e)}).`);
      return;
    }
    if (signed.length) {
      setChainNote("Cannot discard: the chain shows this key already published part of a signature.");
      loadHistory();
      return;
    }
    if (!window.confirm("Discard this withdrawal? Nothing was sent for it, so you can choose a different one.")) return;
    clearPending(vaultStr);
    setPending(null);
    setPlan(null);
    setSteps([]);
    setLockSource(null);
  };

  // ---- send the steps ----
  const run = async (fresh?: { list: SendStep[]; st: StepState[] }) => {
    const list = fresh?.list ?? plan;
    if (!list || !wallet.publicKey || !pending) return;
    if (finished) return;
    setRunning(true);
    setStepErr(null);
    const payer = wallet.publicKey;
    const st = [...(fresh?.st ?? steps)];
    for (let i = 0; i < list.length; i++) {
      const ixs = list[i].ixs;
      if (st[i] === "done" || !ixs) continue;
      st[i] = "sending";
      setSteps([...st]);
      markAttempted(vaultStr); // before anything can reach the network
      setAttempted(true);
      try {
        const sig = await sendIxs(connection, payer, wallet.sendTransaction, ixs);
        st[i] = "done";
        setSteps([...st]);
        setSigs((s) => s.map((v, k) => (k === i ? sig : v)));
      } catch (e) {
        st[i] = "failed";
        setSteps([...st]);
        setStepErr(errMsg(e));
        setRunning(false);
        return;
      }
    }
    setRunning(false);
    await markFinished();
    onDone();
  };

  // re-read the chain, then continue (a "failed" step may actually have landed)
  const retry = async () => {
    if (!pending) return;
    try {
      const fresh = await buildPlan(pending);
      if (fresh && !fresh.st.every((x) => x === "done")) await run(fresh);
    } catch (e) {
      setStepErr(errMsg(e));
    }
  };

  const sweepLeft = async (mint?: PublicKey, tokenProgram?: PublicKey) => {
    if (!wallet.publicKey || !pending) return;
    setSweepMsg(null);
    try {
      const succ = new PublicKey(pending.next);
      const ix = mint
        ? await sweepTokenIx(program, wallet.publicKey, vault, succ, mint, tokenProgram!)
        : await sweepIx(program, vault, succ);
      await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [ix]);
      setLeft(await vaultAssets(connection, vault));
      setSweepMsg("Swept to the next vault.");
      onDone();
    } catch (e) {
      setSweepMsg(errMsg(e));
    }
  };

  const p = pending;
  const pDecimals = p && !isSol(p.mint) ? row.assets?.tokens.find((t) => t.mint.toBase58() === p.mint)?.decimals ?? 0 : 9;
  const doneCount = steps.filter((s) => s === "done").length;

  return (
    <Panel
      lit
      title={`unlock // vault #${row.index}`}
      right={
        <button className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-bone" onClick={onClose}>
          [close]
        </button>
      }
    >
      <div className="grid [&>*]:min-w-0 gap-0 lg:grid-cols-2">
        {/* left: message */}
        <div className="flex flex-col gap-4 border-b border-line p-4 sm:p-5 lg:border-b-0 lg:border-r">
          {history.kind === "loading" ? (
            <div className="text-[13px] text-mute">
              reading this vault&apos;s full history<span className="blink">…</span>
            </div>
          ) : history.kind === "error" ? (
            <div className="flex flex-col items-start gap-3">
              <Note kind="bad">
                Could not read this vault&apos;s transaction history ({history.msg}). Signing is blocked: without the history the app
                cannot prove this key never signed something else.
              </Note>
              <button className="btn ghost sm" onClick={loadHistory}>
                try again
              </button>
            </div>
          ) : history.kind === "many" ? (
            <div className="flex flex-col gap-3">
              <Note kind="bad">
                <strong>This key already signed two different messages.</strong> Its one-time security is weakened, so this app will
                not sign anything more with it.
              </Note>
              <ul className="flex flex-col gap-1 text-[12px] text-mute">
                {history.ms.map((m) => (
                  <li key={hex(m.digest)}>
                    • {fmtAmount(m)} → {short(m.dest.toBase58(), 4)} ({m.chains.length}/34 chains published)
                  </li>
                ))}
              </ul>
            </div>
          ) : p ? (
            <>
              <div className="flex items-center justify-between">
                <Label>signed message (frozen)</Label>
                <span className="text-[10px] uppercase tracking-[0.18em] text-teal">
                  {lockSource === "chain" ? "from chain" : "from this browser"}
                </span>
              </div>
              <dl className="grid [&>*]:min-w-0 grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[12.5px]">
                <dt className="text-dim">asset</dt>
                <dd>{isSol(p.mint) ? "SOL" : short(p.mint, 6)}</dd>
                <dt className="text-dim">amount</dt>
                <dd>
                  {fromBaseUnits(BigInt(p.amount), pDecimals)} {isSol(p.mint) ? "SOL" : ""}
                </dd>
                <dt className="text-dim">to</dt>
                <dd className="break-all">{p.dest}</dd>
                <dt className="text-dim">rest →</dt>
                <dd className="break-all">
                  {p.next} <span className="text-dim">(next fresh vault)</span>
                </dd>
                <dt className="text-dim">digest</dt>
                <dd className="break-all text-dim">{p.digest}</dd>
              </dl>
              {chainNote && <Note kind="warn">{chainNote}</Note>}
              <Note>
                This message is locked. A WOTS+ key may sign <strong>one</strong> message, ever: two different messages together
                reveal enough to forge a third. Before signing, the app reads the vault&apos;s whole history; if this key ever
                published part of a signature, only that same withdrawal can be completed. Re-signing it is harmless (signing is
                deterministic).
              </Note>
              {lockSource === "local" && !attempted && !finished && (
                <button className="self-start text-[11px] uppercase tracking-[0.18em] text-dim hover:text-bad" onClick={discard}>
                  [discard — only if nothing was sent]
                </button>
              )}
            </>
          ) : (
            <>
              {chainNote && <Note kind="warn">{chainNote}</Note>}
              <label className="flex flex-col gap-1.5">
                <Label>asset</Label>
                <select
                  className="field"
                  value={asset}
                  onChange={(e) => {
                    setAsset(e.target.value);
                    setAmount("");
                  }}
                >
                  <option value={SOL_MINT.toBase58()}>SOL — {sol(row.lamports)} available</option>
                  {tokens.map((t) => (
                    <option key={t.mint.toBase58()} value={t.mint.toBase58()}>
                      {short(t.mint.toBase58(), 4)} — {fromBaseUnits(t.amount, t.decimals)} available
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <Label>amount</Label>
                <div className="flex gap-2">
                  <input
                    className="field flex-1"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <button className="btn ghost sm" type="button" onClick={() => setAmount(fromBaseUnits(max, decimals).replace(/,/g, ""))}>
                    max
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-1.5">
                <Label>destination {holding ? "(token owner; its account is created if needed)" : "wallet"}</Label>
                <input className="field" value={dest} onChange={(e) => setDest(e.target.value)} spellCheck={false} placeholder="wallet address" />
              </label>
              <div className="text-[11.5px] text-dim">
                Everything not withdrawn moves to vault #{nextFresh} <span className="text-mute">{short(freshNext.toBase58(), 5)}</span>.
                {isSol(asset) && (
                  <> If the SOL left over is below the rent minimum ({sol(rentMin, 6)}), it is added to your payout instead.</>
                )}
                {holding && row.lamports > 0 && <> The vault&apos;s SOL stays behind; sweep it after the unlock.</>}
              </div>
              {formErr && <div className="text-[12px] text-bad">✕ {formErr}</div>}
              {pre && pre.errors.length > 0 && (
                <Note kind="bad">
                  Cannot sign this withdrawal; it could never be paid out:
                  <ul className="mt-1 list-inside list-disc">
                    {pre.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </Note>
              )}
              {pre && pre.errors.length === 0 && pre.warnings.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Note kind="warn">
                    Check before signing (the key can sign only this one message):
                    <ul className="mt-1 list-inside list-disc">
                      {pre.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Note>
                  <label className="flex cursor-pointer items-start gap-2 text-[12px] text-mute">
                    <input type="checkbox" className="mt-1 accent-[#2ee6d6]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    I understand these warnings and want to sign this exact message.
                  </label>
                </div>
              )}
              {!wallet.publicKey ? (
                <button className="btn self-start" onClick={() => setVisible(true)}>
                  connect wallet to pay fees
                </button>
              ) : (
                <button
                  className="btn self-start"
                  onClick={prepare}
                  disabled={!amount || deployed === false || checkingPre || (!!pre?.warnings.length && !pre.errors.length && !consent)}
                >
                  {checkingPre ? "checking…" : "check & freeze message →"}
                </button>
              )}
            </>
          )}
        </div>

        {/* right: steps */}
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <Label>transactions</Label>
            {plan && (
              <span className="text-[11px] text-dim">
                {doneCount}/{plan.length}
              </span>
            )}
          </div>
          {!p || history.kind === "many" || history.kind === "error" ? (
            <p className="text-[12.5px] text-dim">
              Freeze a message to see the plan. A normal unlock is about two transactions: open the buffer and write the 1,088-byte
              signature, then verify the 34 chains on-chain, check the root and pay out. Your wallet approves each one.
            </p>
          ) : !wallet.publicKey ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[12.5px] text-mute">Connect a wallet to pay the fees and continue.</p>
              <button className="btn" onClick={() => setVisible(true)}>
                connect wallet
              </button>
            </div>
          ) : !plan ? (
            <div className="text-[12.5px] text-mute">
              signing in the browser<span className="blink">…</span>
            </div>
          ) : (
            <>
              <ol className="flex flex-col">
                {plan.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 border-b border-dashed border-line py-2.5 text-[12.5px] last:border-b-0">
                    <StepDot s={steps[i]} />
                    <span className="w-5 text-[10px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                    <span className={steps[i] === "done" ? "text-mute" : steps[i] === "failed" ? "text-bad" : ""}>{t.label}</span>
                    {sigs[i] && (
                      <a className="ml-auto text-[10px] text-dim hover:text-teal" href={explorerUrl(sigs[i]!, "tx")} target="_blank" rel="noreferrer">
                        tx ↗
                      </a>
                    )}
                  </li>
                ))}
              </ol>
              {stepErr && <Note kind="bad">{stepErr}</Note>}
              {finished ? (
                <Note kind="ok">Unlocked. Vault #{row.index} is spent; its key will never sign again.</Note>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <button className="btn" onClick={() => run()} disabled={running}>
                    {running ? "sending…" : doneCount > 0 ? "continue" : "start unlock"}
                  </button>
                  {stepErr && !running && (
                    <button className="btn ghost" onClick={retry}>
                      retry failed step
                    </button>
                  )}
                </div>
              )}
              {finished && left && (left.lamports > 0 || left.tokens.some((t) => t.amount > 0n)) && (
                <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3">
                  <Label>still in the old vault</Label>
                  <div className="flex flex-wrap gap-2">
                    {left.lamports > 0 && (
                      <button className="btn ghost sm" onClick={() => sweepLeft()}>
                        sweep {sol(left.lamports)} SOL
                      </button>
                    )}
                    {left.tokens
                      .filter((t) => t.amount > 0n)
                      .map((t) => (
                        <button key={t.mint.toBase58()} className="btn ghost sm" onClick={() => sweepLeft(t.mint, t.program)}>
                          sweep_token {short(t.mint.toBase58(), 3)}
                        </button>
                      ))}
                  </div>
                  {sweepMsg && <div className="text-[12px] text-mute">{sweepMsg}</div>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function StepDot({ s }: { s: StepState }) {
  const c = s === "done" ? "bg-teal" : s === "sending" ? "bg-warn animate-pulse" : s === "failed" ? "bg-bad" : "border border-line-2";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 ${c}`} />;
}
