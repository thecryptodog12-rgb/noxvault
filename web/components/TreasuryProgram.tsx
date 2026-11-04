// Steps of the treasury program for token projects: shown on /treasury and /for-projects.
import Link from "next/link";
import type { ReactNode } from "react";

export const PROGRAM_STEPS: { k: string; t: string; d: ReactNode }[] = [
  {
    k: "01",
    t: "preset",
    d: (
      <>
        Open <Link href="/create" className="underline">create</Link> and pick the <span className="text-bone">Vesting treasury</span>,{" "}
        <span className="text-bone">Team multisig</span> or <span className="text-bone">DAO treasury</span> preset: 2 of 3 signers or a single DAO destination,
        a recovery key and a public delay. Multi-signer vaults need the Sentinel tier ($NOX held in the vault).
      </>
    ),
  },
  {
    k: "02",
    t: "fund",
    d: "Move the treasury, team tokens or LP tokens into the vault address. Add a schedule per team member for vesting; schedules pay out on fixed dates.",
  },
  {
    k: "03",
    t: "badge",
    d: "Your treasury gets a public page at /t/<vault> with an embed snippet. Put the badge on your site so holders can check the rules themselves.",
  },
];

export function ProgramSteps() {
  return (
    <ol className="grid gap-px bg-line md:grid-cols-3">
      {PROGRAM_STEPS.map((s) => (
        <li key={s.k} className="bg-ink p-4 sm:p-5">
          <div className="text-[11px] text-dim">{s.k}</div>
          <div className="mt-1 text-[18px] font-bold uppercase text-teal">{s.t}</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mute">{s.d}</p>
        </li>
      ))}
    </ol>
  );
}
