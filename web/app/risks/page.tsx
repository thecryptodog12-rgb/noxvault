import type { Metadata } from "next";
import { PageHead, Panel } from "@/components/ui";
import { NETWORK } from "@/lib/config";

export const metadata: Metadata = { title: "Risks — Noxvault" };

const RISKS = [
  {
    t: "Unaudited",
    d: "The program, SDK, relayer and this site have not been audited or formally reviewed. Bugs could lock or lose funds. Assume they exist.",
  },
  {
    t: `${NETWORK === "mainnet-beta" ? "Early mainnet" : "Devnet only"}`,
    d: "Noxvault v2 runs on devnet. Devnet can be reset and devnet SOL has no value. The program is still upgradeable; the upgrade authority is to be burned only at mainnet launch.",
  },
  {
    t: "Your words are the vault",
    d: "Anyone with your primary words controls the vault, subject only to the whitelist delay and your recovery key. Without a recovery key, lost words mean lost funds.",
  },
  {
    t: "Browser signing",
    d: "Keys are derived and used inside this web page. A malicious extension, a compromised device or a tampered copy of the site could steal the words. Use a trusted device and the real domain, or sign on an offline device with /offline.",
  },
  {
    t: "Never reuse a key",
    d: "A one-time key may sign one message, ever. The app reads the vault's whole history before signing and refuses if it cannot. Offline signing cannot read the chain: always take the leaf from a fresh prepare step, run the checks on /submit, and never sign a different action with the same leaf. Other tools may not follow this rule.",
  },
  {
    t: "Recovery key holder",
    d: "Whoever holds the recovery phrase can cancel your pending withdrawals at any time, and takes full control if you stay inactive past the delay. Choose the holder and the delay with care, and ping if you go quiet for long.",
  },
  {
    t: "The relayer is a convenience",
    d: "It cannot change a signed action, so it is not a trust assumption for your funds. It can refuse, go offline or be slow; then submit the same signed action yourself. Its fee is paid by the vault when the action executes.",
  },
  {
    t: "Backups are only as good as you keep them",
    d: "An encrypted backup file is only as strong as its password. Shamir shares protect nothing if K of them end up in one place. Remembered words in this browser sit unencrypted in storage.",
  },
  {
    t: "Only the vault is post-quantum",
    d: "Wallets, validators and other programs still use elliptic-curve cryptography. Noxvault protects what is locked inside a vault, not everything around it.",
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
