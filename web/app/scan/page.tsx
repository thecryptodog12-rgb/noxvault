import type { Metadata } from "next";
import { Suspense } from "react";
import Scanner from "./Scanner";

export const metadata: Metadata = { title: "Quantum exposure scanner — Noxvault" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Scanner />
    </Suspense>
  );
}
