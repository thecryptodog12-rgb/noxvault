import type { Metadata } from "next";
import { Suspense } from "react";
import { pageMeta } from "@/lib/meta";
import Scanner from "./Scanner";

export const metadata: Metadata = pageMeta(
  "Quantum exposure scanner — Noxvault",
  "On Solana the address is the public key. Paste any address and see how much value sits behind that one ed25519 key."
);

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Scanner />
    </Suspense>
  );
}
