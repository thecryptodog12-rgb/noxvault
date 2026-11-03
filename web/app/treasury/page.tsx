import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import TreasuryIndex from "./TreasuryIndex";

export const metadata: Metadata = pageMeta(
  "Treasuries — Noxvault",
  "Public, live proof of a project's treasury rules: signers, delays, vesting and pending payouts, enforced on-chain."
);

export default function Page() {
  return <TreasuryIndex />;
}
