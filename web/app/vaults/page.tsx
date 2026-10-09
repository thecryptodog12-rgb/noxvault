import type { Metadata } from "next";
import { Suspense } from "react";
import Explorer from "./Explorer";

export const metadata: Metadata = { title: "Explorer — Noxvault" };

export default function Page() {
  return (
    <Suspense>
      <Explorer />
    </Suspense>
  );
}
