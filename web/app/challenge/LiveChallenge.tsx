"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchState, withRetry } from "@nox/sdk/client";
import { Copy, Empty, Label, Note, Panel } from "@/components/ui";
import { errMsg, hex, short, sol } from "@/lib/format";
import { dateTime, useNow } from "@/lib/time";
import { readProgram } from "@/lib/program";
import { isSolMint, loadTreasury, type Treasury } from "@/lib/treasury";
import { configToJson } from "@/lib/configJson";
import {
  CHALLENGE_CLUSTER,
  CHALLENGE_ON_SITE_NETWORK,
  CHALLENGE_START,
  TREE_NAMES,
  challengeExplorerUrl,
  challengeRpcUrl,
  daysUnbroken,
} from "@/lib/challenge";

interface Sig {
  signature: string;
  blockTime: number | null;
  failed: boolean;
}

interface Live {
  t: Treasury;
  roots: { name: string; root: string; height: number }[];
  config: string; // the full on-chain config as JSON
  sigs: Sig[] | null; // null: the history read failed
}

const RECENT = 10;

export default function LiveChallenge({ vault }: { vault: string }) {
  const now = useNow(60_000);
  const conn = useMemo(() => new Connection(challengeRpcUrl(), "confirmed"), []);
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    const key = new PublicKey(vault);
    const load = async () => {
      try {
        const program = readProgram(conn);
        const [t, state, sigs] = await Promise.all([
          loadTreasury(conn, key),
          fetchState(program, key),
          withRetry(() => conn.getSignaturesForAddress(key, { limit: RECENT }, "confirmed"))
            .then((l) => l.map((s) => ({ signature: s.signature, blockTime: s.blockTime ?? null, failed: !!s.err })))
            .catch(() => null),
        ]);
        const roots = state
          ? state.config.trees.map((tr, i) => ({ name: TREE_NAMES[i] ?? `tree ${i}`, root: hex(tr.root), height: tr.height })).filter((r) => r.height > 0)
          : [];
        const config = state ? JSON.stringify(configToJson(state.config), null, 2) : "";
        if (on) {
          setLive({ t, roots, config, sigs });
          setErr(null);
        }
      } catch (e) {
        if (on) setErr(errMsg(e));
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [vault, conn]);

  const t = live?.t;
  const start = CHALLENGE_START ?? (t?.initialized && t.createdAt > 0 ? t.createdAt : null);
  const days = daysUnbroken(start, now);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="label border border-teal/60 px-2 py-0.5 text-teal">live · {CHALLENGE_CLUSTER}</span>
        <a href={challengeExplorerUrl(vault)} target="_blank" rel="noreferrer" className="break-all hover:text-teal">
          {vault}
        </a>
        <Copy value={vault} />
      </div>

      {err && <Note kind="bad">Could not read the challenge vault right now: {err}</Note>}
      {!live && !err && <Empty title="reading the chain…" />}
      {t && !t.initialized && <Note kind="warn">No initialized Noxvault at the configured challenge address on {CHALLENGE_CLUSTER}.</Note>}

      {t?.initialized && live && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 [&>*]:min-w-0">
            <Tile k="balance" v={`${sol(t.lamports, 4)} SOL`} tone="text-teal" />
            <Tile k="unbroken for" v={start ? `${days} day${days === 1 ? "" : "s"}` : "—"} />
            <Tile k="tokens held" v={t.tokens.length ? String(t.tokens.length) : "none"} />
            <Tile k="actions signed" v={String(t.actions)} />
          </div>
          <p className="text-[12px] text-dim">
            Balance read live from {CHALLENGE_CLUSTER}
            {start ? `; counting since ${dateTime(start)}` : ""}
            {CHALLENGE_START ? " (the official start)" : " (the vault's creation)"}. Refreshes every minute.
          </p>

          {t.pending && (
            <Note kind="warn">
              A payout of {isSolMint(t.pending.mint) ? `${sol(BigInt(t.pending.amount), 4)} SOL` : `${t.pending.amount} units of ${short(t.pending.mint, 4)}`} to{" "}
              {short(t.pending.dest, 4)} is pending, executable after {dateTime(t.pending.executableAt)}. Signed actions are public the moment they are proposed.
            </Note>
          )}

          <Panel title="the rules this vault enforces">
            <ul className="flex flex-col gap-2.5 p-4 text-[13.5px] sm:p-5">
              {t.rules.map((r) => (
                <li key={r} className="flex gap-2.5">
                  <span className="text-teal">✓</span>
                  <span>{r}</span>
                </li>
              ))}
              {t.caveats.map((r) => (
                <li key={r} className="flex gap-2.5 text-warn">
                  <span>!</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="merkle roots // public keys of every tree">
            <div className="overflow-x-auto">
              <table className="tbl min-w-[620px]">
                <thead>
                  <tr>
                    <th>tree</th>
                    <th>height</th>
                    <th>root (sha-256)</th>
                  </tr>
                </thead>
                <tbody>
                  {live.roots.map((r) => (
                    <tr key={r.name}>
                      <td className="whitespace-nowrap">{r.name}</td>
                      <td className="whitespace-nowrap text-mute">
                        {r.height} · {2 ** r.height} keys
                      </td>
                      <td className="break-all text-[11.5px] text-mute">{r.root}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="full config // json" right={<Copy value={live.config} />}>
            <pre className="max-h-72 overflow-auto p-4 text-[11.5px] leading-5 text-mute sm:p-5">{live.config}</pre>
          </Panel>

          <Panel title={`recent signatures // last ${RECENT}`}>
            {live.sigs === null ? (
              <Empty title="history unavailable">This RPC did not return the transaction history. The explorer link above has it.</Empty>
            ) : live.sigs.length === 0 ? (
              <Empty title="no transactions yet" />
            ) : (
              <ul className="divide-y divide-line">
                {live.sigs.map((s) => (
                  <li key={s.signature} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                    <a href={challengeExplorerUrl(s.signature, "tx")} target="_blank" rel="noreferrer" className="truncate hover:text-teal">
                      {short(s.signature, 8)}
                    </a>
                    <span className={`shrink-0 ${s.failed ? "text-warn" : "text-dim"}`}>
                      {s.failed ? "failed · " : ""}
                      {s.blockTime ? dateTime(s.blockTime) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line px-4 py-3 text-[11.5px] text-dim sm:px-5">
              Every one-time signature the vault ever made is in these transactions. Failed attempts are listed too.
            </p>
          </Panel>

          <div className="flex flex-wrap gap-3">
            {CHALLENGE_ON_SITE_NETWORK ? (
              <Link href={`/t/${vault}`} className="btn">
                Public treasury page <ArrowRight size={15} />
              </Link>
            ) : (
              <span className="self-center text-[12.5px] text-mute">
                <Label className="mb-1">treasury page</Label>
                The public page at /t/{short(vault, 4)} reads {CHALLENGE_CLUSTER} once this site runs there.
              </span>
            )}
            <a href={challengeExplorerUrl(vault)} target="_blank" rel="noreferrer" className="btn ghost">
              open in explorer
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ k, v, tone = "" }: { k: string; v: string; tone?: string }) {
  return (
    <Panel className="p-4">
      <Label>{k}</Label>
      <div className={`mt-2 truncate text-[22px] font-bold tabular-nums ${tone}`}>{v}</div>
    </Panel>
  );
}
