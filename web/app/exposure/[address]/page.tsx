import type { Metadata } from "next";
import { Suspense } from "react";
import { pageMeta } from "@/lib/meta";
import Scanner from "../../scan/Scanner";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const a = decodeURIComponent(address);
  return pageMeta(
    `Quantum exposure of ${a.slice(0, 4)}…${a.slice(-4)} — Noxvault`,
    "On Solana the address is the public key. How much value sits behind this one ed25519 key, read live from the chain.",
    { siteImage: false }
  );
}

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <Suspense fallback={null}>
      <Scanner address={decodeURIComponent(address)} />
    </Suspense>
  );
}
