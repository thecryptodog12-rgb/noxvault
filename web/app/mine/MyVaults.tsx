"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { scanVaults, type VaultState } from "@nox/sdk/client";
import { Copy, Empty, Label, Note, PageHead, Panel, Status } from "@/components/ui";
import SecretInput from "@/components/SecretInput";
import { useNox } from "@/lib/hooks";
import { errMsg, fromBaseUnits, short, sol } from "@/lib/format";
import { explorerUrl, NETWORK } from "@/lib/config";
import { forgetWords } from "@/lib/secret";
import { loadPending, sendIxs, sweepIx, sweepTokenIx, vaultAssets, type VaultAssets } from "@/lib/unlock";
import UnlockFlow from "./UnlockFlow";

export interface VaultRow extends VaultState {
  assets: VaultAssets | null;
  pending: boolean;
}

export default function MyVaults() {
  const { connection, program, deployed } = useNox();
  const [master, setMaster] = useState<Uint8Array | null>(null);
  const [rows, setRows] = useState<VaultRow[] | null>(null);
  const [nextFresh, setNextFresh] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const scan = useCallback(
    async (m: Uint8Array) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await scanVaults(program, m);
        const withAssets = await Promise.all(
          r.vaults.map(async (v) => ({
            ...v,
            assets: await vaultAssets(connection, v.vault).catch(() => null),
            pending: !!loadPending(v.vault.toBase58()),
          }))
        );
        setRows(withAssets);
        setNextFresh(r.nextFresh);
      } catch (e) {
        setErr(errMsg(e));
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [program, connection]
  );

  useEffect(() => {
    if (master) scan(master);
  }, [master, scan]);

  const sel = rows?.find((r) => r.index === selected) ?? null;
  const totalSol = rows?.reduce((s, r) => s + (r.spent ? 0 : r.lamports), 0) ?? 0;

  return (
    <div>
      <PageHead
        kicker="02 // my vaults"
        title={
          <>
            My <span className="inv">vaults</span>
          </>
        }
        sub="Your words find your vaults by themselves: the browser derives vault #0, #1, #2… and asks the chain which ones hold funds or were already used."
      />

      {!master ? (
        <div className="grid [&>*]:min-w-0 gap-6 xl:grid-cols-[1.25fr_1fr]">
          <Panel title="enter your 24 words">
            <div className="p-4 sm:p-5">
              <SecretInput cta="scan my vaults" onSecret={(m) => setMaster(m)} />
            </div>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel title="how the scan works" className="text-[12.5px]">
              <p className="p-4 text-mute">
                For each index the browser builds the 34 chains (8,670 SHA-256 calls), hashes the ends into a root and derives the
                vault address. It stops after three empty, never-used vaults in a row. Only the public addresses are queried on
                the RPC.
              </p>
            </Panel>
            <Note>
              No words yet? <Link href="/create" className="underline">Create a vault</Link> first.
            </Note>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid [&>*]:min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
            <Tile k="vaults found" v={rows ? String(rows.length) : "…"} />
            <Tile k="sealed sol" v={rows ? sol(totalSol) : "…"} />
            <Tile k="spent keys" v={rows ? String(rows.filter((r) => r.spent).length) : "…"} />
            <Tile k="next fresh" v={`#${nextFresh}`} />
          </div>

          {deployed === false && (
            <Note kind="warn">
              The Noxvault program is not deployed on {NETWORK} yet, so nothing can be unlocked. Balances below are still read from
              the chain.
            </Note>
          )}

          <Panel
            title={`vaults // index 0 → ${Math.max(nextFresh - 1, 0)}`}
            right={
              <div className="flex items-center gap-4">
                <button
                  className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-teal disabled:opacity-40"
                  disabled={loading}
                  onClick={() => master && scan(master)}
                >
                  [{loading ? "scanning" : "rescan"}]
                </button>
                <button
                  className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-bad"
                  onClick={() => {
                    forgetWords();
                    setMaster(null);
                    setRows(null);
                    setSelected(null);
                  }}
                >
                  [lock & forget]
                </button>
              </div>
            }
          >
            {err && (
              <div className="p-4">
                <Note kind="bad">Could not read the chain: {err}</Note>
              </div>
            )}
            {loading && !rows ? (
              <Empty title="scanning…">Deriving keys and checking the chain.</Empty>
            ) : rows && rows.length === 0 ? (
              <Empty title="no vaults yet">
                These words have no funded or used vaults on {NETWORK}. Your next fresh vault is #{nextFresh}.{" "}
                <Link href="/create" className="underline">
                  Fund it
                </Link>
                .
              </Empty>
            ) : (
              <ul className="divide-y divide-dashed divide-line">
                {rows?.map((r) => (
                  <VaultItem
                    key={r.index}
                    row={r}
                    active={selected === r.index}
                    onUnlock={() => setSelected(selected === r.index ? null : r.index)}
                    onChanged={() => master && scan(master)}
                  />
                ))}
              </ul>
            )}
          </Panel>

          {sel && master && (
            <UnlockFlow
              key={sel.index}
              master={master}
              row={sel}
              nextFresh={nextFresh}
              onDone={() => scan(master)}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <Panel className="p-4">
      <Label>{k}</Label>
      <div className="font-display mt-2 text-[22px]">{v}</div>
    </Panel>
  );
}

function VaultItem({
  row,
  active,
  onUnlock,
  onChanged,
}: {
  row: VaultRow;
  active: boolean;
  onUnlock: () => void;
  onChanged: () => void;
}) {
  const { connection, program, wallet } = useNox();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const addr = row.vault.toBase58();
  const tokens = row.assets?.tokens.filter((t) => t.amount > 0n) ?? [];
  const hasLeft = row.spent && (row.lamports > 0 || tokens.length > 0);

  const sweep = async (mint?: PublicKey, tokenProgram?: PublicKey) => {
    if (!row.successor) return;
    const payer = wallet.publicKey;
    if (!payer) {
      setMsg({ kind: "bad", text: "Connect a wallet to pay the fee" });
      return;
    }
    setBusy(mint?.toBase58() ?? "sol");
    setMsg(null);
    try {
      const ix = mint
        ? await sweepTokenIx(program, payer, row.vault, row.successor, mint, tokenProgram!)
        : await sweepIx(program, row.vault, row.successor);
      await sendIxs(connection, payer, wallet.sendTransaction, [ix]);
      setMsg({ kind: "ok", text: "Swept to the successor vault." });
      onChanged();
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className={`px-4 py-4 ${active ? "bg-teal/[0.04]" : ""}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="font-display w-12 shrink-0 text-[20px] text-mute">#{row.index}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Status kind={row.pending ? "pending" : row.spent ? "spent" : "sealed"} />
              <a className="truncate text-[13px] hover:text-teal" href={explorerUrl(addr)} target="_blank" rel="noreferrer">
                {short(addr, 6)}
              </a>
              <Copy value={addr} />
            </div>
            {row.spent && row.successor && (
              <div className="mt-1 text-[11.5px] text-dim">
                spent → successor{" "}
                <a className="text-mute hover:text-teal" href={explorerUrl(row.successor.toBase58())} target="_blank" rel="noreferrer">
                  {short(row.successor.toBase58(), 6)}
                </a>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12.5px] md:justify-end">
          <span>
            <span className="font-display text-[16px]">{sol(row.lamports)}</span> <span className="text-dim">SOL</span>
          </span>
          {tokens.map((t) => (
            <span key={t.mint.toBase58()} className="text-mute">
              {fromBaseUnits(t.amount, t.decimals)} <span className="text-dim">{short(t.mint.toBase58(), 3)}</span>
            </span>
          ))}
          {!row.assets && <span className="text-[11px] text-dim">token balances unavailable</span>}
        </div>
        <div className="flex flex-wrap gap-2 md:w-[150px] md:justify-end">
          {!row.spent && (
            <button className={`btn sm ${active ? "" : "ghost"}`} onClick={onUnlock}>
              {active ? "close" : row.pending ? "resume" : "unlock"}
            </button>
          )}
        </div>
      </div>
      {hasLeft && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-3 text-[12px] md:ml-16">
          <span className="text-dim">left in a spent vault — forward it:</span>
          {row.lamports > 0 && (
            <button className="btn ghost sm" onClick={() => sweep()} disabled={!!busy}>
              {busy === "sol" ? "…" : `sweep ${sol(row.lamports)} SOL`}
            </button>
          )}
          {tokens.map((t) => (
            <button key={t.mint.toBase58()} className="btn ghost sm" onClick={() => sweep(t.mint, t.program)} disabled={!!busy}>
              {busy === t.mint.toBase58() ? "…" : `sweep_token ${short(t.mint.toBase58(), 3)}`}
            </button>
          ))}
        </div>
      )}
      {msg && (
        <div className="mt-2 md:ml-16">
          <Note kind={msg.kind}>{msg.text}</Note>
        </div>
      )}
    </li>
  );
}

