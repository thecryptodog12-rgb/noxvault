// Escape Hatch helpers (docs/SPEC.md §7) shared by the /escape, /scan and /canary pages and by
// the keeper. Framework-free: no React, no browser-only APIs, so the keeper in bot/ can bundle it.
import type { Program } from "@coral-xyz/anchor";
import {
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";
import {
  CANARY_ADDRESS,
  escapeApproveIx,
  escapePda,
  txSize,
  withRetry,
  type LinkView,
  type Noxvault,
} from "@nox/sdk/client";

export const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const;
export const U64_MAX = BigInt("18446744073709551615");
/** Network fee of a one-signature transaction (the escape transaction pays it from the wallet). */
export const BASE_FEE = 5000;

export interface HeldToken {
  address: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  tokenProgram: PublicKey;
  delegate: PublicKey | null;
  delegatedAmount: bigint;
}

/** Every non-empty token account of `owner`, under both token programs. */
export async function heldTokens(conn: Connection, owner: PublicKey): Promise<HeldToken[]> {
  const out: HeldToken[] = [];
  for (const programId of TOKEN_PROGRAMS) {
    const res = await withRetry(() => conn.getTokenAccountsByOwner(owner, { programId }, "confirmed"));
    for (const { pubkey, account } of res.value) {
      try {
        const a = unpackAccount(pubkey, account, programId);
        if (a.amount === 0n) continue;
        out.push({
          address: pubkey,
          mint: a.mint,
          owner: a.owner,
          amount: a.amount,
          tokenProgram: programId,
          delegate: a.delegate,
          delegatedAmount: a.delegatedAmount,
        });
      } catch {
        /* not a token account we can read */
      }
    }
  }
  return out;
}

/** Whether the Escape Hatch delegate can move this account's whole balance. */
export function isCovered(t: HeldToken, wallet: PublicKey, programId: PublicKey): boolean {
  return !!t.delegate && t.delegate.equals(escapePda(wallet, programId)) && t.delegatedAmount >= t.amount;
}

/** Packs instruction groups into as few transactions as fit (1232 bytes, `maxPerTx` groups). */
export function packIxs(payer: PublicKey, groups: TransactionInstruction[][], maxPerTx = 12): TransactionInstruction[][] {
  const txs: TransactionInstruction[][] = [];
  let cur: TransactionInstruction[] = [];
  let n = 0;
  for (const g of groups) {
    const next = [...cur, ...g];
    if (cur.length && (n >= maxPerTx || txSize(payer, next) > 1232)) {
      txs.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(...g);
    n++;
  }
  if (cur.length) txs.push(cur);
  return txs;
}

/** Approve instructions for every uncovered account, packed into as few transactions as possible. */
export function approveBatches(wallet: PublicKey, tokens: HeldToken[], programId: PublicKey): TransactionInstruction[][] {
  const todo = tokens.filter((t) => t.owner.equals(wallet) && !isCovered(t, wallet, programId));
  return packIxs(
    wallet,
    todo.map((t) => [escapeApproveIx(wallet, t.address, t.tokenProgram, programId)])
  );
}

// ---------- the stored SOL escape transaction ----------

export interface EscapeTxStatus {
  /** something is stored */
  stored: boolean;
  /** stored, signed by the wallet, its nonce still current and it still names the linked vault */
  armed: boolean;
  nonce: PublicKey | null;
  nonceValue: string | null;
  vault: PublicKey | null;
  /** why it is not armed (null when armed or nothing stored) */
  problem: string | null;
  tx: Transaction | null;
}

/** Decodes a link's stored escape transaction and checks it would still land. */
export async function escapeTxStatus(conn: Connection, program: Program<Noxvault>, link: LinkView): Promise<EscapeTxStatus> {
  const none: EscapeTxStatus = { stored: false, armed: false, nonce: null, nonceValue: null, vault: null, problem: null, tx: null };
  if (!link.escapeTx.length) return none;
  let tx: Transaction;
  try {
    tx = Transaction.from(link.escapeTx);
  } catch {
    return { ...none, stored: true, problem: "The stored transaction cannot be decoded. Re-arm." };
  }
  // SystemInstruction::AdvanceNonceAccount = u32le(4)
  const advance = tx.instructions.find((ix) => ix.programId.equals(SystemProgram.programId) && ix.data.length === 4 && ix.data[0] === 4 && ix.data[1] === 0 && ix.data[2] === 0 && ix.data[3] === 0);
  const escape = tx.instructions.find((ix) => ix.programId.equals(program.programId));
  const nonce = advance?.keys[0]?.pubkey ?? null;
  const vault = escape?.keys[2]?.pubkey ?? null;
  const base = { ...none, stored: true, nonce, nonceValue: tx.recentBlockhash ?? null, vault, tx };
  if (!advance || !nonce) return { ...base, problem: "The stored transaction does not use a durable nonce. Re-arm." };
  if (!escape || !vault) return { ...base, problem: "The stored transaction is not an escape. Re-arm." };
  if (!tx.feePayer?.equals(link.wallet) || !tx.verifySignatures()) return { ...base, problem: "The stored transaction is not signed by this wallet. Re-arm." };
  if (!vault.equals(link.vault)) return { ...base, problem: "The link now points at another vault; the stored transaction names the old one. Re-arm." };
  const info = await withRetry(() => conn.getAccountInfo(nonce, "confirmed"));
  if (!info) return { ...base, problem: "Its nonce account no longer exists. Re-arm." };
  let current: string;
  try {
    current = NonceAccount.fromAccountData(info.data).nonce;
  } catch {
    return { ...base, problem: "Its nonce account cannot be read. Re-arm." };
  }
  if (current !== tx.recentBlockhash) return { ...base, problem: "The wallet's nonce has moved on (it was used), so the stored transaction is void. Re-arm." };
  return { ...base, armed: true };
}

// ---------- canary derivation ----------

export const CANARY_DOMAIN = "noxvault/canary/v1";

/** First i with SHA256(domain || u32le(i)) a valid ed25519 point: the canary address. */
export function deriveCanary(maxTries = 64): { i: number; bytes: Uint8Array; address: PublicKey; tries: { i: number; hex: string; onCurve: boolean }[] } {
  const prefix = new TextEncoder().encode(CANARY_DOMAIN);
  const tries: { i: number; hex: string; onCurve: boolean }[] = [];
  for (let i = 0; i < maxTries; i++) {
    const buf = new Uint8Array(prefix.length + 4);
    buf.set(prefix);
    new DataView(buf.buffer).setUint32(prefix.length, i, true);
    const h = sha256(buf);
    const onCurve = PublicKey.isOnCurve(h);
    tries.push({ i, hex: Array.from(h, (b) => b.toString(16).padStart(2, "0")).join(""), onCurve });
    if (onCurve) return { i, bytes: h, address: new PublicKey(h), tries };
  }
  throw new Error("no point found");
}

export const canaryMatches = () => deriveCanary().address.equals(CANARY_ADDRESS);

// ---------- wallet sending (browser) ----------

export interface WalletLike {
  publicKey: PublicKey | null;
  sendTransaction: (tx: Transaction, conn: Connection, opts?: { signers?: Signer[]; preflightCommitment?: "confirmed"; maxRetries?: number }) => Promise<string>;
  signAllTransactions?: (<T extends Transaction>(txs: T[]) => Promise<T[]>) | undefined;
  signTransaction?: (<T extends Transaction>(tx: T) => Promise<T>) | undefined;
}

const RETRYABLE = /Blockhash not found|block height exceeded|expired|429|Too many requests/i;

async function confirm(conn: Connection, signature: string, blockhash: string, lastValidBlockHeight: number) {
  const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
}

/** One transaction through the wallet (one prompt). Extra signers sign before the wallet. */
export async function walletSend(conn: Connection, wallet: WalletLike, ixs: TransactionInstruction[], signers: Signer[] = []): Promise<string> {
  if (!wallet.publicKey) throw new Error("Connect a wallet first");
  for (let attempt = 1; ; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
      const sig = await wallet.sendTransaction(tx, conn, { signers, preflightCommitment: "confirmed", maxRetries: 3 });
      await confirm(conn, sig, blockhash, lastValidBlockHeight);
      return sig;
    } catch (e) {
      if (attempt >= 3 || !RETRYABLE.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

/**
 * Several transactions with one wallet prompt when the wallet supports signAllTransactions
 * (otherwise one prompt each). Sent in order; each is confirmed before the next.
 */
export async function walletSendAll(conn: Connection, wallet: WalletLike, batches: TransactionInstruction[][], onSent?: (i: number, sig: string) => void): Promise<string[]> {
  if (!wallet.publicKey) throw new Error("Connect a wallet first");
  if (!batches.length) return [];
  if (!wallet.signAllTransactions || batches.length === 1) {
    const sigs: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      sigs.push(await walletSend(conn, wallet, batches[i]));
      onSent?.(i, sigs[i]);
    }
    return sigs;
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const txs = batches.map((ixs) => new Transaction({ feePayer: wallet.publicKey!, blockhash, lastValidBlockHeight }).add(...ixs));
  const signed = await wallet.signAllTransactions(txs);
  const sigs: string[] = [];
  for (let i = 0; i < signed.length; i++) {
    const sig = await conn.sendRawTransaction(signed[i].serialize(), { preflightCommitment: "confirmed", maxRetries: 3 });
    await confirm(conn, sig, blockhash, lastValidBlockHeight);
    sigs.push(sig);
    onSent?.(i, sig);
  }
  return sigs;
}

/** Broadcasts a stored escape transaction. Anyone may do this; it can only move the wallet's SOL into its vault. */
export async function broadcastEscape(conn: Connection, raw: Uint8Array): Promise<string> {
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
  const res = await conn.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error(`Escape failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

export { CANARY_ADDRESS };
