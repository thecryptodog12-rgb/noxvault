import type { Metadata } from "next";
import { PageHead, Panel } from "@/components/ui";
import { NETWORK } from "@/lib/config";

export const metadata: Metadata = { title: "Risks — Noxvault" };

const RISKS = [
  {
    t: "Unaudited",
    d: "The program, SDK, relayer, keeper and this site have not been audited or formally reviewed. Bugs could lock or lose funds. Assume they exist.",
  },
  {
    t: `${NETWORK === "mainnet-beta" ? "Early mainnet" : "Devnet only"}`,
    d: "Noxvault v3 runs on devnet. Devnet can be reset and devnet SOL has no value. The program is still upgradeable; the upgrade authority is to be burned only at mainnet launch.",
  },
  {
    t: "Your words are the vault",
    d: "Anyone with enough signer phrases (the threshold) controls the vault, limited only by the whitelist, instant limit and delay, and by your recovery key. Without a recovery key, co-signers or heirs, lost words mean lost funds.",
  },
  {
    t: "Escape Hatch is a race",
    d: "It protects the moment it is triggered. If someone breaks your wallet key and moves first, it is too late. Tokens received after approving are not covered until you approve again, and using the wallet's nonce account voids the stored SOL escape. Keep most funds in the vault itself.",
  },
  {
    t: "The stored SOL escape is public",
    d: "Anyone can broadcast it at any time. It can only move your wallet's SOL into your own linked vault, but that can happen when you did not plan it; getting the SOL back out then needs a hash signature.",
  },
  {
    t: "The canary is an alarm, not a guarantee",
    d: "Someone who can break ed25519 may never touch the bounty, and does not need to in order to attack your wallet. Use panic when in doubt; it does not wait for the canary.",
  },
  {
    t: "Session keys are ordinary keys",
    d: "A budget's session key (Phantom, a phone wallet) is ed25519. Whoever holds it can spend up to the budget every period until it expires. Keep budgets small and short, and cancel lost ones.",
  },
  {
    t: "Recovery, co-signers and heirs",
    d: "Whoever holds the recovery phrase can cancel your pending withdrawals any time, and takes full control after the recovery delay of inactivity. Heirs receive everything after the testament delay. Choose holders and delays with care, and ping if you go quiet for long.",
  },
  {
    t: "Keepers are best-effort",
    d: "The site's keeper runs once a day; a long-running keeper may run more often or not at all. Due schedules, testaments, migrations and escapes happen when someone sends them. Anyone, you included, can.",
  },
  {
    t: "Browser signing",
    d: "Keys are derived and used inside this web page. A malicious extension, a compromised device or a tampered copy of the site could steal the words. Use a trusted device and the real domain, or sign on an offline device with /offline.",
  },
  {
    t: "Never reuse a key",
    d: "A one-time key may sign one message, ever. The app reads the vault's whole history before signing and refuses if it cannot. Offline signing cannot read the chain: always take the leaf from a fresh prepare step and never sign a different action with the same leaf. Other tools may not follow this rule.",
  },
  {
    t: "Tokens can be frozen by their issuer",
    d: "A token with a freeze authority can be frozen in the vault, a wallet or an heir's account by its issuer. Tokens with transfer fees, hooks, permanent delegates or confidential transfers are not supported.",
  },
  {
    t: "Only the vault is post-quantum",
    d: "Wallets, session keys, validators and other programs still use elliptic-curve cryptography. Noxvault protects what is locked inside a vault, not everything around it.",
  },
  {
    t: "Not financial advice",
    d: "Nothing here is investment advice or an offer of anything. $NOX is planned but does not exist yet; ignore anyone selling it.",
  },
];

export default function Risks() {
  return (
    <div>
      <PageHead
        kicker="07 // risks"
        title={
          <>
            Risks &amp; <span className="inv">disclaimer</span>
          </>
        }
        sub="Hash-based signatures fix one specific threat. They do not make experimental software safe. Here is what can go wrong."
      />
      <div className="grid [&>*]:min-w-0 gap-3 md:grid-cols-2">
        {RISKS.map((r, i) => (
          <Panel key={r.t} className="p-5" lit={i === 0}>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] text-dim">R{String(i + 1).padStart(2, "0")}</span>
              <h2 className="font-display text-[17px]">{r.t}</h2>
            </div>
            <p className="mt-3 text-[12.5px] text-mute">{r.d}</p>
          </Panel>
        ))}
      </div>
    </div>
  );
}
