// Web-side helpers around the SDK's unlock plan: persistence of the signed message,
// reading the on-chain Unlock buffer, and step bookkeeping. See docs/SPEC.md.
import type { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { SIGS_PER_TX, SOL_MINT, spentPda, type Noxvault, type UnlockPlan } from "@nox/sdk/client";
import { LEN } from "@nox/sdk/wots";

// ---------- pending unlock (the frozen message parameters) ----------

export interface PendingUnlock {
  v: 1;
  vault: string;
  index: number;
  mint: string; // SOL_MINT for SOL
  dest: string;
  next: string;
  amount: string; // base units
  tokenProgram?: string;
  digest: string; // hex, for display / sanity
  createdAt: number;
  done: number[]; // step indexes confirmed by this browser
}

const pendKey = (vault: string) => `nox.pending.${vault}`;

export function loadPending(vault: string): PendingUnlock | null {
  try {
    const raw = localStorage.getItem(pendKey(vault));
    return raw ? (JSON.parse(raw) as PendingUnlock) : null;
  } catch {
    return null;
  }
}

export function savePending(p: PendingUnlock) {
  try {
    localStorage.setItem(pendKey(p.vault), JSON.stringify(p));
  } catch {}
}

export function clearPending(vault: string) {
  try {
    localStorage.removeItem(pendKey(vault));
  } catch {}
}

// ---------- on-chain Unlock buffer ----------

export interface UnlockBuffer {
  address: PublicKey;
  amount: bigint;
  written: bigint;
  verified: bigint;
  vault: PublicKey;
  payer: PublicKey;
  mint: PublicKey;
  dest: PublicKey;
  next: PublicKey;
  frozen: boolean;
}

const UNLOCK_DISC = Uint8Array.from([187, 122, 21, 254, 7, 157, 241, 10]);

/** Manual decode of the zero-copy `Unlock` account (repr(C), offsets after the 8-byte discriminator). */
export function decodeUnlock(address: PublicKey, data: Uint8Array): UnlockBuffer {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pk = (o: number) => new PublicKey(data.slice(o, o + 32));
  return {
    address,
    amount: dv.getBigUint64(8, true),
    written: dv.getBigUint64(16, true),
    verified: dv.getBigUint64(24, true),
    vault: pk(32),
    payer: pk(64),
    mint: pk(128),
    dest: pk(160),
    next: pk(192),
    frozen: data[258] === 1,
  };
}

/** Every open Unlock buffer for a vault, from any payer. */
export async function findOpenBuffers(conn: Connection, programId: PublicKey, vault: PublicKey): Promise<UnlockBuffer[]> {
  const res = await conn.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(UNLOCK_DISC) } },
      { memcmp: { offset: 32, bytes: vault.toBase58() } },
    ],
  });
  return res.map((r) => decodeUnlock(r.pubkey, r.account.data));
}

export function bufferMatches(b: UnlockBuffer, p: PendingUnlock): boolean {
  return (
    b.mint.toBase58() === p.mint &&
    b.dest.toBase58() === p.dest &&
    b.next.toBase58() === p.next &&
    b.amount.toString() === p.amount
  );
}

// ---------- step bookkeeping ----------

const allBits = (word: bigint, from: number, to: number) => {
  for (let j = from; j < to; j++) if (((word >> BigInt(j)) & 1n) === 0n) return false;
  return true;
};

/**
 * Whether one unpacked plan step (planUnlock().steps[i].label: "open", "write i/n",
 * "verify a–b", "pay out") is already done on chain for this payer's buffer.
 */
export function stepDoneOnChain(label: string, buf: UnlockBuffer | null, spent: boolean): boolean {
  if (spent) return true;
  if (!buf) return false;
  if (label === "open") return true;
  const w = /^write (\d+)\/(\d+)$/.exec(label);
  if (w) {
    const i = Number(w[1]) - 1;
    return buf.frozen || allBits(buf.written, i * SIGS_PER_TX, Math.min((i + 1) * SIGS_PER_TX, LEN));
  }
  const v = /^verify (\d+)\D+(\d+)$/.exec(label);
  if (v) return allBits(buf.verified, Number(v[1]), Number(v[2]) + 1);
  return false; // pay out: done only when Spent exists
}

/**
 * For each packed transaction, the instructions still to send (compute budget kept),
 * or null when every step in it is already on chain. Steps are matched by instruction identity.
 */
export function remainingIxs(plan: UnlockPlan, buf: UnlockBuffer | null, spent: boolean): (TransactionInstruction[] | null)[] {
  const done = new Map(plan.steps.map((s) => [s.ix, stepDoneOnChain(s.label, buf, spent)]));
  return plan.transactions.map((t) => {
    const work = t.instructions.filter((ix) => done.has(ix) && !done.get(ix));
    if (work.length === 0) return null;
    return t.instructions.filter((ix) => !done.has(ix) || !done.get(ix));
  });
}

// ---------- vault reading ----------

export interface TokenHolding {
  mint: PublicKey;
  ata: PublicKey;
  amount: bigint;
  decimals: number;
  program: PublicKey;
}

export interface VaultAssets {
  lamports: number;
  tokens: TokenHolding[];
}

export async function vaultAssets(conn: Connection, vault: PublicKey): Promise<VaultAssets> {
  const [lamports, ...lists] = await Promise.all([
    conn.getBalance(vault),
    ...[TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      conn.getParsedTokenAccountsByOwner(vault, { programId }).then((r) => ({ programId, r }))
    ),
  ]);
  const tokens: TokenHolding[] = [];
  for (const { programId, r } of lists) {
    for (const a of r.value) {
      const info = (a.account.data as { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } })
        .parsed.info;
      tokens.push({
        mint: new PublicKey(info.mint),
        ata: a.pubkey,
        amount: BigInt(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
        program: programId,
      });
    }
  }
  return { lamports, tokens };
}

export async function isSpent(conn: Connection, programId: PublicKey, vault: PublicKey): Promise<boolean> {
  return !!(await conn.getAccountInfo(spentPda(vault, programId)));
}

// ---------- sweeps (spent vault → successor) ----------

export async function sweepIx(program: Program<Noxvault>, vault: PublicKey, successor: PublicKey) {
  return program.methods
    .sweep()
    .accountsPartial({ vault, spent: spentPda(vault, program.programId), successor })
    .instruction();
}

export async function sweepTokenIx(
  program: Program<Noxvault>,
  payer: PublicKey,
  vault: PublicKey,
  successor: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
) {
  const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true, tokenProgram);
  return program.methods
    .sweepToken()
    .accountsPartial({
      payer,
      vault,
      spent: spentPda(vault, program.programId),
      mint,
      vaultAta: ata(vault),
      successor,
      successorAta: ata(successor),
      tokenProgram,
    })
    .instruction();
}

// ---------- sending ----------

export type SendFn = (
  tx: Transaction,
  conn: Connection,
  opts?: { preflightCommitment?: "confirmed"; maxRetries?: number }
) => Promise<string>;

const RETRYABLE = /Blockhash not found|block height exceeded|BlockheightExceeded|TransactionExpired/i;

/**
 * Sends one transaction with a "confirmed" blockhash and waits for confirmation.
 * Public devnet RPCs sometimes simulate on a lagging node; those errors are retried with a
 * fresh blockhash (every Noxvault step is safe to resend).
 */
export async function sendIxs(
  conn: Connection,
  payer: PublicKey,
  send: SendFn,
  ixs: TransactionInstruction[],
  attempts = 4
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...ixs);
      const sig = await send(tx, conn, { preflightCommitment: "confirmed", maxRetries: 3 });
      const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
      return sig;
    } catch (e) {
      const text = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      if (attempt >= attempts || !RETRYABLE.test(text)) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

export const isSol = (mint: PublicKey | string) =>
  (typeof mint === "string" ? mint : mint.toBase58()) === SOL_MINT.toBase58();
