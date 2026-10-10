import type { Metadata } from "next";
import Stats from "./Stats";

export const metadata: Metadata = { title: "Stats — Noxvault" };

export default function Page() {
  return <Stats />;
}
