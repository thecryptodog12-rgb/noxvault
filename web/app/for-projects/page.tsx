import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarClock, Clock, KeyRound, LifeBuoy, Users } from "lucide-react";
import { pageMeta } from "@/lib/meta";
import { X_URL } from "@/lib/config";
import { PRESETS, PRESET_SETTINGS } from "@/lib/presets";
import { Copy, Note, PageHead, Panel } from "@/components/ui";
import { ProgramSteps } from "@/components/TreasuryProgram";

export const metadata: Metadata = pageMeta(
  "For token projects — Noxvault",
  "Prove to your holders you can't dump the treasury: multi-signer vaults, public delays and vesting enforced on-chain, with a live page and badge.",
  { siteImage: false }
);

const SITE = "https://www.nox-vault.com";
const EMBED = `<a href="${SITE}/t/YOUR_VAULT"><img src="${SITE}/api/treasury/YOUR_VAULT/badge" alt="Noxvault treasury"></a>`;
const JSON_URL = `${SITE}/api/treasury/YOUR_VAULT`;

const BENEFITS = [
  { Icon: Users, t: "No single key can dump", d: "2 of 3 signers approve every payout. One leaked or rogue key moves nothing." },
  { Icon: Clock, t: "Every payout in public first", d: "Payouts to new addresses wait 72 h on the public page. Holders see them coming; your recovery key can cancel." },
  { Icon: CalendarClock, t: "Vesting nobody can speed up", d: "Schedules pay team allocations on fixed dates. Not even the signers can pull them forward." },
  { Icon: BadgeCheck, t: "Proof, not promises", d: "A page and badge read the rules from the chain. They can't be faked, and the rules can't be changed later." },
  { Icon: LifeBuoy, t: "Lost keys aren't the end", d: "A separate recovery tree can cancel bad payouts and takes over after a long period of inactivity." },
  { Icon: KeyRound, t: "Hash-based keys", d: "Funds move only with one-time SHA-256 signatures, not elliptic-curve keys, so they hold up against future quantum computers." },
];

const PROJECT_PRESETS = PRESETS.filter(([p]) => PRESET_SETTINGS[p] && !PRESET_SETTINGS[p]?.personal);

export default function Page() {
  return (
    <div className="flex flex-col gap-8">
      <PageHead
        kicker="for token projects and daos"
        title={
          <>
            Prove you can&apos;t <span className="inv">dump</span> the treasury
          </>
        }
        sub="Holders are asked to trust that the treasury, team tokens and LP stay put. Put them in a Noxvault instead: the rules are part of the vault address, enforced on-chain and checked live by anyone."
      />

      <Note kind="warn">
        Noxvault runs on Solana devnet and has not been audited yet. Mainnet opens after an external audit. Try the full setup on devnet today; move real funds only
        once it is live on mainnet.
      </Note>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0" data-reveal-group>
        {BENEFITS.map(({ Icon, t, d }) => (
          <div key={t} data-reveal className="panel glow p-5">
            <Icon size={26} strokeWidth={1.4} className="text-teal" />
            <div className="mt-3 text-[14.5px] font-bold">{t}</div>
            <p className="mt-1.5 text-[12.5px] leading-6 text-mute">{d}</p>
          </div>
        ))}
      </div>

      <section data-reveal aria-labelledby="presets">
        <Panel title={<span id="presets">presets // one click in create</span>}>
          <div className="grid gap-px bg-line md:grid-cols-2">
            {PROJECT_PRESETS.map(([p, name, line]) => {
              const s = PRESET_SETTINGS[p]!;
              return (
                <div key={p} className="bg-ink p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[16px] font-bold text-teal">{name}</div>
                    <div className="text-[11.5px] text-dim">{line}</div>
                  </div>
                  <p className="mt-2 text-[12.5px] text-bone/85">{s.forWho}</p>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {s.settings.map((x) => (
                      <li key={x} className="flex gap-2 text-[12.5px] leading-5 text-mute">
                        <span className="text-teal">›</span>
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="border-t border-line px-4 py-3 text-[11.5px] text-dim sm:px-5">
            Every preset is a starting point: change signers, delays, the whitelist or the recovery key before you create the vault. After that the rules are fixed.
            The DAO preset works next to an existing Squads or Realms multisig: it only ever pays out to that address.
          </p>
        </Panel>
      </section>

      <section data-reveal aria-labelledby="steps">
        <Panel title={<span id="steps">get started // three steps</span>} lit>
          <div className="p-4 sm:p-6">
            <ProgramSteps />
          </div>
        </Panel>
      </section>

      <section data-reveal aria-labelledby="badge">
        <Panel title={<span id="badge">badge // put it on your site</span>}>
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <p className="text-[12.5px] leading-6 text-mute">
              The badge is drawn live from the vault&apos;s on-chain config: signers, protection score and any pending payout. Replace{" "}
              <code className="text-bone">YOUR_VAULT</code> with your vault address; the treasury page at /t/&lt;vault&gt; shows the same snippet filled in.
            </p>
            <div className="inline-flex self-start overflow-hidden rounded-sm text-[11px] font-bold" aria-label="Example badge">
              <span className="bg-ink-2 px-1.5 py-[3px] text-[#8fe3d6]">noxvault treasury</span>
              <span className="bg-[#5fd3b5] px-1.5 py-[3px] text-ink">2-of-3 · 5/5 protections</span>
            </div>
            <div className="label">embed</div>
            <div className="flex items-start gap-2">
              <code className="block flex-1 break-all rounded border border-line p-2 text-[11.5px] text-mute">{EMBED}</code>
              <Copy value={EMBED} />
            </div>
            <div className="label">json for bots and listings</div>
            <div className="flex items-start gap-2">
              <code className="block flex-1 break-all rounded border border-line p-2 text-[11.5px] text-mute">{JSON_URL}</code>
              <Copy value={JSON_URL} />
            </div>
          </div>
        </Panel>
      </section>

      <section data-reveal className="panel p-5 sm:p-6" aria-labelledby="costs">
        <div id="costs" className="label">
          what it costs
        </div>
        <ul className="mt-3 flex flex-col gap-2 text-[13px] leading-6 text-mute">
          <li>
            <span className="text-bone">Rent:</span> about 0.003 SOL for the vault state, paid once.
          </li>
          <li>
            <span className="text-bone">Protocol fees:</span> a small SOL fee on vault creation and on relayed actions. Holding $NOX in the vault waives the creation
            fee (Guardian and Sentinel) and relaying (Sentinel).
          </li>
          <li>
            <span className="text-bone">Multi-signer vaults</span> and schedules need a $NOX tier held in the vault itself; see{" "}
            <Link href="/token" className="text-bone underline">
              $NOX
            </Link>
            .
          </li>
          <li>On devnet everything runs on free test SOL and test $NOX.</li>
        </ul>
      </section>

      <div className="flex flex-col gap-4 rounded-md border border-line-2 bg-ink-2/80 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-mute">
          Want help with the setup, or a walkthrough for your team? DM{" "}
          <a href={X_URL} target="_blank" rel="noreferrer" className="text-bone underline">
            @noxvaultHQ
          </a>{" "}
          on X.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={X_URL} target="_blank" rel="noreferrer" className="btn">
            DM @noxvaultHQ <ArrowRight size={15} />
          </a>
          <Link href="/create" className="btn ghost">
            start with a preset
          </Link>
          <Link href="/treasury" className="btn ghost">
            see treasuries
          </Link>
        </div>
      </div>

      <p className="text-[12px] text-dim">
        Want proof the vaults hold? See the{" "}
        <Link href="/challenge" className="text-mute underline">
          crack-this-vault challenge
        </Link>{" "}
        and the{" "}
        <Link href="/security" className="text-mute underline">
          security page
        </Link>
        .
      </p>
    </div>
  );
}
