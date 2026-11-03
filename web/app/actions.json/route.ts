// actions.json (Solana Actions spec): maps site URLs to Action endpoints, so a link to
// /t/<vault> or /fund/<vault> unfurls as a "Fund this Noxvault" Blink, and /create as the create Blink.
import type { ActionsJson } from "@solana/actions";
import { actionJson, actionOptions } from "@/lib/actions";

export const dynamic = "force-static";

export function GET() {
  const body: ActionsJson = {
    rules: [
      { pathPattern: "/fund/*", apiPath: "/api/actions/fund/*" },
      { pathPattern: "/t/*", apiPath: "/api/actions/fund/*" },
      { pathPattern: "/create", apiPath: "/api/actions/create" },
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  };
  return actionJson(body);
}

export const OPTIONS = actionOptions;
