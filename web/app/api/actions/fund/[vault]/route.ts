// Solana Action "Fund this Noxvault": GET describes it (with the vault's on-chain rules),
// POST returns an unsigned SystemProgram transfer from the user's wallet to the vault.
import { createPostResponse, type ActionGetResponse, type ActionPostRequest } from "@solana/actions";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { fetchState, withRetry } from "@nox/sdk/client";
import { RPC_URL } from "@/lib/config";
import { rulesOf } from "@/lib/treasury";
import { readProgram } from "@/lib/program";
import { FUND_MAX_LAMPORTS, FUND_MIN_LAMPORTS, FUND_PRESETS, actionError, actionJson, actionOptions, fundDescription, originOf, solToLamports } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vault: string }> };

function parseKey(s: string): PublicKey | null {
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: Ctx) {
  const { vault } = await params;
  const key = parseKey(vault);
  if (!key) return actionError("Not a Solana address.", 400);
  const origin = originOf(req);
  try {
    // Kept to two RPC reads (state + balance): Blink clients fetch this often.
    const conn = new Connection(RPC_URL, "confirmed");
    const state = await fetchState(readProgram(conn), key);
    if (!state) return actionError("No Noxvault at this address.", 404);
    const lamports = await withRetry(() => conn.getBalance(key, "confirmed"), 4);
    const { rules, caveats } = rulesOf(state);
    const v = key.toBase58();
    const href = (amount: string) => `${origin}/api/actions/fund/${v}?amount=${amount}`;
    const body: ActionGetResponse = {
      type: "action",
      icon: `${origin}/vault.png`,
      title: `Fund Noxvault ${v.slice(0, 4)}…${v.slice(-4)}`,
      description: fundDescription(rules, caveats, lamports),
      label: "Fund",
      links: {
        actions: [
          ...FUND_PRESETS.map((a) => ({ type: "transaction" as const, label: `${a} SOL`, href: href(a) })),
          {
            type: "transaction" as const,
            label: "Send",
            href: href("{amount}"),
            parameters: [{ type: "number" as const, name: "amount", label: "Amount in SOL", required: true, min: 0.001 }],
          },
        ],
      },
    };
    return actionJson(body);
  } catch (e) {
    return actionError(`Could not read the vault: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}

export const OPTIONS = actionOptions;

export async function POST(req: Request, { params }: Ctx) {
  const { vault } = await params;
  const key = parseKey(vault);
  if (!key) return actionError("Not a Solana address.", 400);

  let body: ActionPostRequest;
  try {
    body = (await req.json()) as ActionPostRequest;
  } catch {
    return actionError("Body must be JSON with an `account`.", 400);
  }
  const account = parseKey(typeof body?.account === "string" ? body.account : "");
  if (!account) return actionError("Invalid `account`.", 400);
  if (account.equals(key)) return actionError("The vault cannot fund itself.", 400);

  const fromData = (body.data as Record<string, unknown> | undefined)?.amount;
  const raw = new URL(req.url).searchParams.get("amount") ?? (fromData == null ? null : String(fromData));
  const lamports = solToLamports(raw);
  if (lamports == null) return actionError("Enter an amount in SOL, like 0.5.", 400);
  if (lamports < FUND_MIN_LAMPORTS) return actionError("The minimum is 0.001 SOL.", 400);
  if (lamports > FUND_MAX_LAMPORTS) return actionError("That amount is too large for one transfer.", 400);

  try {
    const conn = new Connection(RPC_URL, "confirmed");
    const state = await fetchState(readProgram(conn), key);
    if (!state) return actionError("No Noxvault at this address.", 404);
    const { blockhash, lastValidBlockHeight } = await withRetry(() => conn.getLatestBlockhash("confirmed"), 4);
    const tx = new Transaction({ feePayer: account, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({ fromPubkey: account, toPubkey: key, lamports })
    );
    const v = key.toBase58();
    const sol = (Number(lamports) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 });
    const payload = await createPostResponse({
      fields: { type: "transaction", transaction: tx, message: `Sending ${sol} SOL to Noxvault ${v.slice(0, 4)}…${v.slice(-4)}.` },
    });
    return actionJson(payload);
  } catch (e) {
    return actionError(`Could not build the transaction: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
