import type { Metadata } from "next";
import { PageHead, Panel } from "@/components/ui";
import { NETWORK } from "@/lib/config";

export const metadata: Metadata = { title: "Risks — Noxvault" };

const RISKS = [
  {
    t: "Unaudited",
    d: "The program, SDK and this site have not been audited or formally reviewed. Bugs could lock or lose funds. Assume they exist.",
  },
  {
    t: "You hold the only secret",
    d: "The 24 words are the vault. Lose them and nothing can recover the funds. Leak them and anyone can withdraw everything, in every vault they derive.",
  },
  {
    t: "Browser signing",
    d: "Keys are derived and used inside this web page. A malicious browser extension, a compromised device or a tampered copy of this site could steal the words. Only use it on a device you trust and on the real domain.",
  },
  {
    t: "Never reuse a key",
    d: "A WOTS+ key may sign one message, ever. This site enforces that (it freezes the message before sending and resumes with the same one), and the program refuses a second unlock. Do not try to work around it with other tools.",
  },
  {
    t: `${NETWORK === "mainnet-beta" ? "Early mainnet" : "Devnet first"}`,
    d: "Noxvault currently runs on devnet. Devnet can be reset, and devnet SOL has no value. The program is still upgradeable; the upgrade authority is to be burned only at mainnet launch.",
  },
  {
    t: "Only the vault is post-quantum",
    d: "Your wallet, the network's validators and other programs still use elliptic-curve cryptography. Noxvault protects what is locked inside a vault, not everything around it.",
  },
  {
    t: "Remembered words",
    d: "If you tick “remember in this browser”, the words sit unencrypted in session or local storage. Convenient, and readable by anything that can run script on this site.",
  },
  {
    t: "Not financial advice",
    d: "Nothing here is investment advice or an offer of anything. $NOX does not exist yet; ignore anyone selling it.",
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
