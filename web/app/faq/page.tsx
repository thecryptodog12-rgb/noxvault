import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "FAQ — Noxvault" };

const QA: [string, React.ReactNode][] = [
  [
    "Can my Phantom wallet open my vault?",
    "No. Your wallet sends deposits and pays transaction fees. Opening a vault needs a one-time signature made from your 24 words, and no wallet key can produce it.",
  ],
  [
    "What if I lose the 24 words?",
    "Then the funds are gone. There is no reset, no support desk and no backdoor. Write them on paper and keep it safe.",
  ],
  [
    "Why does a withdrawal take several transactions?",
    "A WOTS+ signature is 1,088 bytes and verifying it can take ~8,700 hashes. Neither fits in one Solana transaction, so the work is split: open the buffer and write the signature, then verify the chains and pay out. Usually 2 approvals, sometimes 3; each step is safe to retry.",
  ],
  [
    "Why does every withdrawal move the rest to a new vault?",
    "Each key can safely sign exactly one message. After it signs, it is marked spent, and whatever you did not withdraw moves to your next fresh vault, which has an unused key.",
  ],
  [
    "What happens if my browser closes in the middle of an unlock?",
    <>
      Come back to <Link href="/mine">my vaults</Link> with the same words. The page remembers the frozen message (and reads it
      back from the chain if needed) and continues with exactly the same parameters. It will never sign a different message with
      that key.
    </>,
  ],
  [
    "Can someone front-run or redirect my unlock?",
    "The destination, amount and next vault are part of the signed message. Anyone can help push verify and finish forward, but the money can only go where the signature says.",
  ],
  [
    "Does it support tokens?",
    "Yes: SPL and Token-2022 tokens. Send them to the vault's token account (owner = the vault). Each unlock withdraws one asset; the other assets can be swept to the next vault afterwards.",
  ],
  [
    "Is my vault private?",
    "A vault looks like any other Solana address until it is registered or unlocked. Registering lists it in the explorer. Unlocking reveals on-chain that it was a Noxvault and where funds went.",
  ],
  [
    "Is this quantum-proof today?",
    "Opening a vault needs only a hash-based signature, so a quantum computer breaking ed25519 does not open it. But the rest of Solana (your wallet, validators, other programs) still uses elliptic curves. Noxvault protects what is inside the vault.",
  ],
  [
    "Is it audited?",
    <>
      No. It runs on devnet and has not been reviewed by anyone outside the team. See <Link href="/risks">risks</Link>.
    </>,
  ],
  ["What is $NOX?", "Nothing yet. The contract address will appear in the sidebar if and when it exists. Ignore anyone sending you one before that."],
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
            <div className="pb-5 pl-8 text-[13px] text-mute [&_a]:underline [&_a]:decoration-dotted">{a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
