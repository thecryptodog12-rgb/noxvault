"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Mark, Wordmark } from "./Logo";
import WalletButton from "./WalletButton";
import { Copy } from "./ui";
import { NETWORK, NOX_CA, NOX_CA_PLACEHOLDER, VERSION } from "@/lib/config";

const NAV: { group: string; items: { href: string; label: string; n: string }[] }[] = [
  {
    group: "vault",
    items: [
      { href: "/", label: "Home", n: "00" },
      { href: "/create", label: "Create vault", n: "01" },
      { href: "/mine", label: "My vaults", n: "02" },
      { href: "/vaults", label: "Explorer", n: "03" },
      { href: "/keylab", label: "Key lab", n: "04" },
    ],
  },
  {
    group: "read",
    items: [
      { href: "/docs", label: "How it works", n: "05" },
      { href: "/faq", label: "FAQ", n: "06" },
      { href: "/risks", label: "Risks", n: "07" },
    ],
  },
];

function NetworkBadge() {
  return (
    <div className="flex items-center justify-between border border-line px-3 py-2 text-[11px]">
      <span className="label">network</span>
      <span className="flex items-center gap-2 uppercase tracking-[0.15em]">
        <span className="inline-block h-1.5 w-1.5 animate-pulse bg-moon" />
        {NETWORK}
      </span>
    </div>
  );
}

function CaBox() {
  return (
    <div className="border border-line px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="label">$NOX CA</span>
        {NOX_CA && <Copy value={NOX_CA} />}
      </div>
      <div className="mt-1 truncate text-[12px] text-mute">{NOX_CA || NOX_CA_PLACEHOLDER}</div>
    </div>
  );
}

function NavList({ onNav }: { onNav?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-6">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="label mb-2 px-3">{`// ${g.group}`}</div>
          <ul>
            {g.items.map((it) => {
              const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNav}
                    className={`group flex items-center gap-3 border-l-2 px-3 py-[7px] text-[13px] transition-colors ${
                      active
                        ? "border-moon bg-moon/[0.07] text-moon"
                        : "border-transparent text-mute hover:border-line-2 hover:text-bone"
                    }`}
                  >
                    <span className={`text-[10px] ${active ? "text-moon" : "text-dim"}`}>{it.n}</span>
                    {it.label}
                    {active && <span className="ml-auto text-[10px]">◂</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SideFoot() {
  return (
    <div className="flex flex-col gap-2">
      <CaBox />
      <NetworkBadge />
      <WalletButton />
    </div>
  );
}

function Search({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v) router.push(`/vaults?q=${encodeURIComponent(v)}`);
  };
  return (
    <form onSubmit={submit} className={`relative ${className}`} role="search">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-dim">⌕</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search vault address"
        aria-label="Search vault address"
        className="field !py-1.5 !pl-8 !text-[12px]"
        spellCheck={false}
      />
    </form>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  const crumb = path === "/" ? "home" : path.slice(1);

  return (
    <div className="nox-bg min-h-dvh">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-ink/90 backdrop-blur lg:flex">
        <Link href="/" className="flex items-center gap-3 border-b border-line px-5 py-[18px]">
          <Mark size={30} />
          <div>
            <Wordmark />
            <div className="label mt-0.5 !text-[9px]">post-quantum vault</div>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto px-2 py-6">
          <NavList />
        </div>
        <div className="border-t border-line p-3">
          <SideFoot />
        </div>
      </aside>

      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur lg:ml-[248px]">
        <div className="flex h-14 items-center gap-3 px-4 md:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <Mark size={24} />
            <Wordmark className="!text-[15px]" />
          </Link>
          <div className="hidden min-w-0 items-center gap-2 text-[12px] text-dim lg:flex">
            <span>~/noxvault</span>
            <span>/</span>
            <span className="truncate text-bone">{crumb}</span>
            <span className="blink text-moon">▍</span>
          </div>
          <Search className="ml-auto hidden w-[300px] sm:block" />
          <span className="hidden border border-line px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-dim md:inline">
            {VERSION} · {NETWORK}
          </span>
          <button
            className="ml-auto border border-line-2 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.18em] sm:ml-0 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            menu ≡
          </button>
        </div>
      </header>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="nox-bg absolute inset-y-0 right-0 flex w-[min(320px,88vw)] flex-col border-l border-line">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <span className="label">menu</span>
              <button
                className="border border-line-2 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                close ×
              </button>
            </div>
            <div className="border-b border-line p-4 sm:hidden">
              <Search />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-5">
              <NavList onNav={() => setOpen(false)} />
            </div>
            <div className="border-t border-line p-3">
              <SideFoot />
            </div>
          </div>
        </div>
      )}

      <main className="lg:ml-[248px]">
        <div className="mx-auto w-full max-w-[1240px] px-4 pb-24 pt-8 md:px-8 md:pt-12">{children}</div>
        <footer className="border-t border-line lg:ml-0">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-4 py-6 text-[11px] text-dim md:flex-row md:items-center md:justify-between md:px-8">
            <span>NOXVAULT {VERSION} · unaudited software on {NETWORK} · secrets never leave this browser</span>
            <span className="flex gap-4">
              <Link href="/risks" className="hover:text-moon">risks</Link>
              <Link href="/docs" className="hover:text-moon">spec</Link>
              <Link href="/keylab" className="hover:text-moon">key lab</Link>
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
