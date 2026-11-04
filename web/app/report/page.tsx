import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Note, PageHead, Panel } from "@/components/ui";
import { loadReport } from "@/lib/reportData";
import { compact, headlines, pct, type Control, type ExposureReport, type TokenReport } from "@/lib/report";
import { pageMeta } from "@/lib/meta";
import ShareBar from "./ShareBar";

export const metadata: Metadata = pageMeta(
  "Solana Quantum Exposure Report — Noxvault",
  "How much value on Solana mainnet sits behind a single ed25519 key? A snapshot read from public RPC, with the method and every account listed.",
  { siteImage: false }
);

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const sol = (lamports: number) => (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 0 });
const units = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 });
const day = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";

const CONTROL: Record<Control, { text: string; cls: string }> = {
  key: { text: "one key", cls: "border-warn/70 text-warn" },
  program: { text: "program", cls: "border-teal/60 text-teal" },
  unknown: { text: "unknown", cls: "border-line-2 text-dim" },
};

function Badge({ control }: { control: Control }) {
  const c = CONTROL[control];
  return <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${c.cls}`}>{c.text}</span>;
}

/** Horizontal split bar: single key / program / unknown. */
function Split({ k, program, unknown }: { k: number; program: number; unknown: number }) {
  const total = k + program + unknown || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-3" aria-hidden>
      <div className="bg-warn" style={{ width: `${(k / total) * 100}%` }} />
      <div className="bg-teal/70" style={{ width: `${(program / total) * 100}%` }} />
      <div className="bg-line-2" style={{ width: `${(unknown / total) * 100}%` }} />
    </div>
  );
}

function Stat({ value, unit, text }: { value: string; unit?: string; text: string }) {
  return (
    <div className="flex flex-col gap-2 bg-ink-2 px-5 py-5">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[34px] font-bold leading-none text-bone md:text-[40px]">{value}</span>
        {unit && <span className="text-[13px] text-mute">{unit}</span>}
      </div>
      <p className="text-[12.5px] leading-6 text-mute">{text}</p>
    </div>
  );
}

function Pending() {
  return (
    <Panel title="snapshot pending">
      <div className="flex flex-col gap-3 p-5 text-[13px] leading-6 text-mute">
        <p>The first mainnet snapshot has not been published yet. Public Solana RPC endpoints rate-limit the calls this report needs, so the numbers are taken in one scripted pass and committed, never estimated.</p>
        <p>
          Meanwhile, check any single address with the{" "}
          <Link href="/scan" className="text-teal hover:underline">
            quantum scanner
          </Link>
          .
        </p>
      </div>
    </Panel>
  );
}

function TokenRow({ t }: { t: TokenReport }) {
  return (
    <details className="group border-b border-line last:border-b-0">
      <summary className="grid cursor-pointer list-none grid-cols-[64px_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-ink-3/60 sm:grid-cols-[80px_1fr_120px_110px_110px] sm:px-5">
        <span className="font-bold text-bone">{t.symbol}</span>
        <Split k={t.topKey} program={t.topProgram} unknown={t.topUnknown} />
        <span className="hidden text-right text-[12px] text-mute sm:block">{compact(t.topTotal)}</span>
        <span className="hidden text-right text-[12px] text-mute sm:block">{pct(t.topTotal, t.supply)}%</span>
        <span className="col-span-2 text-[12px] text-warn sm:col-span-1 sm:text-right">
          {pct(t.topKey, t.topTotal)}% <span className="text-dim sm:hidden">one key · top {t.holders.length} hold {pct(t.topTotal, t.supply)}% of supply</span>
        </span>
      </summary>
      <div className="overflow-x-auto px-4 pb-4 sm:px-5">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <thead className="text-dim">
            <tr>
              <th className="py-1.5 pr-3 font-normal">#</th>
              <th className="py-1.5 pr-3 font-normal">owner</th>
              <th className="py-1.5 pr-3 text-right font-normal">{t.symbol}</th>
              <th className="py-1.5 pr-3 font-normal">controlled by</th>
            </tr>
          </thead>
          <tbody className="text-mute">
            {t.holders.map((h, i) => (
              <tr key={h.account} className="border-t border-line">
                <td className="py-1.5 pr-3 text-dim">{i + 1}</td>
                <td className="py-1.5 pr-3">
                  {h.owner ? (
                    <Link href={`/exposure/${h.owner}`} className="hover:text-teal">
                      {short(h.owner)}
                    </Link>
                  ) : (
                    "?"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right text-bone">{units(h.ui)}</td>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    <Badge control={h.control} />
                    <span className="truncate text-dim">{h.label}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-[11px] text-dim">
          mint {t.mint} · supply {units(t.supply)} {t.symbol}
        </div>
      </div>
    </details>
  );
}

function Report({ r }: { r: ExposureReport }) {
  const h = headlines(r);
  const ls = r.largestSol;
  const circ = r.supply?.circulatingLamports ?? 0;
  const tweet = h
    ? `${h.solKeyPct}% of the SOL in Solana's 20 largest accounts (${compact(h.solKey)} SOL) can be moved by one ed25519 signature. A large enough quantum computer could derive that key from the address. Snapshot ${r.generatedAt.slice(0, 10)}:`
    : "Solana Quantum Exposure Report:";
  const citation = h
    ? `Noxvault, "Solana Quantum Exposure Report", snapshot of Solana mainnet at slot ${r.slot.toLocaleString("en-US")} (${r.generatedAt.slice(0, 10)}): ${compact(h.solKey)} SOL of the ${compact(h.solTop)} SOL held in the 20 largest accounts (${h.solKeyPct}%) is controlled by a single ed25519 key. https://www.nox-vault.com/report`
    : `Noxvault, "Solana Quantum Exposure Report", snapshot ${r.generatedAt.slice(0, 10)}. https://www.nox-vault.com/report`;

  return (
    <div className="flex flex-col gap-6">
      {h && (
        <section className="panel overflow-hidden">
          <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
            <Stat value={compact(h.solKey)} unit="SOL" text={`of the ${compact(h.solTop)} SOL in the 20 largest accounts (${h.solKeyPct}%) can be moved by one ed25519 signature.`} />
            {h.solKeyOfCirculatingPct && (
              <Stat value={`${h.solKeyOfCirculatingPct}%`} text={`of all circulating SOL sits in just those few single-key accounts (circulating: ${compact(circ / 1e9)} SOL).`} />
            )}
            {h.stableTop > 0 && (
              <Stat value={compact(h.stableKey)} unit="USDC+USDT" text={`of the ${compact(h.stableTop)} held by the top 20 accounts of each stablecoin (${h.stableKeyPct}%) sits behind single keys.`} />
            )}
            {h.votes > 0 && (
              <Stat value={`${h.votesKey}/${h.votes}`} text={`validator vote accounts (${h.votesKeyPct}%) have a plain wallet as withdraw authority.`} />
            )}
          </div>
        </section>
      )}

      <Note kind="warn">
        No quantum computer can break ed25519 today, and nobody knows when one will. This report measures what would be exposed if one did: value whose only protection is a single ed25519 key.
      </Note>

      {ls && (
        <Panel title={`largest SOL accounts · top ${ls.holders.length}`} right={<span className="text-[10.5px] text-dim">{sol(ls.totalLamports)} SOL</span>}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-3 text-[12px] sm:px-5">
            <span className="flex items-center gap-2 text-warn">
              <span className="h-2 w-2 rounded-full bg-warn" /> one ed25519 key: {sol(ls.keyLamports)} SOL ({pct(ls.keyLamports, ls.totalLamports)}%)
            </span>
            <span className="flex items-center gap-2 text-teal">
              <span className="h-2 w-2 rounded-full bg-teal/70" /> program-controlled: {sol(ls.programLamports)} SOL ({pct(ls.programLamports, ls.totalLamports)}%)
            </span>
            {ls.unknownLamports > 0 && <span className="text-dim">unknown: {sol(ls.unknownLamports)} SOL</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="text-dim">
                <tr>
                  <th className="px-4 py-2 font-normal sm:px-5">#</th>
                  <th className="px-2 py-2 font-normal">address</th>
                  <th className="px-2 py-2 text-right font-normal">SOL</th>
                  <th className="px-2 py-2 text-right font-normal">% circ.</th>
                  <th className="px-2 py-2 font-normal">controlled by</th>
                </tr>
              </thead>
              <tbody className="text-mute">
                {ls.holders.map((a, i) => (
                  <tr key={a.address} className="border-t border-line">
                    <td className="px-4 py-2 text-dim sm:px-5">{i + 1}</td>
                    <td className="px-2 py-2">
                      <Link href={`/exposure/${a.address}`} className="hover:text-teal">
                        {short(a.address)}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right text-bone">{sol(a.lamports)}</td>
                    <td className="px-2 py-2 text-right">{circ ? `${pct(a.lamports, circ)}%` : "–"}</td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2">
                        <Badge control={a.control} />
                        <span className="truncate text-dim">{a.label}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-3 text-[11.5px] leading-5 text-dim sm:px-5">
            Stake accounts count as &ldquo;one key&rdquo; when their withdraw authority is a plain wallet: that key can withdraw the stake. Stake pools use program
            authorities and count as program-controlled. Addresses are not labelled with owners; click one to scan it.
          </div>
        </Panel>
      )}

      {r.tokens.length > 0 && (
        <Panel title="major SPL tokens · top 20 holders each" right={<span className="text-[10.5px] text-dim">tap a row for holders</span>}>
          <div className="hidden grid-cols-[80px_1fr_120px_110px_110px] gap-4 border-b border-line px-5 py-2 text-[11px] text-dim sm:grid">
            <span>token</span>
            <span>one key / program / unknown</span>
            <span className="text-right">top-20 total</span>
            <span className="text-right">% of supply</span>
            <span className="text-right">one key</span>
          </div>
          {r.tokens.map((t) => (
            <TokenRow key={t.mint} t={t} />
          ))}
          <div className="border-t border-line px-4 py-3 text-[11.5px] leading-5 text-dim sm:px-5">
            The top holders of most tokens are exchange hot wallets, market makers, bridges and protocol vaults. A bridge or protocol vault shows as program-controlled; an
            exchange wallet is usually a plain key.
          </div>
        </Panel>
      )}

      {r.votes && (
        <Panel title="validators">
          <div className="grid gap-4 p-4 text-[12.5px] leading-6 text-mute sm:grid-cols-[1fr_1.4fr] sm:p-5">
            <div className="flex flex-col gap-2">
              <Split k={r.votes.keyWithdrawer} program={r.votes.programWithdrawer} unknown={r.votes.unknown} />
              <span>
                <span className="text-warn">{r.votes.keyWithdrawer}</span> of {r.votes.accounts} vote accounts withdrawable by one wallet key ·{" "}
                <span className="text-teal">{r.votes.programWithdrawer}</span> by a program address
              </span>
            </div>
            <p>
              A vote account collects a validator&apos;s commission ({sol(r.votes.lamports)} SOL in all vote accounts, {sol(r.votes.lamportsKey)} SOL of it behind plain
              wallet keys). The {compact(r.votes.activatedStake / 1e9)} SOL delegated to these validators is not held by the vote accounts: it sits in delegators&apos; own
              stake accounts, under their own withdraw keys.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="what &ldquo;exposed&rdquo; means">
          <div className="flex flex-col gap-3 p-4 text-[12.5px] leading-6 text-mute sm:p-5">
            <p>
              <span className="text-bone">A Solana address is its ed25519 public key.</span> It is public from the moment the address is shared; that leaks nothing today.
              Shor&apos;s algorithm on a large enough quantum computer could derive the private key from the public key, and then sign for the account.
            </p>
            <p>
              <span className="text-warn">One key</span> = one ed25519 signature can move the funds: a plain wallet, or a stake or vote account whose withdraw authority is a
              plain wallet.
            </p>
            <p>
              <span className="text-teal">Program-controlled</span> = no private key exists for the address (a PDA), so a program decides. That is not the same as
              quantum-safe: most programs check ed25519 signatures of their own (admins, multisig members). A multisig of ed25519 keys is still ed25519. These rows are a
              different risk, not a safe one.
            </p>
          </div>
        </Panel>
        <Panel title="caveats">
          <ul className="flex list-none flex-col gap-2 p-4 text-[12.5px] leading-6 text-mute sm:p-5">
            <li>› Quantum computers that can break ed25519 do not exist yet. This is a measure of exposure, not of any attack.</li>
            <li>› It covers only the largest accounts the RPC returns (20 per list), not every wallet. The long tail is not measured.</li>
            <li>› One owner can control many keys; an exchange spreads funds over many wallets. Counts are per account, not per person.</li>
            <li>› Token amounts are in token units as read on chain. No prices are applied and nothing is converted to USD.</li>
            <li>› A snapshot: balances move every slot. Re-run the script to reproduce it.</li>
            <li>› Noxvault is unaudited and runs on devnet. Nothing here is investment advice.</li>
          </ul>
        </Panel>
      </div>

      <Panel title="methodology" right={<span className="text-[10.5px] text-dim">slot {r.slot.toLocaleString("en-US")}</span>}>
        <div className="flex flex-col gap-4 p-4 text-[12.5px] leading-6 text-mute sm:p-5">
          <ol className="flex flex-col gap-2">
            {r.method.map((m, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-teal">{String(i + 1).padStart(2, "0")}</span>
                <span>{m}</span>
              </li>
            ))}
          </ol>
          <div>
            <div className="label mb-1">sources (RPC endpoints that answered)</div>
            <ul className="text-[11.5px] text-dim">
              {Object.entries(r.sources).map(([k, v]) => (
                <li key={k}>
                  {k}: {v}
                </li>
              ))}
            </ul>
          </div>
          {r.failures.length > 0 && (
            <div>
              <div className="label mb-1">dropped (the RPC refused; no numbers were estimated)</div>
              <ul className="text-[11.5px] text-dim">
                {r.failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11.5px] text-dim">
            Reproduce: <code className="text-mute">pnpm exec tsx scripts/exposure-report.ts</code> in the Noxvault repo writes <code className="text-mute">web/content/exposure-report.json</code>. The
            same data is served as JSON at <code className="text-mute">/api/report</code>.
          </p>
        </div>
      </Panel>

      <Panel>
        <ShareBar tweet={tweet} citation={citation} />
      </Panel>
    </div>
  );
}

export default async function Page() {
  const r = await loadReport();
  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="quantum exposure report // solana mainnet"
        title={
          <>
            How much of Solana sits behind <span className="text-teal">one ed25519 key?</span>
          </>
        }
        sub={
          r ? (
            <>
              Snapshot of {day(r.generatedAt)}, slot {r.slot.toLocaleString("en-US")}. Every number below was read from public mainnet RPC; the method and every account are
              listed.
            </>
          ) : (
            "A snapshot of Solana mainnet, read from public RPC."
          )
        }
      />
      {r ? <Report r={r} /> : <Pending />}

      <section className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
        <Link href="/scan" className="panel glow group flex flex-wrap items-center justify-between gap-4 p-6 transition-colors hover:border-teal">
          <div className="min-w-0">
            <span className="label">quantum scanner</span>
            <div className="mt-1 text-[16px] font-bold">Check one wallet</div>
            <p className="mt-1 text-[12.5px] leading-6 text-mute">See the value one ed25519 key controls, its stake accounts and delegations. Read-only.</p>
          </div>
          <span className="btn shrink-0">
            scan <ArrowRight size={15} />
          </span>
        </Link>
        <Link href="/create" className="panel glow group flex flex-wrap items-center justify-between gap-4 p-6 transition-colors hover:border-teal">
          <div className="min-w-0">
            <span className="label">noxvault</span>
            <div className="mt-1 text-[16px] font-bold">Hold funds behind hash-based keys</div>
            <p className="mt-1 text-[12.5px] leading-6 text-mute">Withdrawals need a WOTS+ one-time signature checked on chain. Devnet, unaudited.</p>
          </div>
          <span className="btn shrink-0">
            create a vault <ArrowRight size={15} />
          </span>
        </Link>
      </section>
    </div>
  );
}
