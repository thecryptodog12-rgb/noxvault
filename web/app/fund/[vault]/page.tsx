import { redirect } from "next/navigation";

// /fund/<vault> is the shareable Blink URL (see app/actions.json). In a normal browser it
// shows the vault's public treasury page, where the rules are explained in full.
export default async function Page({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  redirect(`/t/${encodeURIComponent(vault)}`);
}
