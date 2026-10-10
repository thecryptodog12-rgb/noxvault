import type { Metadata } from "next";
import Canary from "./Canary";

export const metadata: Metadata = { title: "Quantum canary — Noxvault" };

export default function Page() {
  return <Canary />;
}
