// Solana Action that sends people to /create. Creating a vault needs a phrase generated and kept
// on the user's own device, so this Blink is a link, never a transaction.
import type { ActionGetResponse, ActionPostResponse } from "@solana/actions";
import { NETWORK } from "@/lib/config";
import { actionJson, actionOptions, originOf } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = originOf(req);
  const body: ActionGetResponse = {
    type: "action",
    icon: `${origin}/vault.png`,
    title: "Create a Noxvault",
    description:
      "A Solana vault whose funds move only with hash-based one-time signatures (WOTS+), with an optional recovery key, duress phrase, testament and sealed letters. " +
      `Your phrase is made in your own browser and never leaves it, so creating happens on the site, not in this card. Unaudited${NETWORK === "mainnet-beta" ? "" : `; live on ${NETWORK}`}.`,
    label: "Create a vault",
    links: { actions: [{ type: "external-link", label: "Create a vault", href: `${origin}/api/actions/create` }] },
  };
  return actionJson(body);
}

export const OPTIONS = actionOptions;

export function POST(req: Request) {
  const body: ActionPostResponse = { type: "external-link", externalLink: `${originOf(req)}/create`, message: "Opening the create page." };
  return actionJson(body);
}
