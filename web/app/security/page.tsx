import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import Link from "next/link";
import { ArrowRight, Bug, Clock, FileText, Hash, KeyRound, Lock, MessageSquare, ShieldCheck, TriangleAlert } from "lucide-react";

export const metadata: Metadata = pageMeta(
  "Security — Noxvault",
  "How Noxvault protects a vault, what has and has not been reviewed, how to report a vulnerability, and the draft bug bounty."
);

const MODEL = [
  {
    Icon: Hash,
    t: "Hash-based keys",
    d: "Vault funds move only with WOTS+ one-time signatures, arranged in Merkle trees. They rest on SHA-256 alone, not on elliptic curves. The program burns every key after one use.",
  },
  {
    Icon: Lock,
    t: "Rules in the address",
    d: "Signers, threshold, whitelist, instant limit, delay, recovery, duress and heirs are hashed into the vault address. Nobody can change them later, not even the owner.",
  },
  {
    Icon: Clock,
    t: "Time as a defence",
    d: "Restricted payouts wait out a delay that the recovery key can cancel. Recovery and the testament need the owner to be inactive first. Duress mode pays a capped amount and locks the rest.",
  },
  {
    Icon: KeyRound,
    t: "What is still ed25519",
    d: "Session-budget keys, the sealed-letter key, Escape Hatch wallets, the protocol admin and the program's upgrade authority. Each one is limited to its own job, and the ones a vault grants can be revoked.",
  },
];

const DOCS = [
  { f: "THREAT_MODEL.md", d: "Assets, actors, trust boundaries, the attack surface of every instruction, and what is out of scope." },
  { f: "INVARIANTS.md", d: "Every property the program must keep. For each: where it is enforced (file and line), which test covers it, and the gaps found." },
  { f: "AUDIT_SCOPE.md", d: "Files and line counts, build and test commands, known issues and limits, and earlier internal reviews." },
  { f: "UPGRADE.md", d: "How the upgrade authority moves to a Squads multisig with a 7-day time lock, and how every upgrade is announced." },
];

const TIERS = [
  { s: "Critical", d: "Moving or locking vault funds without the signatures the rules require; forging a one-time signature; taking over the program." },
  { s: "High", d: "Getting around the whitelist, instant limit, delay, lockdown or duress cap; acting as recovery, heir or session key without the right; moving funds from a linked wallet." },
  { s: "Medium", d: "Lasting denial of service against a vault's owner, recovery or heirs; changing sealed letters without the letter key." },
  { s: "Low", d: "Problems that need an unusual configuration or only waste rent or fees." },
];

export default function Page() {
  return (
    <div className="flex max-w-[900px] flex-col gap-8">
      <div>
        <div className="label text-teal">security // audit status</div>
        <h1 className="mt-3 text-[36px] font-bold leading-tight sm:text-[48px]">
          How Noxvault is <span className="text-teal">secured</span>
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-bone/85">
          A Noxvault vault is a Solana address with no private key. The program moves its funds only when one-time hash signatures approve an action, and only within the
          rules the address was built from. This page explains that model, what has been reviewed so far, and how to report a problem.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0" data-reveal-group>
        {MODEL.map(({ Icon, t, d }, i) => (
          <div key={t} data-reveal className="panel glow p-5">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-teal">0{i + 1}</span>
              <Icon size={22} strokeWidth={1.4} className="text-teal" />
            </div>
            <div className="mt-3 text-[15px] font-bold">{t}</div>
            <p className="mt-1.5 text-[13px] leading-6 text-mute">{d}</p>
          </div>
        ))}
      </div>

      <div data-reveal className="panel border-warn/40 p-5 text-[13px] leading-6 text-mute">
        <div className="flex items-center gap-3">
          <TriangleAlert size={22} strokeWidth={1.4} className="text-warn" />
          <div className="rv-glitch text-[15px] font-bold text-warn">Audit status: not audited yet</div>
        </div>
        <p className="mt-2">
          No external firm has audited the program, the SDK, the relayer, the keeper or this site. Noxvault runs on devnet only. An internal pre-audit review in November 2026
          wrote down a threat model and the program&apos;s invariants, and added property-based tests in TypeScript and Rust. That review found issues in how fees and some
          spending rules interact. They will be fixed and retested before any mainnet launch, and before an external audit starts.
        </p>
        <p className="mt-2">
          The program is upgradeable. Today the devnet deployer key holds the upgrade authority. Before mainnet it moves to a Squads multisig with a 7-day time lock, and
          every upgrade is announced when it is proposed, so you always have a week to read it and leave.
        </p>
      </div>

      <div data-reveal className="panel p-5">
        <div className="flex items-center gap-3">
          <FileText size={22} strokeWidth={1.4} className="text-teal" />
          <div className="rv-glitch text-[15px] font-bold">Audit documents</div>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-mute">
          These are prepared for auditors. They live in the source tree under <code className="text-bone">docs/audit/</code> and will be published with the source code.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {DOCS.map(({ f, d }) => (
            <li key={f} className="text-[13px] leading-6">
              <code className="text-teal">{f}</code> <span className="text-mute">— {d}</span>
            </li>
          ))}
        </ul>
      </div>

      <div data-reveal className="panel p-5">
        <div className="flex items-center gap-3">
          <MessageSquare size={22} strokeWidth={1.4} className="text-teal" />
          <div className="rv-glitch text-[15px] font-bold">Responsible disclosure</div>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-mute">
          Found a vulnerability? Send a direct message on X to{" "}
          <a href="https://x.com/noxvaultHQ" target="_blank" rel="noreferrer" className="text-teal underline">
            @noxvaultHQ
          </a>
          . Please do not post it publicly, and do not open a public issue, until we have fixed it.
        </p>
        <ul className="mt-3 list-disc pl-5 text-[13px] leading-6 text-mute">
          <li>Describe the problem, the affected instruction or page, and the steps to reproduce it. A devnet transaction or a failing test helps most.</li>
          <li>Test only on devnet or a local validator, and only against vaults you created yourself.</li>
          <li>Do not touch other people&apos;s funds, letters or data, and do not run denial-of-service tests against public RPCs or the site.</li>
          <li>Give us reasonable time to fix the problem before you publish. We will tell you when the fix is live, and credit you if you want.</li>
        </ul>
      </div>

      <div data-reveal className="panel border-warn/40 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Bug size={22} strokeWidth={1.4} className="text-teal" />
          <div className="rv-glitch text-[15px] font-bold">Bug bounty</div>
          <span className="label border border-warn/60 px-2 py-0.5 text-warn">draft</span>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-mute">
          This is a draft of the bounty we plan to run once the program is audited. No bounty program is active yet, and nothing on this page is an offer. Scope, rules and rewards
          may change before it starts. Reward amounts are <span className="text-bone">to be announced</span>.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[13px] leading-6">
            <thead>
              <tr className="text-mute">
                <th className="py-2 pr-4 font-normal">Severity</th>
                <th className="py-2 pr-4 font-normal">Examples</th>
                <th className="py-2 font-normal">Reward</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map(({ s, d }) => (
                <tr key={s} className="border-t border-bone/10 align-top">
                  <td className="py-2 pr-4 font-bold">{s}</td>
                  <td className="py-2 pr-4 text-mute">{d}</td>
                  <td className="whitespace-nowrap py-2 text-bone/85">to be announced</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12.5px] leading-6 text-mute">
          Planned scope: the Noxvault program first, then the SDK&apos;s signing and encoding code. Planned to be out of scope: issues already listed in the audit documents,
          attacks that need a user&apos;s phrase or key (except where the vault rules should still limit them), third-party services, and social engineering.
        </p>
        <p className="mt-3 text-[12.5px] leading-6 text-mute">
          After the audit, a public challenge vault on mainnet will hold a bounty of its own: everything about it is public except the phrase.{" "}
          <Link href="/challenge" className="text-teal underline">
            Crack this vault
          </Link>{" "}
          explains the rules.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/risks" className="btn">
          Read the risks <ArrowRight size={15} />
        </Link>
        <span className="flex items-center gap-2 self-center text-[12.5px] text-mute">
          <ShieldCheck size={15} strokeWidth={1.4} className="text-teal" /> Unaudited, devnet. Do not store value you cannot lose.
        </span>
      </div>
    </div>
  );
}
