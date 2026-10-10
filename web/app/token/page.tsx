import type { Metadata } from "next";
import { Suspense } from "react";
import Token from "./Token";

export const metadata: Metadata = { title: "$NOX — Noxvault", description: "What $NOX does: tiers held inside your vault, Q-Day priority, fee waivers and governance." };

export default function Page() {
  return (
    <Suspense>
      <Token />
    </Suspense>
  );
}
