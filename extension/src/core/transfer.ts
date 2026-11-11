// Sending SOL and SPL / Token-2022 tokens from an ordinary wallet account, and moving funds from a
// wallet into a vault. Every transaction is: compute budget (limit from a simulation, priority price
// from recent fees) + the transfer(s), simulated before it is signed, signed once, sent once, then
// confirmed. It is never rebuilt and re-sent automatically (a retry with a new blockhash could pay twice).
import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export interface AssetRef {
  mint: string;
  decimals: number;
  program: "sol" | "spl" | "2022";
  /** source token account (tokens) */
  account?: string;
}

export interface TransferLeg {
  asset: AssetRef;
  /** base units */
  amount: bigint;
  /** the recipient's token account does not exist yet: create it (the sender pays its rent) */
  createAta?: boolean;
}

/** Rent-exempt minimum of an empty system account (0 bytes). */
export const RENT_EMPTY = 890_880;
/** Default SOL kept back when moving "everything" out of a wallet: fees for the next few transactions. */
export const KEEP_FOR_FEES = 0.005 * LAMPORTS_PER_SOL;

const programOf = (a: AssetRef) => (a.program === "2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);

/** The associated token account of `owner` for an asset; off-curve owners (vaults, PDAs) allowed. */
export const recipientAta = (a: AssetRef, owner: PublicKey) => getAssociatedTokenAddressSync(new PublicKey(a.mint), owner, true, programOf(a));

/** Pure: the instructions of one or more transfers from `from` to `to` (no compute budget). */
export function transferIxs(from: PublicKey, to: PublicKey, legs: TransferLeg[]): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  for (const l of legs) {
    if (l.amount <= 0n) throw new Error("Amount must be more than 0");
    if (l.asset.program === "sol") {
      ixs.push(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: l.amount }));
      continue;
    }
    if (!l.asset.account) throw new Error("No token account to send from");
    const mint = new PublicKey(l.asset.mint);
    const prog = programOf(l.asset);
    const dest = recipientAta(l.asset, to);
    if (l.createAta) ixs.push(createAssociatedTokenAccountIdempotentInstruction(from, dest, to, mint, prog));
    ixs.push(createTransferCheckedInstruction(new PublicKey(l.asset.account), mint, dest, from, l.amount, l.asset.decimals, [], prog));
  }
  return ixs;
}

/** Recent priority fee (micro-lamports per CU): the 75th percentile of non-zero recent fees, bounded. */
export async function priorityPrice(conn: Connection, accounts: PublicKey[], mainnet: boolean): Promise<number> {
  try {
    const fees = (await conn.getRecentPrioritizationFees({ lockedWritableAccounts: accounts.slice(0, 128) })).map((f) => f.prioritizationFee).filter((x) => x > 0);
    fees.sort((a, b) => a - b);
    const p75 = fees.length ? fees[Math.floor(fees.length * 0.75)] : 0;
    return Math.min(2_000_000, Math.max(mainnet ? 5_000 : 0, p75));
  } catch {
    return mainnet ? 50_000 : 0;
  }
}

export interface Prepared {
  tx: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
  /** lamports: base fee + priority fee */
  fee: number;
  units: number;
  cuPrice: number;
  /** rent for token accounts this transaction creates (lamports) */
  rent: number;
  logs: string[];
}

function build(payer: PublicKey, ixs: TransactionInstruction[], blockhash: string, cuLimit: number, cuPrice: number): VersionedTransaction {
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }), ...(cuPrice > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice })] : [])];
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [...budget, ...ixs] }).compileToV0Message());
}

/** Explains the usual simulation failures in words. */
export function simError(err: unknown, logs: string[]): string {
  const s = `${JSON.stringify(err)} ${logs.join(" ")}`;
  if (/Program log: Error: insufficient funds/i.test(s)) return "Not enough tokens.";
  if (/InsufficientFundsForRent/i.test(s)) return "This would leave an account below the rent minimum: send all of it, or leave at least 0.00089 SOL.";
  if (/insufficient lamports|InsufficientFundsForFee|insufficient funds/i.test(s)) return "Not enough SOL for this amount plus the network fee.";
  if (/AccountNotFound/.test(s)) return "This wallet has no SOL on this network yet.";
  return `The network refused it in simulation: ${s.slice(0, 200)}`;
}

/**
 * Builds the transaction, simulates it (unsigned, with a fresh blockhash), sets the compute limit from
 * what it used (+20 %), and returns it ready to sign. Throws a readable message when the simulation fails.
 */
export async function prepare(
  conn: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  opts: { mainnet: boolean; rent?: number; /** keep a known price / limit (a "max" send must not see its fee change) */ cuPrice?: number; units?: number }
): Promise<Prepared> {
  const writable = [payer, ...ixs.flatMap((i) => i.keys.filter((k) => k.isWritable).map((k) => k.pubkey))];
  const [cuPrice, latest] = await Promise.all([opts.cuPrice ?? priorityPrice(conn, writable, opts.mainnet), conn.getLatestBlockhash("confirmed")]);
  const sim = await conn.simulateTransaction(build(payer, ixs, latest.blockhash, opts.units ?? 1_400_000, cuPrice), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  const logs = sim.value.logs ?? [];
  if (sim.value.err) throw new Error(simError(sim.value.err, logs));
  const units = opts.units ?? Math.min(1_400_000, Math.ceil((sim.value.unitsConsumed ?? 200_000) * 1.2) + 1_000);
  const fee = 5_000 + Math.ceil((cuPrice * units) / 1_000_000);
  return { tx: build(payer, ixs, latest.blockhash, units, cuPrice), blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, fee, units, cuPrice, rent: opts.rent ?? 0, logs };
}

/** Signs once, sends once, confirms. On a confirmation timeout it reports the signature instead of retrying. */
export async function signAndSend(conn: Connection, p: Prepared, kp: Keypair): Promise<string> {
  p.tx.sign([kp]);
  const sig = await conn.sendRawTransaction(p.tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 });
  try {
    const res = await conn.confirmTransaction({ signature: sig, blockhash: p.blockhash, lastValidBlockHeight: p.lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`The transaction failed on chain: ${JSON.stringify(res.value.err)} (${sig})`);
  } catch (e) {
    const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true }).catch(() => null);
    if (st?.value?.confirmationStatus && !st.value.err) return sig;
    if (e instanceof Error && /failed on chain/.test(e.message)) throw e;
    throw new Error(`Sent, but not confirmed yet. Check it in the explorer before sending again: ${sig}`);
  }
  return sig;
}

// ---------- recipient checks ----------

export interface RecipientFacts {
  to: string;
  from: string;
  onCurve: boolean;
  /** owner program of the destination account, or null when it does not exist */
  owner: string | null;
  lamports: number;
  /** the address is a vault this extension created / watches as its own */
  ownVault: boolean;
  /** the address holds Noxvault vault state */
  isVault: boolean;
}

export interface RecipientCheck {
  /** refuse to continue */
  error?: string;
  warnings: string[];
  info: string[];
}

const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()];

/** Pure: what to tell the user about a destination before they confirm. */
export function checkRecipient(f: RecipientFacts, asset: AssetRef, amount: bigint): RecipientCheck {
  const warnings: string[] = [];
  const info: string[] = [];
  if (f.to === f.from) return { error: "That is this wallet's own address.", warnings, info };
  if (f.owner && TOKEN_PROGRAMS.includes(f.owner)) return { error: "That is a token account, not a wallet. Use the owner's wallet address.", warnings, info };
  if (f.ownVault) info.push("This is one of your Noxvault vaults: this is a deposit. Moving it out again needs your one-time keys and follows the vault's rules.");
  else if (f.isVault) warnings.push("This is someone else's Noxvault vault. Only its owner can move funds out of it. Make sure you mean to pay into it.");
  else if (!f.onCurve) warnings.push("This address has no private key (a program address). Funds sent here are only recoverable if its program allows it.");
  if (asset.program === "sol" && !f.owner && amount < BigInt(RENT_EMPTY)) return { error: `A new, empty address needs at least ${RENT_EMPTY / LAMPORTS_PER_SOL} SOL (rent minimum).`, warnings, info };
  if (!f.owner && !f.ownVault) info.push("This address has never been used on this network. Double-check it.");
  return { warnings, info };
}

/** Reads the facts checkRecipient needs (one or two RPC calls). */
export async function recipientFacts(conn: Connection, from: PublicKey, to: PublicKey, ownVault: boolean, isVault: (k: PublicKey) => Promise<boolean>): Promise<RecipientFacts> {
  const acc = await conn.getAccountInfo(to, "confirmed");
  return {
    to: to.toBase58(),
    from: from.toBase58(),
    onCurve: PublicKey.isOnCurve(to.toBytes()),
    owner: acc ? acc.owner.toBase58() : null,
    lamports: acc?.lamports ?? 0,
    ownVault,
    isVault: ownVault || (acc ? await isVault(to).catch(() => false) : false),
  };
}

/** Whether the recipient's token account exists, and the rent to create it. */
export async function ataNeeds(conn: Connection, asset: AssetRef, to: PublicKey): Promise<{ create: boolean; rent: number; ata: PublicKey }> {
  const ata = recipientAta(asset, to);
  const info = await conn.getAccountInfo(ata, "confirmed");
  if (info) return { create: false, rent: 0, ata };
  // 165 bytes for SPL; Token-2022 accounts carry extensions (the program sizes them; this is the usual size)
  const rent = await conn.getMinimumBalanceForRentExemption(asset.program === "2022" ? 170 : 165);
  return { create: true, rent, ata };
}

/** Largest SOL amount one send can move: everything minus the fee, or keep the rent minimum. */
export function maxSol(balance: number, fee: number, keep = 0): bigint {
  return BigInt(Math.max(0, balance - fee - keep));
}

/** Splits deposit legs into transactions of at most `per` legs; SOL goes last so token fees are paid first. */
export function packLegs(legs: TransferLeg[], per = 3): TransferLeg[][] {
  const tokens = legs.filter((l) => l.asset.program !== "sol");
  const sol = legs.filter((l) => l.asset.program === "sol");
  const out: TransferLeg[][] = [];
  for (let i = 0; i < tokens.length; i += per) out.push(tokens.slice(i, i + per));
  if (sol.length) {
    const last = out[out.length - 1];
    if (last && last.length < per) last.push(...sol);
    else out.push(sol);
  }
  return out;
}
