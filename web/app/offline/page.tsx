import type { Metadata } from "next";
import OfflineSigner from "./OfflineSigner";

export const metadata: Metadata = { title: "Offline signing — Noxvault" };

export default function Page() {
  return <OfflineSigner />;
}
