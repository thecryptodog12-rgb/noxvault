"use client";
// One v2 vault: balances, config, recovery clock, pending withdrawal, and the action form.
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  TREE_PRIMARY,
  executePendingIx,
  fetchState,
  mintTokenProgram,
  vaultStakes,
  withRetry,
  type Signer,
  type VaultStateView,
} from "@nox/sdk/client";
import { Copy, Label, Note, Panel } from "@/components/ui";
import ActionPanel, { type StakeSlot } from "./ActionPanel";
import { useNox } from "@/lib/hooks";
import { errMsg, fromBaseUnits, short, sol } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import { isSol, sendIxs, vaultAssets, type VaultAssets } from "@/lib/unlock";
import { dateTime, duration, useNow } from "@/lib/time";

export function usedCount(map: Uint8Array): number {
  let n = 0;
  for (const b of map) for (let i = 0; i < 8; i++) if (b & (1 << i)) n++;
  return n;
}

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
  const { connection, program, wallet } = useNox();
  const { setVisible } = useWalletModal();
  const now = useNow();
  const [state, setState] = useState(initialState);
  const [assets, setAssets] = useState<VaultAssets | null>(null);
  const [stakes, setStakes] = useState<(StakeSlot | null)[]>([]);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [execMsg, setExecMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [execBusy, setExecBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, a, st] = await withRetry(() => Promise.all([fetchState(program, vault), vaultAssets(connection, vault), vaultStakes(program, vault)]));
      if (s) setState(s);
      setAssets(a);
      setStakes(st);
      setReadErr(null);
    } catch (e) {
      setReadErr(errMsg(e));
    }
  }, [program, connection, vault]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const c = state.config;
  const isRecovery = signer.tree !== TREE_PRIMARY;
  const hasRecovery = c.recoveryHeight > 0;
  const opensAt = state.lastActive + Number(c.recoveryDelay);
  const recoveryOpen = hasRecovery && now >= opensAt;
  const primaryUsed = usedCount(state.usedPrimary);
  const stakeTotal = stakes.reduce((s, x) => s + (x?.lamports ?? 0), 0);
  const p = state.pending;

  const execute = async () => {
    if (!p) return;
    if (!wallet.publicKey) {
      setVisible(true);
      return;
    }
    setExecBusy(true);
    setExecMsg(null);
    try {
      const tokenProgram = isSol(p.mint) ? undefined : await mintTokenProgram(connection, p.mint);
      const ix = await executePendingIx(program, wallet.publicKey, vault, state, tokenProgram);
      await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [ix]);
      setExecMsg({ kind: "ok", text: "Pending withdrawal executed." });
      refresh();
    } catch (e) {
      setExecMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setExecBusy(false);
    }
  };

  const tokenList = assets?.tokens.filter((t) => t.amount > 0n) ?? [];

  return (
    <Panel lit={open}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-2 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="text-[13px] font-medium tracking-[0.12em]">{title ?? "VAULT"}</span>
          <a href={explorerUrl(vault.toBase58())} target="_blank" rel="noreferrer" className="truncate text-[12.5px] text-mute hover:text-teal">
            {short(vault.toBase58(), 8)}
          </a>
          <Copy value={vault.toBase58()} />
        </div>
        <button className="text-[10.5px] uppercase tracking-[0.14em] text-dim hover:text-teal" onClick={refresh}>
          [refresh]
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4 [&>*]:min-w-0">
        <Tile k="sol" v={assets ? sol(assets.lamports) : "…"} />
        <Tile k="tokens" v={assets ? String(tokenList.length) : "…"} />
        <Tile k="staked" v={stakes.length ? sol(stakeTotal) : "…"} />
        <Tile k={isRecovery ? "recovery keys used" : "keys used"} v={isRecovery ? `${usedCount(state.usedRecovery)}/16` : `${primaryUsed}/256`} />
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-3 text-[12.5px]">
          {tokenList.length > 0 && (
            <div>
              <Label>token balances</Label>
              <ul className="mt-1.5 flex flex-col gap-1">
                {tokenList.map((t) => (
                  <li key={t.mint.toBase58()} className="flex justify-between gap-3">
                    <span className="text-mute">{short(t.mint.toBase58(), 5)}</span>
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
          <div>
            <Label>whitelist</Label>
            <div className="mt-1.5 text-mute">
              {c.whitelist.length === 0
                ? "none: any destination is immediate"
                : c.whitelist.map((k) => short(new PublicKey(k).toBase58(), 4)).join(" · ")}
            </div>
            {c.whitelist.length > 0 && (
              <div className="mt-1 text-[11.5px] text-dim">
                Other addresses: {c.slowDelay === 0n ? "refused (whitelist only)" : `wait ${duration(Number(c.slowDelay))}, cancellable`}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 text-[12.5px]">
          <div>
            <Label>recovery</Label>
            {hasRecovery ? (
              <div className="mt-1.5 flex flex-col gap-1 text-mute">
                <span>
                  Owner last active <span className="text-bone">{dateTime(state.lastActive)}</span>
                </span>
                <span>
                  Recovery can cancel any time; full control{" "}
                  {recoveryOpen ? (
                    <span className="text-warn">is open now</span>
                  ) : (
                    <>
                      opens in <span className="text-bone">{duration(opensAt - now)}</span> ({dateTime(opensAt)})
                    </>
                  )}
                  . A ping resets this.
                </span>
              </div>
            ) : (
              <div className="mt-1.5 text-mute">No recovery key: only the owner&apos;s phrase can act.</div>
            )}
          </div>
          {p && (
            <div className="rounded-md border border-warn/50 bg-warn/[0.04] p-3">
              <Label className="!text-warn">pending withdrawal</Label>
              <div className="mt-1.5">
                {isSol(p.mint) ? `${sol(p.amount, 9)} SOL` : `${p.amount.toString()} units of ${short(p.mint.toBase58(), 4)}`} →{" "}
                {short(p.dest.toBase58(), 5)}
              </div>
              <div className="mt-1 text-[11.5px] text-mute">
                {now >= p.executableAt ? "Executable now by anyone." : `Executable in ${duration(p.executableAt - now)} (${dateTime(p.executableAt)}). Either tree can cancel it before then.`}
              </div>
              {now >= p.executableAt && (
                <button className="btn sm mt-2" onClick={execute} disabled={execBusy}>
                  {execBusy ? "sending…" : wallet.publicKey ? "execute" : "connect wallet to execute"}
                </button>
              )}
              {execMsg && (
                <div className="mt-2">
                  <Note kind={execMsg.kind}>{execMsg.text}</Note>
                </div>
              )}
            </div>
          )}
          {readErr && <Note kind="warn">Could not refresh: {readErr}</Note>}
        </div>
      </div>

      <div className="border-t border-line-2 p-4 sm:p-5">
        {!open ? (
          <button className="btn" onClick={() => setOpen(true)}>
            {isRecovery ? "recovery actions →" : "actions →"}
          </button>
        ) : (
          <ActionPanel
            vault={vault}
            state={state}
            signer={signer}
            assets={assets}
            stakes={stakes}
            onChanged={refresh}
            allowed={isRecovery && !recoveryOpen ? ["cancel"] : undefined}
          />
        )}
      </div>
    </Panel>
  );
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-ink-2 px-4 py-3">
      <Label>{k}</Label>
      <div className="mt-1 truncate text-[18px] font-bold">{v}</div>
    </div>
  );
}
