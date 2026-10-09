import type { Metadata } from "next";
import CreateVault from "./CreateVault";

export const metadata: Metadata = { title: "Create vault — Noxvault" };

export default function Page() {
  return <CreateVault />;
}
