import Link from "next/link";
import { ArrowRight, Atom, Boxes, Check, EyeOff, FileSignature, FlaskConical, Gauge, LifeBuoy, Lock, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import BootLines from "@/components/home/BootLines";
import ConsolePanel from "@/components/home/ConsolePanel";
import { Countdown } from "@/components/Launch";
import { NOX_TOKEN, PUMP_URL } from "@/lib/config";

const PLAIN = [
  { t: "Safer wallet", Icon: ShieldCheck, d: "Keep your SOL and tokens in a vault with your own rules: trusted addresses, waiting times and daily limits." },
  { t: "Quantum-proof", Icon: Atom, d: "Ordinary wallets can be cracked by a future quantum computer. Noxvault signs with hash-based keys that can't be." },
  { t: "Recovery", Icon: LifeBuoy, d: "Lost access? A backup key held by you or someone you trust can stop a theft and get your funds back." },
  { t: "Privacy", Icon: EyeOff, d: "Your vault never shows a public key, only a hash. Give each payer their own invoice address." },
  { t: "Inheritance", Icon: ScrollText, d: "Set heirs once. If you are inactive long enough, your funds go to them automatically." },
  { t: "Limits & automation", Icon: Gauge, d: "Recurring payments and spending budgets for apps and bots, without handing over your keys." },
];

const STEPS = [
  {
    n: "01",
    t: "GENERATE",
    Icon: Boxes,
    href: "/create",
    d: "Create a 24-word phrase; your browser builds 256 one-time keys in a Merkle tree. Keys never leave your device.",
  },
  {
    n: "02",
    t: "SEAL",
    Icon: Lock,
    href: "/create",
    d: "One fixed vault address for SOL, tokens and stake. Its rules (whitelist, delays, recovery) are part of the address.",
  },
  {
    n: "03",
    t: "UNLOCK",
    Icon: FileSignature,
    href: "/mine",
    d: "Each withdrawal, stake or ping uses one WOTS+ key, verified on-chain. Gasless through a relayer if you like.",
  },
  {
    n: "04",
    t: "RECOVER",
    Icon: RefreshCw,
    href: "/recovery",
    d: "Optional recovery key held by someone else: cancels suspicious withdrawals, takes over after long inactivity.",
  },
];

const ROWS: [string, string, string][] = [
  ["Security basis", "Elliptic curve (Ed25519)", "Hash-based (WOTS+, SHA-256)"],
  ["Quantum resistance", "Vulnerable (long term)", "Built to resist quantum attacks"],
  ["Public key exposure", "Public key always visible", "Only a Merkle root"],
  ["Key reuse", "Same key used repeatedly", "One-time keys (1 use only)"],
  ["Signature size", "64 bytes", "1,376 B (34 chains + auth path)"],
  ["Assets", "SOL, SPL", "SOL, SPL, Token-2022, stake"],
  ["Key uses", "unlimited", "256 actions per vault"],
];

const ROADMAP = [
  { n: "01", t: "BUILD", state: "done", items: ["Protocol spec", "Anchor program", "Browser key generation"] },
  { n: "02", t: "DEVNET", state: "now", items: ["Public devnet", "Community testing", "SDK & web app"] },
  { n: "03", t: "AUDIT", state: "next", items: ["Third-party audit", "Bug bounty", "Not started yet"] },
  { n: "04", t: "MAINNET", state: "next", items: ["Mainnet launch", "Multisig upgrades", "Integrations"] },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      {/* hero */}
      <section className="grid items-center gap-8 lg:grid-cols-[0.84fr_1.16fr] xl:gap-12 [&>*]:min-w-0">
        <div>
          <BootLines />
          <a
            href={NOX_TOKEN ? PUMP_URL : "/token"}
            target={NOX_TOKEN ? "_blank" : undefined}
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-teal/50 px-3.5 py-1.5 text-[12px] text-bone hover:bg-teal/10"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
            {NOX_TOKEN ? (
              <>$NOX is live on pump.fun</>
            ) : (
              <>
                $NOX launches on pump.fun in <Countdown className="text-teal" />
              </>
            )}
            <ArrowRight size={14} className="text-teal" />
          </a>
          <h1 className="mt-5 text-[44px] font-bold leading-[1.02] tracking-[-0.02em] sm:text-[58px] xl:text-[58px] 2xl:text-[76px]">
            The safer wallet
            <br />
            for <span className="text-teal">Solana.</span>
          </h1>
          <p className="mt-6 max-w-[600px] text-[14.5px] leading-7 text-bone/85 sm:text-[16px]">
            Noxvault is a vault for your SOL and tokens that stays safe, even against quantum computers. Add a backup key,
            trusted addresses, limits and an inheritance plan, all enforced on-chain.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
            <Link href="/create" className="btn justify-center !px-10 !py-3.5 !text-[14px]">
              Create a Vault <ArrowRight size={17} />
            </Link>
            <Link href="/keylab" className="btn ghost justify-center !border-bone/50 !px-9 !py-3.5 !text-[14px]">
              <FlaskConical size={17} strokeWidth={1.6} /> Try the Key Lab
            </Link>
          </div>
        </div>
        <ConsolePanel />
      </section>

      {/* in plain words */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line-2 px-6 py-4 text-[16px] font-medium tracking-[0.16em]">WHAT YOU GET</div>
        <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {PLAIN.map(({ t, Icon, d }) => (
            <div key={t} className="flex gap-4 bg-ink-2 px-6 py-5">
              <Icon size={26} strokeWidth={1.4} className="mt-0.5 shrink-0 text-teal" />
              <div className="min-w-0">
                <div className="text-[14.5px] font-bold">{t}</div>
                <p className="mt-1.5 text-[12.5px] leading-6 text-mute">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* steps */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        {STEPS.map(({ n, t, Icon, href, d }) => (
          <Link key={n} href={href} className="panel group flex gap-5 p-5 transition-colors hover:border-teal/50 sm:p-6">
            <div className="flex shrink-0 flex-col gap-5">
              <span className="text-[18px] font-medium text-teal">{n}</span>
              <Icon size={40} strokeWidth={1.25} className="text-teal" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="text-[15px] font-medium tracking-[0.12em]">{t}</div>
              <p className="mt-3 text-[12.5px] leading-6 text-mute">{d}</p>
              <ArrowRight size={16} className="mt-auto self-end text-teal transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </section>

      {/* compare + roadmap */}
      <section className="grid gap-3 xl:grid-cols-[1.12fr_0.88fr] [&>*]:min-w-0">
        <div className="panel overflow-hidden">
          <div className="border-b border-line-2 px-6 py-4 text-[16px] font-medium tracking-[0.16em]">WALLET vs NOXVAULT</div>
          <dl className="divide-y divide-line sm:hidden">
            <div className="grid grid-cols-2 gap-3 px-5 py-2.5 text-[10px] tracking-[0.14em] text-dim">
              <span>STANDARD WALLET</span>
              <span className="text-teal">NOXVAULT</span>
            </div>
            {ROWS.map(([k, a, b]) => (
              <div key={k} className="px-5 py-3.5">
                <dt className="text-[10.5px] tracking-[0.14em] text-dim">{k.toUpperCase()}</dt>
                <dd className="mt-1.5 grid grid-cols-2 gap-3 text-[12px] leading-5">
                  <span className="text-mute">{a}</span>
                  <span className="text-teal">{b}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="hidden overflow-x-auto sm:block">
            <table className="tbl min-w-[600px] whitespace-nowrap text-[12px] [&_td]:!px-3.5 [&_td]:!py-[9px] [&_th]:!px-3.5">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Standard wallet</th>
                  <th className="!text-teal">Noxvault (this protocol)</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([k, a, b]) => (
                  <tr key={k}>
                    <td className="text-mute">{k}</td>
                    <td className="text-mute">{a}</td>
                    <td className="text-teal">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line-2 px-6 py-4">
            <span className="text-[16px] font-medium tracking-[0.16em]">WHERE WE ARE</span>
            <span className="text-[10.5px] tracking-[0.14em] text-dim">{"ROADMAP // v2"}</span>
          </div>
          <div className="flex flex-1 items-center">
            <ol className="grid w-full grid-cols-2 gap-y-6 px-6 py-6 sm:grid-cols-4 sm:gap-y-0">
              {ROADMAP.map((r, i) => (
                <li key={r.n} className="relative">
                  {i < ROADMAP.length - 1 && (
                    <span
                      className={`absolute left-9 right-1 top-[13px] hidden border-t sm:block border-dashed ${r.state === "done" ? "border-teal" : "border-line-2"}`}
                    />
                  )}
                  <span
                    className={`relative flex h-[28px] w-[28px] items-center justify-center rounded-full border text-[11px] ${
                      r.state === "now"
                        ? "border-teal bg-teal font-bold text-ink shadow-[0_0_18px_rgba(46,230,214,0.55)]"
                        : r.state === "done"
                          ? "border-teal text-teal"
                          : "border-line-2 text-mute"
                    }`}
                  >
                    {r.n}
                  </span>
                  <div className={`mt-4 flex items-center gap-2 text-[14px] font-medium tracking-[0.12em] ${r.state === "next" ? "text-mute" : ""}`}>
                    {r.t}
                    {r.state === "done" && <Check size={15} className="text-teal" />}
                    {r.state === "now" && <span className="rounded-sm bg-teal px-1.5 text-[9.5px] font-bold text-ink">NOW</span>}
                  </div>
                  <ul className="mt-3 flex flex-col gap-1.5 pr-3 text-[11.5px] text-mute">
                    {r.items.map((it) => (
                      <li key={it} className="flex gap-2">
                        <span className="text-dim">•</span>
                        {it}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
          <p className="border-t border-line px-6 py-3 text-[11px] text-dim">Nothing has been audited yet. Use devnet SOL only.</p>
        </div>
      </section>

      {/* $NOX + whitepaper */}
      <section className="grid gap-3 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-2 px-6 py-4">
            <span className="text-[16px] font-medium tracking-[0.16em]">$NOX // HELD IN YOUR VAULT</span>
            <span className="flex shrink-0 gap-4">
              <Link href="/token" className="text-[11px] tracking-[0.14em] text-mute hover:text-teal">
                TIERS →
              </Link>
              {NOX_TOKEN && (
                <a href={PUMP_URL} target="_blank" rel="noreferrer" className="text-[11px] tracking-[0.14em] text-teal hover:underline">
                  BUY →
                </a>
              )}
            </span>
          </div>
          <div className="grid gap-px bg-line sm:grid-cols-3 [&>*]:min-w-0">
            {[
              ["FREE", "text-mute", "Vault, withdrawals, staking, whitelist, recovery, Escape Hatch. One-time creation fee."],
              ["GUARDIAN", "text-teal", "+ testament, recurring schedules, session budgets. No creation fee."],
              ["SENTINEL", "text-warn", "+ multi-signer vaults, free relayer, first in line at Q-Day."],
            ].map(([t, c, d]) => (
              <div key={t} className="bg-ink-2 px-5 py-5">
                <div className={`text-[14px] font-bold tracking-[0.12em] ${c}`}>{t}</div>
                <p className="mt-2 text-[12px] leading-6 text-mute">{d}</p>
              </div>
            ))}
          </div>
          <p className="border-t border-line px-6 py-3 text-[11.5px] text-dim">
            Tiers come from $NOX held inside the vault, checked on-chain. Safety features never need a tier.
          </p>
        </div>
        <Link href="/whitepaper" className="panel group flex flex-col justify-between gap-4 p-6 transition-colors hover:border-teal/50">
          <div>
            <div className="label">read</div>
            <div className="mt-3 text-[22px] font-bold">The whitepaper</div>
            <p className="mt-2 text-[12.5px] leading-6 text-mute">Design, Escape Hatch and canary, security model, $NOX utility and tokenomics, roadmap and risks.</p>
          </div>
          <span className="flex items-center gap-2 text-[13px] text-teal">
            Open the whitepaper <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </span>
        </Link>
      </section>
    </div>
  );
}
