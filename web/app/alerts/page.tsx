import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, Hourglass, Mail, Repeat, Siren } from "lucide-react";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = pageMeta(
  "Telegram alerts — Noxvault",
  "A Telegram bot that watches your vault on-chain and tells you about pending withdrawals, lockdowns, running clocks and letters about to open."
);

const BOT = (process.env.NEXT_PUBLIC_TELEGRAM_BOT || "").replace(/^@/, "").trim();

const ALERTS = [
  { Icon: BellRing, t: "A new pending withdrawal", d: "Amount, destination and when it executes. If it is not you, your recovery key can cancel it before then." },
  { Icon: Siren, t: "Lockdown started", d: "The duress phrase was used. Recovery contacts hear about it at once, so they can check on the owner." },
  { Icon: Hourglass, t: "A clock running out", d: "14, 3 and 1 day before the recovery key can take over or the testament can run. One ping resets it." },
  { Icon: Mail, t: "A sealed letter about to open", d: "When a letter's date is less than 7 days away, so the owner can re-seal it to a later date." },
  { Icon: Repeat, t: "Scheduled payouts that ran", d: "Each time a vesting or salary schedule pays out." },
];

export default function Page() {
  return (
    <div className="flex max-w-[900px] flex-col gap-8">
      <div>
        <div className="label text-teal">alerts // telegram</div>
        <h1 className="mt-3 text-[36px] font-bold leading-tight sm:text-[48px]">
          Know <span className="text-teal">before</span> it executes
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-bone/85">
          A delay only protects you if someone notices in time. The Noxvault bot watches vaults on-chain and messages you when something needs attention. Owners, recovery contacts
          and heirs can each watch the same vault from their own chat.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0" data-reveal-group>
        {ALERTS.map(({ Icon, t, d }) => (
          <div key={t} data-reveal className="panel glow p-5">
            <Icon size={22} strokeWidth={1.4} className="text-teal" />
            <div className="mt-3 text-[15px] font-bold">{t}</div>
            <p className="mt-1.5 text-[13px] leading-6 text-mute">{d}</p>
          </div>
        ))}
      </div>

      <div data-reveal className="panel p-5 text-[13px] leading-6 text-mute">
        <div className="mb-2 text-[15px] font-bold text-bone">How to use it</div>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Open the bot in Telegram and send /start.</li>
          <li>
            Send <code className="text-bone">/watch &lt;vault address&gt;</code>. Up to 5 vaults per chat.
          </li>
          <li>
            <code className="text-bone">/status &lt;vault&gt;</code> shows balance, pending payout, lockdown, clocks and letter dates. <code className="text-bone">/list</code> and{" "}
            <code className="text-bone">/unwatch</code> manage your list.
          </li>
        </ol>
      </div>

      <div data-reveal className="panel border-warn/40 p-5 text-[13px] leading-6 text-mute">
        <div className="mb-1 font-bold text-warn">What it does not do</div>
        The bot only reads public on-chain data. It never asks for your phrase, recovery code or any key, and it cannot move or cancel anything: you still act with your own keys.
        Checks run on a schedule, so an alert can arrive some time after the event; do not rely on it for delays shorter than a day. Anyone can watch any vault, because vault
        state is public. Telegram knows which chat watches which address. Unaudited, devnet.
      </div>

      <div className="flex flex-wrap gap-3">
        {BOT ? (
          <a href={`https://t.me/${BOT}`} target="_blank" rel="noreferrer" className="btn">
            Open @{BOT} <ArrowRight size={15} />
          </a>
        ) : (
          <span className="self-center text-[12.5px] text-mute">The bot link appears here once the bot is live.</span>
        )}
        <Link href="/duress" className="btn ghost">
          About duress mode
        </Link>
      </div>
    </div>
  );
}
