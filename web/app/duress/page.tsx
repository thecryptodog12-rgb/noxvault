import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import Link from "next/link";
import { ArrowRight, EyeOff, Lock, Siren, Wallet } from "lucide-react";

export const metadata: Metadata = pageMeta(
  "Duress mode — Noxvault",
  "A second phrase for when someone forces you to open your vault: it pays a small amount at once and locks the rest for days."
);

const STEPS = [
  { Icon: Wallet, t: "Hand over the duress phrase", d: "Under threat, you open your vault with your second phrase. The app shows only your duress limit as the balance." },
  { Icon: ArrowRight, t: "A small payout goes through", d: "The attacker's withdrawal is paid at once, up to your limit (default 0.5 SOL), even to an unknown address. The encounter can end." },
  { Icon: Lock, t: "Everything else locks", d: "The vault locks for days (default 3). Withdrawals, pending payouts and session budgets are refused, even with your real phrase." },
  { Icon: Siren, t: "Your recovery contact decides", d: "Only your recovery key can end the lockdown early. The bot can alert your contacts silently." },
];

export default function Page() {
  return (
    <div className="flex max-w-[900px] flex-col gap-8">
      <div>
        <div className="label text-teal">new in v4 // duress mode</div>
        <h1 className="mt-3 text-[36px] font-bold leading-tight sm:text-[48px]">
          A phrase for the <span className="text-teal">worst day</span>
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-bone/85">
          Physical attacks on crypto holders (&quot;wrench attacks&quot;) keep rising. A normal wallet gives the attacker everything. Delays protect your funds but can keep you in danger
          for as long as they last. Duress mode gives the attacker something that works right away, and locks the rest.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0" data-reveal-group>
        {STEPS.map(({ Icon, t, d }, i) => (
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

      <div data-reveal className="panel p-5">
        <div className="flex items-center gap-3">
          <EyeOff size={22} strokeWidth={1.4} className="text-teal" />
          <div className="rv-glitch text-[15px] font-bold">Nobody can tell whether you have one</div>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-mute">
          Every v4 vault carries a duress key slot. Vaults without a duress phrase get a decoy that has no key. From the outside all vaults look the same, so an attacker cannot
          know whether the phrase you give is the real one.
        </p>
      </div>

      <div data-reveal className="panel border-warn/40 p-5 text-[13px] leading-6 text-mute">
        <div className="rv-glitch mb-1 font-bold text-warn">What it does not do</div>
        Someone who reads your vault&apos;s on-chain state can see that it locked. Duress mode caps the loss and ends the encounter; it does not make the lockdown invisible. SOL only;
        tokens stay locked. Unaudited, devnet.
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/create" className="btn">
          Create a vault <ArrowRight size={15} />
        </Link>
        <span className="self-center text-[12.5px] text-mute">Live on devnet. In Create, choose “make a duress phrase”; opening My vaults with it shows the duress view.</span>
      </div>
    </div>
  );
}
