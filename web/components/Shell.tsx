"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, Menu, X as Close } from "lucide-react";
import { Mark, Wordmark } from "./Logo";
import WalletButton from "./WalletButton";
import { Copy } from "./ui";
import { NETWORK, NOX_TOKEN, PUMP_URL, X_URL } from "@/lib/config";
import { Countdown } from "./Launch";
import Fx from "./Fx";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/vaults", label: "Vaults" },
  { href: "/create", label: "Create Vault" },
  { href: "/mine", label: "My Vaults" },
  { href: "/treasury", label: "Treasuries" },
  { href: "/recovery", label: "Recovery" },
  { href: "/token", label: "$NOX" },
  { href: "/buy", label: "Buy" },
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/docs", label: "Docs" },
  { href: "/faq", label: "FAQ" },
];

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

const TOOLS = [
  { href: "/stats", label: "Stats" },
  { href: "/keylab", label: "Key Lab" },
  { href: "/duress", label: "Duress mode" },
  { href: "/letters", label: "Sealed letters" },
  { href: "/alerts", label: "Telegram alerts" },
  { href: "/escape", label: "Escape Hatch" },
  { href: "/scan", label: "Quantum scanner" },
  { href: "/canary", label: "Quantum canary" },
  { href: "/cosign", label: "Co-signer codes" },
  { href: "/offline", label: "Offline signing" },
  { href: "/backup", label: "Backup" },
];

// Mobile menu: the same pages, grouped so the list stays short.
const MOBILE_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "vault",
    items: [
      { href: "/create", label: "Create" },
      { href: "/mine", label: "My vaults" },
      { href: "/recovery", label: "Recovery" },
      { href: "/vaults", label: "Explorer" },
    ],
  },
  {
    label: "new in v4",
    items: [
      { href: "/treasury", label: "Treasuries" },
      { href: "/duress", label: "Duress" },
      { href: "/letters", label: "Letters" },
      { href: "/alerts", label: "Alerts" },
    ],
  },
  {
    label: "token",
    items: [
      { href: "/token", label: "$NOX" },
      { href: "/buy", label: "Buy" },
    ],
  },
  {
    label: "learn",
    items: [
      { href: "/whitepaper", label: "Whitepaper" },
      { href: "/docs", label: "Docs" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  { label: "tools", items: TOOLS.filter((t) => !["/duress", "/letters", "/alerts"].includes(t.href)) },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

function NetworkChip() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line-2 px-2.5 py-1 text-[10.5px] uppercase tracking-[0.14em] text-mute">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
      {NETWORK}
    </span>
  );
}

function CaChip() {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-full border border-line-2 px-2.5 py-1 text-[10.5px] tracking-[0.1em] text-mute">
      <span className="shrink-0 text-dim">$NOX CA</span>
      {NOX_TOKEN ? (
        <>
          <span className="truncate text-bone">{NOX_TOKEN}</span>
          <Copy value={NOX_TOKEN} />
          <a href={PUMP_URL} target="_blank" rel="noreferrer" className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-teal hover:underline">
            [buy]
          </a>
        </>
      ) : (
        <span className="truncate text-bone">
          pump.fun launch in <Countdown className="text-teal" />
        </span>
      )}
    </span>
  );
}

function ToolsMenu({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const active = TOOLS.some((t) => isActive(path, t.href));
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        className={`relative flex items-center gap-1 px-2 py-2 text-[12.5px] 2xl:px-3 2xl:text-[13px] ${active ? "text-teal" : "text-mute hover:text-bone"}`}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        aria-expanded={open}
      >
        Tools <ChevronDown size={13} />
        {active && <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-teal" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 min-w-[180px] rounded-md border border-line-2 bg-ink-2 py-1 shadow-xl">
          {TOOLS.map((t) => (
            <Link key={t.href} href={t.href} className={`block px-4 py-2 text-[12.5px] ${isActive(path, t.href) ? "text-teal" : "text-mute hover:bg-ink-3 hover:text-bone"}`}>
              {t.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  return (
    <div className="nox-bg flex min-h-dvh flex-col">
      <Fx />
      <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur-md">
        <div className="mx-auto flex h-[62px] max-w-[1600px] items-center gap-4 px-4 md:px-10 xl:px-16">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            <Mark size={32} />
            <Wordmark />
          </Link>
          <nav className="mx-auto hidden items-center gap-0.5 xl:flex" aria-label="Main">
            {NAV.map((n) => {
              const a = isActive(path, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`relative whitespace-nowrap px-2 py-2 text-[12.5px] transition-colors 2xl:px-3 2xl:text-[13px] ${a ? "text-teal" : "text-mute hover:text-bone"}`}
                >
                  {n.label}
                  {a && <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-teal" />}
                </Link>
              );
            })}
            <ToolsMenu path={path} />
            <a href={X_URL} target="_blank" rel="noreferrer" className="px-2 py-2 text-mute hover:text-bone" aria-label="Noxvault on X">
              <XIcon />
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-3 xl:ml-0">
            <span className="hidden 2xl:inline-flex">
              <NetworkChip />
            </span>
            <WalletButton className="hidden sm:inline-flex" />
            <button
              className="flex h-10 w-10 items-center justify-center rounded border border-line-2 text-bone xl:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(320px,88vw)] flex-col border-l border-line-2 bg-ink-2">
            <div className="flex h-[62px] items-center justify-between border-b border-line px-4">
              <span className="label">menu</span>
              <button className="flex h-9 w-9 items-center justify-center rounded border border-line-2" onClick={() => setOpen(false)} aria-label="Close menu">
                <Close size={16} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-2" aria-label="Mobile">
              <Link
                href="/"
                className={`flex items-center justify-between rounded px-3 py-2.5 text-[14px] ${path === "/" ? "bg-teal/[0.08] text-teal" : "text-mute hover:text-bone"}`}
              >
                Home
                {path === "/" && <span className="h-1.5 w-1.5 rounded-full bg-teal" />}
              </Link>
              {MOBILE_GROUPS.map((g) => (
                <div key={g.label} className="mt-3 border-t border-line pt-3">
                  <div className="label mb-1.5 px-3">{g.label}</div>
                  <div className="grid grid-cols-2 gap-x-1 [&>*]:min-w-0">
                    {g.items.map((n) => {
                      const a = isActive(path, n.href);
                      return (
                        <Link
                          key={n.href}
                          href={n.href}
                          className={`truncate rounded px-3 py-2 text-[13.5px] ${a ? "bg-teal/[0.08] text-teal" : "text-mute hover:text-bone"}`}
                        >
                          {n.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              <a href={X_URL} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 border-t border-line px-3 pb-1 pt-4 text-[13.5px] text-mute">
                <XIcon size={14} /> Noxvault on X
              </a>
            </nav>
            <div className="flex flex-col gap-3 border-t border-line p-4">
              <div className="flex flex-wrap gap-2">
                <NetworkChip />
                <CaChip />
              </div>
              <WalletButton className="w-full" />
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1600px] px-4 pb-20 pt-6 md:px-10 md:pt-8 xl:px-16">{children}</div>
      </main>

      <footer className="border-t border-line bg-ink/40">
        <div className="mx-auto grid max-w-[1600px] items-center justify-items-center gap-6 px-4 py-7 text-center lg:justify-items-stretch lg:text-left md:px-10 lg:grid-cols-[1fr_auto_1fr] xl:px-16">
          <div className="flex items-center gap-5">
            <span className="hidden h-[2px] w-10 bg-teal lg:block" />
            <span className="text-[12px] font-medium leading-5 tracking-[0.2em] text-bone">
              DIFFERENT KEYS
              <br />A SAFER TOMORROW
            </span>
          </div>
          <div className="flex items-center gap-4 text-left lg:justify-center">
            <svg width="34" height="40" viewBox="0 0 34 40" fill="none" aria-hidden>
              <path d="M13 3 3 20l10 17M21 3l10 17-10 17" stroke="#e6f0ef" strokeWidth="1.5" />
            </svg>
            <div>
              <div className="text-[12px] tracking-[0.18em]">
                <span className="font-bold">NOXVAULT</span>{" "}
                <span className="text-teal/80">{"// v4.0 // SOLANA"}</span>
              </div>
              <div className="mt-1 text-[10px] tracking-[0.14em] text-dim">BUILT ON HASHES, FOR A LONGER TOMORROW</div>
            </div>
          </div>
          <Link
            href="/risks"
            className="group flex w-full items-center gap-4 rounded-md border border-line-2 bg-ink-2/80 px-5 py-3.5 text-left transition-colors hover:border-teal/50 lg:w-auto lg:justify-self-end"
          >
            <AlertTriangle size={22} className="shrink-0 text-warn" strokeWidth={1.6} />
            <span className="min-w-0">
              <span className="block text-[11px] font-bold tracking-[0.16em]">RISKS &amp; DISCLAIMER</span>
              <span className="mt-0.5 block max-w-[420px] text-[10.5px] leading-snug text-dim">
                You hold the only key. Always do your own research.
              </span>
            </span>
            <ArrowRight size={18} className="shrink-0 text-mute transition-transform group-hover:translate-x-1 group-hover:text-teal" />
          </Link>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-3 px-4 py-3 text-center text-[10.5px] text-dim sm:flex-row sm:flex-wrap sm:justify-between sm:text-left md:px-10 xl:px-16">
            <span>secrets are generated and used in this browser only</span>
            <span className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-2">
              <NetworkChip />
              <CaChip />
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
