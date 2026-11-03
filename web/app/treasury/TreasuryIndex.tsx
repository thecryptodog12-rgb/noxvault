"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, Clock, Code2, Users } from "lucide-react";
import { decodeState, withRetry, type VaultStateView } from "@nox/sdk/client";
import { Empty, PageHead, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { short, timeAgo } from "@/lib/format";
import { rulesOf } from "@/lib/treasury";

const WHY = [
  { Icon: Users, t: "Multi-signer", d: "2 of 3 team members must sign every payout. One leaked key moves nothing." },
  { Icon: Clock, t: "Public delay", d: "Payouts to unknown addresses wait in public, so holders see them coming and recovery can cancel." },
  { Icon: BadgeCheck, t: "Live proof", d: "A public page and badge read the rules from the chain. Nobody can fake or change them." },
  { Icon: Code2, t: "Badge + API", d: "Embed the badge on your site or listing; bots read the JSON endpoint." },
];

export default function TreasuryIndex() {
  const { connection, program } = useNox();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [list, setList] = useState<{ s: VaultStateView; score: number; signers: number }[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const accts = await withRetry(() =>
          connection.getProgramAccounts(program.programId, { commitment: "confirmed", filters: [{ memcmp: program.coder.accounts.memcmp("vaultState") }] })
        );
        const out: { s: VaultStateView; score: number; signers: number }[] = [];
        for (const a of accts) {
          try {
            const s = decodeState(program, a.account.data);
            const signers = [0, 1, 2].filter((t) => s.config.trees[t].height > 0).length;
            out.push({ s, score: rulesOf(s).score, signers });
          } catch {
            /* older program version */
          }
        }
        out.sort((a, b) => b.score - a.score || b.s.createdAt - a.s.createdAt);
        if (live) setList(out.slice(0, 50));
      } catch {
        if (live) setList([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [connection, program]);

  const go = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/t/${q.trim()}`);
  };

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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        {WHY.map(({ Icon, t, d }) => (
          <Panel key={t} className="p-5">
            <Icon size={26} strokeWidth={1.4} className="text-teal" />
            <div className="mt-3 text-[14.5px] font-bold">{t}</div>
            <p className="mt-1.5 text-[12.5px] leading-6 text-mute">{d}</p>
          </Panel>
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

      <Panel title="treasuries on this network">
        {list === null ? (
          <Empty title="reading the chain…" />
        ) : list.length === 0 ? (
          <Empty title="no vaults yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[560px] whitespace-nowrap">
              <thead>
                <tr>
                  <th>vault</th>
                  <th>protections</th>
                  <th>signers</th>
                  <th className="!text-right">created</th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ s, score, signers }) => {
                  const a = s.vault.toBase58();
                  return (
                    <tr key={a}>
                      <td>
                        <Link href={`/t/${a}`} className="hover:text-teal">
                          {short(a, 6)}
                        </Link>
                      </td>
                      <td className={score >= 4 ? "text-teal" : score >= 2 ? "text-warn" : "text-mute"}>{score} / 5</td>
                      <td className="text-mute">{signers > 1 ? `${s.config.threshold} of ${signers}` : "1"}</td>
                      <td className="text-right text-dim">{timeAgo(s.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
