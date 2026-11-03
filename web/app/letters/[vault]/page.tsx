import type { Metadata } from "next";
import LetterReader from "./LetterReader";

export async function generateMetadata({ params }: { params: Promise<{ vault: string }> }): Promise<Metadata> {
  const { vault } = await params;
  return { title: `Sealed letters ${vault.slice(0, 4)}…${vault.slice(-4)} — Noxvault`, description: "Letters sealed to a future date. Each opens by itself once its date has passed." };
}

export default async function Page({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  return <LetterReader vault={vault} />;
}
