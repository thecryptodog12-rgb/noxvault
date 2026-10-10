// Devnet only: sends test $NOX (tNOX) from the faucet wallet to a vault's $NOX account.
// Refused on any other network. Rate-limited per IP and once per vault per 24 h (in memory).
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { FAUCET_AMOUNT, NETWORK, NOX_CA, RPC_URL } from "@/lib/config";
import { HttpError, errorResponse, rateLimit } from "@/lib/server/relayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const perVault = new Map<string, number>();
const DAY = 86_400_000;

function faucetKey(): Keypair {
  const raw = process.env.FAUCET_SECRET_KEY;
  if (!raw) throw new HttpError(503, "The faucet is not configured on this server.");
  try {
    const b = JSON.parse(raw) as number[];
    if (b.length !== 64) throw new Error();
    return Keypair.fromSecretKey(Uint8Array.from(b));
  } catch {
    throw new HttpError(503, "FAUCET_SECRET_KEY must be a JSON array of 64 numbers.");
  }
}

export async function POST(req: Request) {
  try {
    if (NETWORK !== "devnet" || !NOX_CA) throw new HttpError(403, "The test $NOX faucet only runs on devnet.");
    let vault: PublicKey;
    try {
      const body = (await req.json()) as { vault?: string };
      vault = new PublicKey(String(body.vault ?? "").trim());
    } catch {
      throw new HttpError(400, "Send { vault: <address> }");
    }
    const k = vault.toBase58();
    const last = perVault.get(k);
    if (last && Date.now() - last < DAY) throw new HttpError(429, "This vault already got test $NOX in the last 24 h.");
    rateLimit(req, "faucet", 3, DAY);
    const conn = new Connection(process.env.RELAYER_RPC_URL || RPC_URL, "confirmed");
    const faucet = faucetKey();
    const mint = new PublicKey(NOX_CA);
    const info = await conn.getAccountInfo(mint, "confirmed");
    if (!info) throw new HttpError(503, "tNOX mint not found on this cluster.");
    const tokenProgram = info.owner;
    const m = await getMint(conn, mint, "confirmed", tokenProgram);
    const amount = BigInt(FAUCET_AMOUNT) * 10n ** BigInt(m.decimals);
    const from = getAssociatedTokenAddressSync(mint, faucet.publicKey, false, tokenProgram);
    const to = getAssociatedTokenAddressSync(mint, vault, true, tokenProgram);
    perVault.set(k, Date.now()); // before sending, so parallel requests cannot double-spend
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, to, vault, mint, tokenProgram),
      createTransferCheckedInstruction(from, mint, to, faucet.publicKey, amount, m.decimals, [], tokenProgram)
    );
    let sig = "";
    try {
      sig = await sendAndConfirmTransaction(conn, tx, [faucet], { commitment: "confirmed" });
    } catch (e) {
      perVault.delete(k);
      throw e;
    }
    return Response.json({ vault: k, amount: FAUCET_AMOUNT, signature: sig });
  } catch (e) {
    return errorResponse(e);
  }
}
