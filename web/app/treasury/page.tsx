import type { Metadata } from "next";
import TreasuryIndex from "./TreasuryIndex";

export const metadata: Metadata = {
  title: "Treasuries — Noxvault",
  description: "Public, live proof of a project's treasury rules: signers, delays, vesting and pending payouts, enforced on-chain.",
};

export default function Page() {
  return <TreasuryIndex />;
}
