import type { Metadata } from "next";
import MyVaults from "./MyVaults";

export const metadata: Metadata = { title: "My vaults — Noxvault" };

export default function Page() {
  return <MyVaults />;
}
