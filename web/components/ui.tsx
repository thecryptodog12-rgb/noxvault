"use client";
import { useState, type ReactNode } from "react";

export function Panel({
  children,
  className = "",
  lit = false,
  title,
  right,
}: {
  children: ReactNode;
  className?: string;
  lit?: boolean;
  title?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className={`panel ${lit ? "lit" : ""} ${className}`}>
      <i className="c tl" />
      <i className="c tr" />
      <i className="c bl" />
      <i className="c br" />
      {title !== undefined && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="label truncate">{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`label ${className}`}>{children}</div>;
}

export function PageHead({ kicker, title, sub }: { kicker: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-8 md:mb-10">
      <div className="label mb-4 flex items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 bg-moon" />
        {kicker}
      </div>
      <h1 className="font-display text-[34px] leading-[1.05] sm:text-[46px] md:text-[56px]">{title}</h1>
      {sub && <p className="mt-5 max-w-2xl text-[14px] text-mute">{sub}</p>}
    </header>
  );
}

export function Status({ kind }: { kind: "sealed" | "spent" | "pending" | "empty" }) {
  const map = {
    sealed: "border-moon text-moon",
    spent: "border-line-2 text-dim",
    pending: "border-warn text-warn",
    empty: "border-line text-dim",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em] ${map[kind]}`}>
      <span className={`inline-block h-1.5 w-1.5 ${kind === "sealed" ? "bg-moon" : kind === "pending" ? "bg-warn" : "bg-line-2"}`} />
      {kind}
    </span>
  );
}

export function Copy({ value, className = "" }: { value: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`text-[10px] uppercase tracking-[0.18em] text-dim hover:text-moon ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
    >
      [{done ? "copied" : "copy"}]
    </button>
  );
}

export function Note({ kind = "info", children }: { kind?: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  const c = {
    info: "border-line-2 text-mute",
    warn: "border-warn/60 text-warn",
    bad: "border-bad/60 text-bad",
    ok: "border-moon/60 text-moon",
  }[kind];
  const tag = { info: "note", warn: "warn", bad: "error", ok: "ok" }[kind];
  return (
    <div className={`border-l-2 ${c} bg-ink-2/80 px-3 py-2 text-[12.5px] leading-relaxed`}>
      <span className="mr-2 uppercase tracking-[0.18em] opacity-80">{tag} //</span>
      <span className="text-bone/85">{children}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="font-display text-[15px] text-mute">{title}</div>
      {children && <div className="max-w-md text-[12.5px] text-dim">{children}</div>}
    </div>
  );
}
