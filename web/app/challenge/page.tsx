import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bug, Eye, EyeOff, Gavel, Hourglass, ShieldCheck, Target } from "lucide-react";
import { pageMeta } from "@/lib/meta";
import { CHALLENGE_VAULT } from "@/lib/challenge";
import LiveChallenge from "./LiveChallenge";

export const metadata: Metadata = pageMeta(
  "Crack this vault — Noxvault",
  "A public Noxvault whose address, config, Merkle roots and every signature are public. Only the phrase is secret. Drain it and you keep it.",
  { siteImage: false }
);

const PUBLIC = [
  { t: "The vault address", d: "Anyone can send to it, watch it and read its balance on the explorer." },
  { t: "The full config", d: "Signers, threshold, delays, whitelist, recovery, heirs and duress settings, as JSON, straight from the chain." },
  { t: "Every Merkle root", d: "The root of each key tree: the public commitment to every one-time key the vault can ever use." },
  { t: "Every signature ever made", d: "Each WOTS+ signature, its authentication path and the leaf it used are in the transaction history, forever." },
  { t: "The code", d: "The program and SDK source, the external audit report and the threat model, published before the challenge opens." },
];

const SECRET = [
  { t: "The owner's phrase", d: "The 24 words the one-time keys are derived from. Nothing else is held back." },
  { t: "Keys not yet used", d: "Each leaf's secret chains stay unknown until that key signs, and a used key is burned on-chain." },
];

const RULES = [
  {
    Icon: Target,
    t: "Attack the vault, not the people",
    d: "The attack must be on-chain or cryptographic: forge a one-time signature, recover a key from the public signatures, or find a path through the vault's rules. Drain it that way and the funds are yours.",
  },
  {
    Icon: EyeOff,
    t: "No social engineering",
    d: "Phishing, threats, bribes, break-ins or any other attempt to get the phrase or a device from the owner or the team are out of scope, and may be a crime. Attacks on our site, RPCs, hosting or accounts are out of scope too.",
  },
  {
    Icon: Bug,
    t: "Program bugs go to the bug bounty",
    d: "A bug in the program could put every vault at risk, not only this one. Report it privately through the security page instead of exploiting it; it is paid under the bug bounty.",
  },
  {
    Icon: Gavel,
    t: "Where permitted by law",
    d: "The challenge is open only where taking part is permitted by law. You are responsible for your own taxes and for following the law where you live. Final rules are published with the vault and may change before it opens.",
  },
];

export default function Page() {
  const live = !!CHALLENGE_VAULT;
  return (
    <div className="flex max-w-[960px] flex-col gap-8">
      <div>
        <div className="label text-teal">challenge // proof of security</div>
        <h1 className="mt-3 text-[36px] font-bold leading-tight sm:text-[48px]">
          Crack this <span className="text-teal">vault</span>
        </h1>
        <p className="mt-4 max-w-3xl text-[15px] leading-7 text-bone/85">
          One real Noxvault holds a bounty. Its address, its full config, its Merkle roots and every signature it ever makes are public. The only secret is the
          owner&apos;s phrase. If you can move the funds without it, you keep them.
        </p>
      </div>

      {live ? (
        <LiveChallenge vault={CHALLENGE_VAULT} />
      ) : (
        <div data-reveal className="panel lit p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Hourglass size={22} strokeWidth={1.4} className="text-teal" />
            <div className="rv-glitch text-[17px] font-bold">Coming after the audit</div>
            <span className="label border border-warn/60 px-2 py-0.5 text-warn">not open yet</span>
          </div>
          <p className="mt-3 text-[13.5px] leading-7 text-mute">
            The program is not audited yet and runs on devnet only. The challenge opens on mainnet after an external audit, with real funds in the vault. The bounty
            amount is <span className="text-bone">to be announced</span>, and so is the start. Until then nothing on this page is an offer.
          </p>
          <p className="mt-2 text-[13.5px] leading-7 text-mute">
            When it opens, this page shows the live balance, how many days the vault has stood unbroken, its rules, its Merkle roots and its recent signatures.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <div data-reveal className="panel p-5">
          <div className="flex items-center gap-3">
            <Eye size={22} strokeWidth={1.4} className="text-teal" />
            <div className="text-[15px] font-bold">What is public</div>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {PUBLIC.map(({ t, d }) => (
              <li key={t} className="flex gap-2.5 text-[13px] leading-6">
                <span className="text-teal">✓</span>
                <span>
                  <span className="text-bone">{t}.</span> <span className="text-mute">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div data-reveal className="panel p-5">
          <div className="flex items-center gap-3">
            <EyeOff size={22} strokeWidth={1.4} className="text-warn" />
            <div className="text-[15px] font-bold">What stays secret</div>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {SECRET.map(({ t, d }) => (
              <li key={t} className="flex gap-2.5 text-[13px] leading-6">
                <span className="text-warn">●</span>
                <span>
                  <span className="text-bone">{t}.</span> <span className="text-mute">{d}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-6 text-dim">
            Why this works: a WOTS+ signature reveals hash preimages for one message only, and SHA-256 has no known practical attack; a quantum computer only halves its
            security margin. A used key is marked spent on-chain, so the same key cannot sign twice.
          </p>
        </div>
      </div>

      <section data-reveal className="panel p-5 sm:p-6" aria-labelledby="rules">
        <div id="rules" className="label">
          rules
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          {RULES.map(({ Icon, t, d }) => (
            <div key={t}>
              <div className="flex items-center gap-3">
                <Icon size={20} strokeWidth={1.4} className="text-teal" />
                <div className="text-[14.5px] font-bold">{t}</div>
              </div>
              <p className="mt-1.5 text-[13px] leading-6 text-mute">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href="/security" className="btn">
          Report a program bug <ArrowRight size={15} />
        </Link>
        <Link href="/treasury" className="btn ghost">
          see public treasuries
        </Link>
        {!live && (
          <span className="flex items-center gap-2 self-center text-[12.5px] text-mute">
            <ShieldCheck size={15} strokeWidth={1.4} className="text-teal" /> Not audited yet. Devnet only until the audit is done.
          </span>
        )}
      </div>
    </div>
  );
}
