import type { Metadata } from "next";
import EscapeHatch from "./EscapeHatch";

export const metadata: Metadata = { title: "Escape Hatch — Noxvault" };

export default function Page() {
  return <EscapeHatch />;
}
