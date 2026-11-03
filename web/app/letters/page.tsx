import type { Metadata } from "next";
import { Clock, FileLock2, KeyRound, RefreshCw } from "lucide-react";
import LettersOwner from "./LettersOwner";

export const metadata: Metadata = {
  title: "Sealed letters — Noxvault",
  description: "Letters to your heirs, encrypted to a future date with drand timelock encryption and stored with your vault. They open around the time your testament runs.",
};

const STEPS = [
  { Icon: KeyRound, t: "Authorize a letter key", d: "Your phrase signs one action that lets a separate, ordinary key write your vault's letters. That key can never move funds." },
  { Icon: FileLock2, t: "Seal a letter to a date", d: "Your browser encrypts the letter to a future drand round (timelock encryption). Nobody can read it before then: not Noxvault, not your heirs, not you." },
  { Icon: RefreshCw, t: "It keeps moving forward", d: "Each time you open your vault, the app re-seals your letters to a later date. While you are active, the date never arrives." },
  { Icon: Clock, t: "When you stop, it opens", d: "If you stop being active, the last date stands: about your testament delay plus 7 days. Then anyone with the link can read it." },
];

export default function Page() {
  return (
    <div className="flex max-w-[1100px] flex-col gap-8">
      <div className="max-w-[900px]">
        <div className="label text-teal">new in v4 // sealed letters</div>
        <h1 className="mt-3 text-[36px] font-bold leading-tight sm:text-[48px]">
          Words for <span className="text-teal">after</span>
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-bone/85">
          Your testament moves funds, but heirs also need to know things: other wallets, where documents are, what to do first. Today that means trusting someone with it, or a
          notary. Sealed letters are encrypted to a moment in the future and stored on chain next to your vault, so they open by themselves when you are gone.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        {STEPS.map(({ Icon, t, d }, i) => (
          <div key={t} className="panel p-5">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-teal">0{i + 1}</span>
              <Icon size={22} strokeWidth={1.4} className="text-teal" />
            </div>
            <div className="mt-3 text-[15px] font-bold">{t}</div>
            <p className="mt-1.5 text-[13px] leading-6 text-mute">{d}</p>
          </div>
        ))}
      </div>

      <div className="panel border-warn/40 p-5 text-[13px] leading-6 text-mute">
        <div className="mb-1 font-bold text-warn">Know the limits</div>
        <ul className="list-disc pl-5">
          <li>
            A letter opens at its date <span className="text-bone">even if you are alive</span> and simply did not open your vault in time. The app re-seals on every visit; if you
            stay away longer than the testament delay plus 7 days, the letter opens.
          </li>
          <li>
            After its date, <span className="text-bone">anyone</span> who has the letter (it is public on chain) can read it, unless you also lock it with a passphrase that only
            your heir knows. The label is never encrypted.
          </li>
          <li>
            Re-sealing needs the text, so this browser keeps a copy of your letters, encrypted under a key derived from your phrase. Someone with your phrase and this browser
            can read them. Clearing this browser&apos;s storage loses the copy: the letters on chain stay, but can no longer be moved forward.
          </li>
          <li>
            The letter key lives in this browser too. If it leaks, someone can overwrite or delete your letters (never move funds). Authorize a new key to replace it.
          </li>
          <li>Opening dates come from drand, a public randomness network run by many independent operators. If drand stopped, letters could not be opened. Unaudited, devnet.</li>
        </ul>
      </div>

      <LettersOwner />
    </div>
  );
}
