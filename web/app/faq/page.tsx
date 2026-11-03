import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "FAQ — Noxvault" };

const QA: [string, React.ReactNode][] = [
  [
    "What if someone forces me to open my vault?",
    <>
      Give them your <strong>duress phrase</strong>, a second set of 24 words you can make when you create the vault. It pays out
      at most a small amount you chose, right away, and then locks the vault; only your recovery key lifts the lock early. Nobody can
      see on chain whether a vault has a duress phrase. It is not a guarantee: someone who checks a block explorer sees the real
      balance. See <Link href="/duress">duress mode</Link>.
    </>,
  ],
  [
    "How do my heirs learn what they need to know?",
    <>
      Write them <strong>sealed letters</strong>: encrypted to a date in the future and stored next to your vault. While you are
      active the date keeps moving forward; when you stop, they open around the time your testament pays out. See{" "}
      <Link href="/letters">sealed letters</Link>.
    </>,
  ],
  [
    "Can a token project use Noxvault as its treasury?",
    <>
      Yes. Pick the team multisig, slow treasury or vesting preset in Create. Every vault has a public page that shows its rules,
      balances, vesting and pending payouts, plus a badge for the project site. See <Link href="/treasury">treasuries</Link>.
    </>,
  ],
  [
    "Can my Phantom wallet open my vault?",
    <>
      Not by itself. Moving anything out needs a one-time signature made from your 24 words. The one exception is one you choose:
      a <strong>session budget</strong> lets a wallet like Phantom spend up to a limit per period, only to allowed destinations,
      until it expires. See <Link href="/docs#budgets">session budgets</Link>.
    </>,
  ],
  [
    "So how do I use it day to day?",
    "Keep savings in the vault and give your everyday wallet a small budget (for example 1 SOL a week). Phantom signs normal transactions within that budget; anything bigger needs the hash signature. Losing the phone costs at most what is left of the budget.",
  ],
  [
    "Do I get a new address after every withdrawal?",
    "No. One vault address holds up to 3 signer trees of 256 one-time keys plus an optional recovery tree, so the same address serves hundreds of actions. When keys run low, migrate to a new vault with one signature.",
  ],
  [
    "Can several people share a vault?",
    "Yes. A vault can have up to 3 signer trees (each from its own 24 words) and a threshold: 2-of-3 means two different phrases must approve exactly the same action before it executes.",
  ],
  [
    "What if I lose the 24 words?",
    <>
      Without a recovery key or co-signers: the funds are gone. With a recovery key: once the signers have been inactive for the
      recovery delay, the recovery phrase gets full control. With a testament: after its delay the heirs receive everything. Make
      backups on <Link href="/backup">/backup</Link> in addition to paper.
    </>,
  ],
  [
    "What are the whitelist, instant limit and delay?",
    "Up to 4 trusted addresses receive withdrawals immediately. Other destinations get at most the instant limit of SOL per 24 h straight away; anything more waits out the delay as a pending withdrawal that a signer or the recovery key can cancel, or is refused when the delay is 0.",
  ],
  [
    "What is the testament?",
    "Up to 4 heirs with shares. If no signer acts for the testament delay (365 days by default), anyone can split all SOL and tokens among the heirs; a keeper does it automatically. A Ping is enough to show you are alive.",
  ],
  [
    "What are invoice addresses?",
    "Extra deposit addresses derived from your vault, one per id. Give each customer their own; anyone can sweep them into the vault. You get per-payer accounting without publishing the vault address.",
  ],
  [
    "Does it support tokens?",
    "Yes, everywhere: SPL and Token-2022 for withdrawals, rules, schedules, budgets, testament, migration, invoices and the Escape Hatch. Token-2022 mints with transfer fees, hooks, permanent delegates, confidential transfers or non-transferable tokens are refused.",
  ],
  [
    "What is the Escape Hatch?",
    <>
      A fire exit for your ordinary wallet. Link it to your vault, let the hatch move your tokens (a delegate) and pre-sign a
      never-expiring transaction that moves your SOL. If you press panic or the quantum canary trips, everything in the wallet is
      pushed into your vault. Set it up on <Link href="/escape">/escape</Link>.
    </>,
  ],
  [
    "Is the Escape Hatch a guarantee?",
    "No. It protects the moment it is triggered and races whoever broke the key. If an attacker moves first, it is too late. Tokens you receive later need approving again, and a stored SOL escape is voided when the wallet's nonce is used for something else. Keep most funds in the vault itself.",
  ],
  [
    "Anyone can broadcast my stored SOL escape?",
    "Yes, by design: that is what lets keepers act for you. It can only move your wallet's SOL into your own linked vault, so the worst a stranger can do is send it early; getting the SOL out of the vault then takes your hash signature.",
  ],
  [
    "What is the link / registry entry?",
    "When your wallet links to a vault it signs a timestamped on-chain record: proof, made while ed25519 is still safe, that this wallet belongs to that vault. Changing it takes 30 days and is impossible after the canary trips.",
  ],
  [
    "What is the quantum canary?",
    <>
      A bounty on an ed25519 address that nobody has a key for (it is a hash that happens to be a curve point). Only breaking ed25519
      can move it; if it moves, anyone can trip the canary and keepers evacuate all linked wallets. See{" "}
      <Link href="/canary">/canary</Link>, where you can recompute the address in your browser.
    </>,
  ],
  [
    "How exposed is my wallet?",
    <>
      Paste it into the <Link href="/scan">scanner</Link>: it shows what sits on that ed25519 key and whether the Escape Hatch covers
      it.
    </>,
  ],
  [
    "Can the relayer or the keeper steal or redirect funds?",
    "No. The destination, amount, fee and everything else are inside the signed message, and permissionless instructions only do what the vault's rules already allow. They can refuse or be slow; then anyone, you included, can send the same transactions.",
  ],
  [
    "How often does the keeper run?",
    "The site's keeper runs once a day (a Vercel cron). A long-running keeper (bot/) can run every minute. Schedules and testaments therefore pay out after they are due, not at the exact second, unless you or someone else runs them earlier.",
  ],
  [
    "Can I keep my words off the internet entirely?",
    <>
      Yes. Sign on a device that stays offline with <Link href="/offline">/offline</Link>, then carry the result back as QR codes or
      text and submit it on <Link href="/submit">/submit</Link>. The signed result holds no secret.
    </>,
  ],
  [
    "Is this quantum-proof today?",
    "Moving funds out of a vault needs only hash-based signatures, so a quantum computer breaking ed25519 does not open it. Wallets, session keys, validators and other programs still use elliptic curves. Noxvault protects what is inside the vault, and offers the Escape Hatch for what is not.",
  ],
  [
    "Is it audited?",
    <>
      No. It runs on devnet and has not been reviewed by anyone outside the team. See <Link href="/risks">risks</Link>.
    </>,
  ],
  [
    "What is $NOX?",
    "Planned, not live. The idea: holders above a threshold relay for free. The contract address is not known yet. Ignore anyone sending you one before that.",
  ],
];

export default function Faq() {
  return (
    <div>
      <PageHead
        kicker="06 // faq"
        title={
          <>
            Frequently asked <span className="inv">questions</span>
          </>
        }
      />
      <div className="flex max-w-[820px] flex-col border-t border-line">
        {QA.map(([q, a], i) => (
          <details key={i} className="group border-b border-line" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-start gap-4 py-4 text-[14px] hover:text-teal [&::-webkit-details-marker]:hidden">
              <span className="pt-0.5 text-[10px] text-dim">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1">{q}</span>
              <span className="text-dim group-open:rotate-45 transition-transform">+</span>
            </summary>
            <div className="pb-5 pl-8 text-[13px] text-mute [&_a]:underline [&_a]:decoration-dotted [&_strong]:text-bone">{a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
