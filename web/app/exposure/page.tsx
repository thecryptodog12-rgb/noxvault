import { redirect } from "next/navigation";

// The scanner itself lives at /scan; /exposure/<address> is its shareable result page.
export default function Page() {
  redirect("/scan");
}
