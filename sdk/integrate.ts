// Integration helpers for wallets and apps: a read-only Program, deposit ("fund") instructions
// for SOL and SPL tokens, and the public links the Noxvault site serves for a vault.
// Funding a vault needs no signature from the vault: it is a plain transfer to the vault address
// (SOL) or to the vault's associated token account (tokens), exactly what the site's Blink sends.
import { Program, type Provider } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import type { Noxvault } from "./idl/noxvault";
import idl from "./idl/noxvault.json";
import { mintTokenProgram, withRetry } from "./client";

/** Public site that serves the treasury pages, the Blink and embed.js. */
export const NOXVAULT_SITE = "https://www.nox-vault.com";

/**
 * A Program without a wallet: enough for every fetch* / decode helper and for building
 * instructions. Pass `programId` only to target a fork or a local validator deployment.
 */
export function readProgram(connection: Connection, programId?: PublicKey): Program<Noxvault> {
  const i = programId ? { ...idl, address: programId.toBase58() } : idl;
  return new Program(i as unknown as Noxvault, { connection } as Provider);
}

const toBig = (n: bigint | number) => (typeof n === "bigint" ? n : BigInt(Math.round(n)));

export interface FundSolParams {
  /** The vault address (vaultOf(config) / the address on /t/<vault>). */
  vault: PublicKey;
  /** The wallet that pays; it signs the transaction. */
  from: PublicKey;
  /** Amount in lamports (1 SOL = 1_000_000_000). */
  lamports: bigint | number;
}

/** One SystemProgram transfer from `from` to the vault: the deposit the Blink builds. */
export function fundVaultIx({ vault, from, lamports }: FundSolParams): TransactionInstruction {
  const amount = toBig(lamports);
  if (amount <= 0n) throw new Error("lamports must be positive");
  if (from.equals(vault)) throw new Error("The vault cannot fund itself.");
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: vault, lamports: amount });
}

export interface FundTokenParams {
  vault: PublicKey;
  /** The token owner; signs the transfer. */
  from: PublicKey;
  mint: PublicKey;
  /** Amount in base units (for 6 decimals, 1 token = 1_000_000). */
  amount: bigint | number;
  decimals: number;
  /** TOKEN_PROGRAM_ID (default) or TOKEN_2022_PROGRAM_ID, the program that owns the mint. */
  tokenProgram?: PublicKey;
  /** Source token account; defaults to `from`'s associated token account. */
  source?: PublicKey;
  /** Pays the rent if the vault's token account must be created; defaults to `from`. */
  payer?: PublicKey;
}

/**
 * Creates the vault's associated token account if needed (owner = vault, off-curve), then
 * transfer_checked into it. Two instructions; put both in one transaction.
 */
export function fundVaultTokenIxs(p: FundTokenParams): TransactionInstruction[] {
  const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
  const amount = toBig(p.amount);
  if (amount <= 0n) throw new Error("amount must be positive");
  const source = p.source ?? getAssociatedTokenAddressSync(p.mint, p.from, false, tokenProgram);
  const dest = vaultTokenAccount(p.vault, p.mint, tokenProgram);
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.payer ?? p.from, dest, p.vault, p.mint, tokenProgram),
    createTransferCheckedInstruction(source, p.mint, dest, p.from, amount, p.decimals, [], tokenProgram),
  ];
}

/** Like fundVaultTokenIxs, but reads the mint's token program and decimals from the chain. */
export async function buildFundTokenIxs(
  connection: Connection,
  p: Omit<FundTokenParams, "decimals" | "tokenProgram">
): Promise<TransactionInstruction[]> {
  const tokenProgram = await mintTokenProgram(connection, p.mint);
  const mint = await withRetry(() => getMint(connection, p.mint, "confirmed", tokenProgram));
  return fundVaultTokenIxs({ ...p, decimals: mint.decimals, tokenProgram });
}

/** The vault's associated token account for `mint` (where tokens sent to the vault live). */
export function vaultTokenAccount(vault: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true, tokenProgram);
}

export interface FundLinks {
  /** Public treasury page: the vault's rules in plain words, balances, schedules. */
  page: string;
  /** Same data as JSON. */
  json: string;
  /** Solana Action endpoint (GET describes, POST returns an unsigned SOL transfer). */
  action: string;
  /** A dial.to Blink URL that opens the fund flow in any browser. */
  blink: string;
}

/** Links the Noxvault site serves for a vault. `cluster` is the cluster the site runs on. */
export function fundLinks(
  vault: PublicKey | string,
  opts: { site?: string; cluster?: "devnet" | "testnet" | "mainnet-beta"; amountSol?: string | number } = {}
): FundLinks {
  const site = (opts.site ?? NOXVAULT_SITE).replace(/\/+$/, "");
  const v = typeof vault === "string" ? new PublicKey(vault).toBase58() : vault.toBase58();
  const cluster = opts.cluster ?? "devnet";
  const amount = opts.amountSol == null ? "" : `?amount=${encodeURIComponent(String(opts.amountSol))}`;
  const action = `${site}/api/actions/fund/${v}${amount}`;
  const blink = `https://dial.to/?action=${encodeURIComponent(`solana-action:${action}`)}${cluster === "mainnet-beta" ? "" : `&cluster=${cluster}`}`;
  return { page: `${site}/t/${v}`, json: `${site}/api/treasury/${v}`, action, blink };
}
