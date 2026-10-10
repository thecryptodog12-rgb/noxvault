// Server-only: the site's relayer (docs/SPEC.md §7). It pays network fees and buffer rent for
// already-signed actions and is repaid by the vault. It never sees a secret.
import "server-only";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { idl, type Noxvault } from "@nox/sdk/client";
import type { RelayPolicy } from "@nox/sdk/relayer";
import { RPC_URL } from "@/lib/config";

let cached: { relayer: Keypair; program: Program<Noxvault>; policy: RelayPolicy } | null = null;

// Anchor's Wallet class is not exported from its ESM build; this is the same thing.
function keypairWallet(kp: Keypair) {
  const signOne = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => signOne(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs.map(signOne),
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function relayerContext(): { relayer: Keypair; program: Program<Noxvault>; policy: RelayPolicy } {
  if (cached) return cached;
  const raw = process.env.RELAYER_SECRET_KEY;
  if (!raw) throw new HttpError(503, "Relayer is not configured on this server (RELAYER_SECRET_KEY missing).");
  let relayer: Keypair;
  try {
    const bytes = JSON.parse(raw) as number[];
    if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error();
    relayer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new HttpError(503, "RELAYER_SECRET_KEY must be a JSON array of 64 numbers.");
  }
  const conn = new Connection(process.env.RELAYER_RPC_URL || RPC_URL, "confirmed");
  const program = new Program<Noxvault>(idl as unknown as Noxvault, new AnchorProvider(conn, keypairWallet(relayer), { commitment: "confirmed", preflightCommitment: "confirmed" }));
  const minFee = BigInt(process.env.RELAY_MIN_FEE_LAMPORTS || "100000");
  let discount: RelayPolicy["discount"];
  if (process.env.NOX_MINT && process.env.NOX_DISCOUNT_THRESHOLD) {
    discount = { mint: new PublicKey(process.env.NOX_MINT), threshold: BigInt(process.env.NOX_DISCOUNT_THRESHOLD) };
  }
  cached = { relayer, program, policy: { minFee, discount } };
  return cached;
}

// ---------- simple in-memory per-IP rate limit ----------

const hits = new Map<string, number[]>();

export function rateLimit(req: Request, bucket: string, max: number, windowMs: number) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, `Too many requests. Try again in ${Math.ceil((windowMs - (now - list[0])) / 1000)} s.`);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
}

export function errorResponse(e: unknown) {
  const status = e instanceof HttpError ? e.status : 400;
  const msg = e instanceof Error ? e.message : String(e);
  return Response.json({ error: msg.slice(0, 500) }, { status });
}
