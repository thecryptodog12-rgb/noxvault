"use client";
// Small pieces shared by /escape, /scan and /canary.
import type { ReactNode } from "react";
import type { Connection } from "@solana/web3.js";
import { useTokenInfo } from "@/lib/tokens";
import { explorerUrl } from "@/lib/config";
import { fromBaseUnits, short } from "@/lib/format";
import { Note } from "@/components/ui";

export function Row({ k, children, mono = false }: { k: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <span className="w-40 shrink-0 text-[11px] uppercase tracking-[0.14em] text-dim">{k}</span>
      <span className={`min-w-0 break-words text-[12.5px] ${mono ? "text-mute" : "text-bone"}`}>{children}</span>
    </div>
  );
}

export function Addr({ value, full = false }: { value: string; full?: boolean }) {
  return (
    <a href={explorerUrl(value)} target="_blank" rel="noreferrer" className="break-all text-teal hover:underline">
      {full ? value : short(value, 6)}
    </a>
  );
}

export function TxLink({ sig }: { sig: string }) {
  return (
    <a href={explorerUrl(sig, "tx")} target="_blank" rel="noreferrer" className="text-teal underline decoration-dotted">
      {short(sig, 6)}
    </a>
  );
}

export function Pill({ kind, children }: { kind: "ok" | "warn" | "bad" | "dim"; children: ReactNode }) {
  const c = { ok: "border-teal text-teal", warn: "border-warn text-warn", bad: "border-bad text-bad", dim: "border-line-2 text-dim" }[kind];
  const dot = { ok: "bg-teal", warn: "bg-warn", bad: "bg-bad", dim: "bg-line-2" }[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${c}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export function TokenName({ conn, mint }: { conn: Connection; mint: string }) {
  const info = useTokenInfo(conn, mint);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {info?.logo ? <img src={info.logo} alt="" className="h-4 w-4 shrink-0 rounded-full" /> : <span className="inline-block h-4 w-4 shrink-0 rounded-full border border-line-2" />}
      <span className="truncate">{info ? info.symbol : short(mint)}</span>
      {info?.known && <span className="hidden truncate text-dim sm:inline">{info.name}</span>}
    </span>
  );
}

export function TokenAmount({ conn, mint, amount }: { conn: Connection; mint: string; amount: bigint }) {
  const info = useTokenInfo(conn, mint);
  return <span className="tabular-nums">{info ? fromBaseUnits(amount, info.decimals) : amount.toString()}</span>;
}

export interface ResultMsg {
  kind: "ok" | "bad" | "warn" | "info";
  text: ReactNode;
  sigs?: string[];
}

export function Result({ r }: { r: ResultMsg | null }) {
  if (!r) return null;
  return (
    <Note kind={r.kind}>
      {r.text}
      {r.sigs?.length ? (
        <span className="ml-2 inline-flex flex-wrap gap-2">
          {r.sigs.map((s) => (
            <TxLink key={s} sig={s} />
          ))}
        </span>
      ) : null}
    </Note>
  );
}

export function StepHead({ n, title, done }: { n: string; title: string; done?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={done ? "text-teal" : "text-dim"}>{done ? "✓" : n}</span>
      <span>{title}</span>
    </span>
  );
}
