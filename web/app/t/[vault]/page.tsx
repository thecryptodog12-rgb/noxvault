import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import TreasuryView from "./TreasuryView";

export async function generateMetadata({ params }: { params: Promise<{ vault: string }> }): Promise<Metadata> {
  const { vault } = await params;
  return pageMeta(`Treasury ${vault.slice(0, 4)}…${vault.slice(-4)} — Noxvault`, "Treasury rules enforced on-chain, checked live: signers, delays, recovery and pending payouts.", { siteImage: false });
}

export default async function Page({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  return <TreasuryView vault={vault} />;
}
