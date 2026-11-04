"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, Clock, Code2, Trophy, Users } from "lucide-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { withRetry, type VaultStateView } from "@nox/sdk/client";
import { Empty, Label, PageHead, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { short, sol, timeAgo } from "@/lib/format";
import { delayOf, ruleTags, rulesOf, type RuleTag } from "@/lib/treasury";
import { scanTreasuries } from "@/lib/stats";
import { tiersFor } from "@/lib/tiers";
import { TIER_GUARDIAN, TIER_NAMES, TIER_SENTINEL, loadProtocol } from "@/lib/nox";
import { X_URL } from "@/lib/config";
import { ProgramSteps } from "@/components/TreasuryProgram";

const WHY = [
  { Icon: Users, t: "Multi-signer", d: "2 of 3 team members must sign every payout. One leaked key moves nothing." },
  { Icon: Clock, t: "Public delay", d: "Payouts to unknown addresses wait in public, so holders see them coming and recovery can cancel." },
  { Icon: BadgeCheck, t: "Live proof", d: "A public page and badge read the rules from the chain. Nobody can fake or change them." },
  { Icon: Code2, t: "Badge + API", d: "Embed the badge on your site or listing; bots read the JSON endpoint." },
];

const PAGE = 50;

interface Row {
  vault: string;
  state: VaultStateView;
  rank: number;
  score: number;
  signers: number;
  lamports: number;
  schedules: number;
  tier: number | null; // null: tiers off on this network, or not read
  tags: RuleTag[];
}

function ScoreBar({ score }: { score: number }) {
  const tone = score >= 4 ? "bg-teal" : score >= 2 ? "bg-warn" : "bg-mute";
  return (
    <span className="inline-flex items-center gap-2" aria-label={`score ${score} of 5`}>
      <span className="inline-flex gap-[3px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-2.5 w-3 rounded-[2px] ${i < score ? tone : "bg-line-2"}`} />
        ))}
      </span>
      <span className={`tabular-nums ${score >= 4 ? "text-teal" : score >= 2 ? "text-warn" : "text-mute"}`}>{score}/5</span>
    </span>
  );
}

function TierPill({ tier }: { tier: number | null }) {
  if (tier === null) return <span className="text-dim">—</span>;
  const tone = tier === TIER_SENTINEL ? "border-warn/70 text-warn" : tier === TIER_GUARDIAN ? "border-teal/60 text-teal" : "border-line-2 text-mute";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${tone}`}>
      {tier === TIER_SENTINEL ? "◆ " : tier === TIER_GUARDIAN ? "◇ " : ""}
      {TIER_NAMES[tier]}
    </span>
  );
}

function Tags({ tags }: { tags: RuleTag[] }) {
  if (!tags.length) return <span className="text-dim">no extra rules</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((g) => (
        <span key={g.t} className={`rounded border px-1.5 py-px text-[10.5px] ${g.tone === "good" ? "border-teal/35 text-teal/90" : "border-warn/50 text-warn"}`}>
          {g.t}
        </span>
      ))}
    </span>
  );
}

const RANK_TONE = ["text-warn", "text-bone", "text-[#d8946a]"];

function Rank({ n }: { n: number }) {
  if (n > 3) return <span className="tabular-nums text-dim">#{n}</span>;
  return (
    <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${RANK_TONE[n - 1]}`}>
      <Trophy size={13} strokeWidth={1.8} />#{n}
    </span>
  );
}

/** Token mints with a non-zero balance, for the rows on screen only (two RPC reads per vault). */
function useTokenCounts(vaults: PublicKey[]) {
  const { connection } = useNox();
  const [counts, setCounts] = useState<Map<string, number | null>>(new Map());
  const key = vaults.map((v) => v.toBase58()).join(",");
  useEffect(() => {
    let live = true;
    const todo = vaults.filter((v) => !counts.has(v.toBase58()));
    if (!todo.length) return;
    (async () => {
      for (let i = 0; i < todo.length && live; i += 4) {
        const batch = todo.slice(i, i + 4);
        const res = await Promise.all(
          batch.map(async (v) => {
            try {
              const lists = await Promise.all(
                [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) => withRetry(() => connection.getParsedTokenAccountsByOwner(v, { programId }, "confirmed")))
              );
              const mints = new Set<string>();
              for (const l of lists)
                for (const a of l.value) {
                  const info = (a.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string } } } }).parsed.info;
                  if (info.tokenAmount.amount !== "0") mints.add(info.mint);
                }
              return [v.toBase58(), mints.size] as const;
            } catch {
              return [v.toBase58(), null] as const;
            }
          })
        );
        if (live) setCounts((m) => new Map([...m, ...res]));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connection]);
  return counts;
}

export default function TreasuryIndex() {
  const { connection, program } = useNox();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [vesting, setVesting] = useState(false);
  const [multisig, setMultisig] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [list, protocol] = await Promise.all([scanTreasuries(program), loadProtocol(program).catch(() => null)]);
        // tiersFor reports Sentinel for every vault when tiers are off, so only ask when they are on
        const tiersOn = !!protocol && !protocol.noxMint.equals(PublicKey.default);
        const tiers = tiersOn ? await tiersFor(connection, list.map((r) => r.state.vault), protocol).catch(() => null) : null;
        const out = list.map(({ state, lamports, schedules }) => {
          const vault = state.vault.toBase58();
          const signers = [0, 1, 2].filter((t) => state.config.trees[t].height > 0).length;
          return {
            vault,
            state,
            rank: 0,
            score: rulesOf(state).score,
            signers,
            lamports,
            schedules,
            tier: tiers?.get(vault)?.tier ?? null,
            tags: ruleTags(state, schedules),
          };
        });
        out.sort((a, b) => b.score - a.score || b.lamports - a.lamports || b.state.createdAt - a.state.createdAt);
        out.forEach((r, i) => (r.rank = i + 1));
        if (live) setRows(out);
      } catch {
        if (live) {
          setRows([]);
          setFailed(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [connection, program]);

  const shown = useMemo(
    () => (rows ?? []).filter((r) => r.score >= minScore && (!vesting || r.schedules > 0) && (!multisig || r.signers > 1)).slice(0, PAGE),
    [rows, minScore, vesting, multisig]
  );
  const tokenCounts = useTokenCounts(useMemo(() => shown.map((r) => r.state.vault), [shown]));
  const tokensOf = (v: string) => {
    const n = tokenCounts.get(v);
    if (n === undefined) return "…";
    return n === null ? "—" : n === 0 ? "none" : `${n} token${n > 1 ? "s" : ""}`;
  };

  const go = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/t/${q.trim()}`);
  };

  const filtersOn = minScore > 0 || vesting || multisig;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="new in v4 // treasuries"
        title={
          <>
            Treasuries holders can <span className="inv">check</span>
          </>
        }
        sub="Token teams ask holders to trust that the treasury, team tokens and LP won't be dumped. Put them in a Noxvault and every rule is public, live and impossible to change, with a page and a badge to prove it."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0" data-reveal-group>
        {WHY.map(({ Icon, t, d }) => (
          <div key={t} data-reveal className="panel glow p-5">
            <Icon size={26} strokeWidth={1.4} className="text-teal" />
            <div className="mt-3 text-[14.5px] font-bold">{t}</div>
            <p className="mt-1.5 text-[12.5px] leading-6 text-mute">{d}</p>
          </div>
        ))}
      </div>

      <form onSubmit={go} className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="look up a treasury by vault address" spellCheck={false} aria-label="Vault address" />
        <button className="btn" type="submit">
          view rules
        </button>
      </form>

      <div className="flex flex-wrap gap-3">
        <Link href="/create" className="btn">
          Create a treasury <ArrowRight size={15} />
        </Link>
        <span className="self-center text-[12.5px] text-mute">Use 2–3 signers, a recovery key and a delay of 48 h or more for a 5/5 score.</span>
      </div>

      <div data-reveal>
        <Panel
          title={<span className="rv-glitch inline-block">leaderboard // treasuries on this network</span>}
          right={rows && rows.length > 0 ? <span className="text-[10.5px] text-dim">{rows.length} vaults · read live</span> : undefined}
        >
          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5 sm:px-5" role="group" aria-label="Filters">
            <div className="flex flex-wrap items-center gap-2">
              <Label>min score</Label>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMinScore(n)}
                    aria-pressed={minScore === n}
                    className={`h-7 min-w-7 rounded border px-1.5 text-[11.5px] tabular-nums ${minScore === n ? "border-teal bg-teal/[0.08] text-teal" : "border-line-2 text-mute hover:text-bone"}`}
                  >
                    {n === 0 ? "all" : `${n}+`}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["has vesting", vesting, setVesting],
                  ["multisig", multisig, setMultisig],
                ] as const
              ).map(([t, on, set]) => (
                <button
                  key={t}
                  onClick={() => set(!on)}
                  aria-pressed={on}
                  className={`h-7 rounded border px-2.5 text-[11.5px] ${on ? "border-teal bg-teal/[0.08] text-teal" : "border-line-2 text-mute hover:text-bone"}`}
                >
                  {on ? "✓ " : ""}
                  {t}
                </button>
              ))}
            </div>
            {filtersOn && (
              <button
                className="text-[10.5px] uppercase tracking-[0.14em] text-dim hover:text-teal sm:ml-auto"
                onClick={() => (setMinScore(0), setVesting(false), setMultisig(false))}
              >
                [clear filters]
              </button>
            )}
          </div>

          {rows === null ? (
            <Empty title="reading the chain…" />
          ) : failed ? (
            <Empty title="the vault scan did not answer">This RPC refused the program scan right now. Every treasury page still reads live: look one up above.</Empty>
          ) : rows.length === 0 ? (
            <Empty title="no vaults yet" />
          ) : shown.length === 0 ? (
            <Empty title="no treasury matches these filters" />
          ) : (
            <>
              {/* phones: cards */}
              <ol className="divide-y divide-line md:hidden">
                {shown.map((r) => (
                  <li key={r.vault} className={`flex flex-col gap-2 px-4 py-3.5 ${r.rank <= 3 ? "border-l-2 border-l-teal/70 bg-teal/[0.035]" : ""}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-3">
                        <Rank n={r.rank} />
                        <Link href={`/t/${r.vault}`} className="text-[12.5px] text-bone hover:text-teal">
                          {short(r.vault, 5)}
                        </Link>
                      </span>
                      <TierPill tier={r.tier} />
                    </div>
                    <ScoreBar score={r.score} />
                    <div className="grid grid-cols-3 gap-2 text-[11.5px]">
                      <span>
                        <span className="block text-dim">signers</span>
                        {r.signers > 1 ? `${r.state.config.threshold} of ${r.signers}` : "1"}
                      </span>
                      <span>
                        <span className="block text-dim">delay</span>
                        {delayOf(r.state)}
                      </span>
                      <span>
                        <span className="block text-dim">holds</span>
                        {sol(r.lamports, 2)} SOL · {tokensOf(r.vault)}
                      </span>
                    </div>
                    <Tags tags={r.tags} />
                  </li>
                ))}
              </ol>

              {/* tablet and up: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="tbl min-w-[980px]">
                  <thead>
                    <tr>
                      <th>rank</th>
                      <th>vault</th>
                      <th>score</th>
                      <th>signers</th>
                      <th>delay</th>
                      <th className="!text-right">SOL</th>
                      <th>tokens</th>
                      <th>$NOX tier</th>
                      <th>verified rules</th>
                      <th className="!text-right">created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.vault} className={r.rank <= 3 ? "bg-teal/[0.04] [&>td:first-child]:shadow-[inset_2px_0_0_0_rgba(46,230,214,0.7)]" : ""}>
                        <td className="whitespace-nowrap">
                          <Rank n={r.rank} />
                        </td>
                        <td className="whitespace-nowrap">
                          <Link href={`/t/${r.vault}`} className={r.rank <= 3 ? "text-bone hover:text-teal" : "hover:text-teal"}>
                            {short(r.vault, 6)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap">
                          <ScoreBar score={r.score} />
                        </td>
                        <td className="whitespace-nowrap text-mute">{r.signers > 1 ? `${r.state.config.threshold} of ${r.signers}` : "1"}</td>
                        <td className="whitespace-nowrap text-mute">{delayOf(r.state)}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{sol(r.lamports, 2)}</td>
                        <td className="whitespace-nowrap text-mute">{tokensOf(r.vault)}</td>
                        <td className="whitespace-nowrap">
                          <TierPill tier={r.tier} />
                        </td>
                        <td>
                          <Tags tags={r.tags} />
                        </td>
                        <td className="whitespace-nowrap text-right text-dim">{r.state.createdAt > 0 ? timeAgo(r.state.createdAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="border-t border-line px-4 py-3 text-[11.5px] text-dim sm:px-5">
            Ranked by score, then SOL held. Score and tags are read from each vault&apos;s on-chain config, not self-reported. Tokens counts the
            mints the vault holds, for the rows shown; no prices are used.
          </p>
        </Panel>
      </div>

      <section data-reveal aria-labelledby="treasury-program">
        <Panel title={<span id="treasury-program">treasury program // for token projects</span>} lit>
          <div className="flex flex-col gap-5 p-4 sm:p-6">
            <h2 className="max-w-3xl text-[20px] font-bold leading-snug sm:text-[24px]">
              Token projects: put your treasury in a Noxvault and add the <span className="text-teal">badge</span> to your site.
            </h2>
            <ProgramSteps />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12.5px] text-mute">
                Questions about the setup? DM{" "}
                <a href={X_URL} target="_blank" rel="noreferrer" className="text-bone underline">
                  @noxvaultHQ
                </a>{" "}
                on X.
              </p>
              <div className="flex flex-wrap gap-3">
                <a href={X_URL} target="_blank" rel="noreferrer" className="btn">
                  DM @noxvaultHQ
                </a>
                <Link href="/create" className="btn ghost">
                  start with a preset
                </Link>
                <Link href="/for-projects" className="btn ghost">
                  full guide for projects
                </Link>
              </div>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
