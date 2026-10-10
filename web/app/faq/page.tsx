import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "FAQ — Noxvault" };

const QA: [string, React.ReactNode][] = [
  [
    "Can my Phantom wallet open my vault?",
    "No. A wallet can deposit and, if you like, pay transaction fees. Moving anything out needs a one-time signature made from your 24 words, and no wallet key can produce it.",
  ],
  [
    "Do I get a new address after every withdrawal?",
    "No, not in v2. One vault address holds 256 one-time keys in a Merkle tree, so the same address serves 256 actions (withdrawals, stakes, pings…). The vault tracks which keys are used.",
  ],
  [
    "What if I lose the 24 words?",
    <>
      Without a recovery key: the funds are gone, there is no reset and no backdoor. With a recovery key: once your primary key
      has been inactive for the recovery delay, the recovery phrase gets full control. Make backups on{" "}
      <Link href="/backup">/backup</Link> (Shamir shares or an encrypted file) in addition to paper.
    </>,
  ],
  [
    "What does the recovery key do?",
    "It is a second phrase, ideally held by someone else. It can cancel a pending withdrawal at any time, and after the primary has been silent for the recovery delay (180 days by default) it can do everything. A ping from the primary resets that timer.",
  ],
  [
    "What are the whitelist and the delay for?",
    "Up to 4 trusted addresses receive withdrawals immediately. Withdrawals anywhere else are either refused or wait out a delay, during which either key can cancel them. A thief with your words then cannot drain the vault quietly.",
  ],
  [
    "Do I need SOL in a wallet to withdraw?",
    <>
      No. Sign with a small fee to the relayer: it pays the network fees and is repaid by the vault when the action executes.
      Or send it yourself with any wallet, from <Link href="/submit">/submit</Link>.
    </>,
  ],
  [
    "Can the relayer steal or redirect my funds?",
    "No. The destination, amount, fee and everything else are inside the signed message; change one byte and verification fails. The relayer can only refuse or be slow, and then you send the same signed action yourself.",
  ],
  [
    "Can I keep my words off the internet entirely?",
    <>
      Yes. Look up the next key on <Link href="/submit">/submit</Link>, sign on a device that stays offline with{" "}
      <Link href="/offline">/offline</Link>, then carry the result back as QR codes or text and submit it. The signed result
      holds no secret.
    </>,
  ],
  [
    "Why does an action take several transactions?",
    "A signature is 1,376 bytes and verifying it can take ~8,700 hashes. Neither fits one Solana transaction, so the work is split: open a buffer, write the signature, verify the chains, execute. Each step is safe to retry.",
  ],
  [
    "What happens if my browser closes in the middle?",
    <>
      Come back to <Link href="/mine">my vaults</Link> with the same words. The app reads the vault&apos;s whole history; if a
      key published part of a signature, only that same action can be completed with it. It resumes with exactly the same
      parameters, on any device, and never signs a different message with that key.
    </>,
  ],
  [
    "Can I stake from a vault?",
    "Yes. The vault delegates to a validator through stake accounts it controls itself. Unstake, then collect the SOL back into the vault an epoch later. Every step is a hash-signed action.",
  ],
  [
    "Does it support tokens?",
    "Yes: SPL and Token-2022 tokens sent to the vault's token account. Tokens with transfer fees, hooks or permanent delegates are refused.",
  ],
  [
    "Is this quantum-proof today?",
    "Moving funds out of a vault needs only hash-based signatures, so a quantum computer breaking ed25519 does not open it. The rest of Solana (wallets, validators, other programs) still uses elliptic curves. Noxvault protects what is inside the vault.",
  ],
  [
    "Is it audited?",
    <>
      No. It runs on devnet and has not been reviewed by anyone outside the team. See <Link href="/risks">risks</Link>.
    </>,
  ],
  [
    "What is $NOX?",
    "Planned, not live. The idea: holders above a threshold relay for free. The contract address is not known yet and will appear in the sidebar once it exists. Ignore anyone sending you one before that.",
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
            <div className="pb-5 pl-8 text-[13px] text-mute [&_a]:underline [&_a]:decoration-dotted">{a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
