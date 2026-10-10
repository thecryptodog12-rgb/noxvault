import type { Metadata } from "next";
import Backup from "./Backup";

export const metadata: Metadata = { title: "Backups — Noxvault" };

export default function Page() {
  return <Backup />;
}
