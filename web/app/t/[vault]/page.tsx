import type { Metadata } from "next";
import TreasuryView from "./TreasuryView";

export async function generateMetadata({ params }: { params: Promise<{ vault: string }> }): Promise<Metadata> {
  const { vault } = await params;
  return { title: `Treasury ${vault.slice(0, 4)}…${vault.slice(-4)} — Noxvault`, description: "Treasury rules enforced on-chain, checked live." };
}

export default async function Page({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  return <TreasuryView vault={vault} />;
}
