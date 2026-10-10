import type { Metadata } from "next";
import Cosign from "./Cosign";

export const metadata: Metadata = { title: "Co-signer & recovery codes — Noxvault" };

export default function Page() {
  return <Cosign />;
}
