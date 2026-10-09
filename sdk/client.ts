// Noxvault client: addresses, keys and the transaction plan for an unlock. See docs/SPEC.md.
import { BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { randomBytes } from "@noble/hashes/utils";
import type { Noxvault } from "./idl/noxvault";
import idl from "./idl/noxvault.json";
import { LEN, OneTimeKey, deriveKey, messageDigest, sign, verifyCost } from "./wots";

export { idl };
export type { Noxvault };
export const PROGRAM_ID = new PublicKey(idl.address);
export const SOL_MINT = PublicKey.default;

/** Hash calls one transaction may spend. Measured ~180 CU each; 6500 stays well under 1.4M CU. */
export const HASHES_PER_TX = 6500;
/** Chains written per write_sigs transaction (17 × 32 bytes keeps the tx under 1232 bytes). */
export const SIGS_PER_TX = 17;

const enc = new TextEncoder();

// ---------- secrets ----------

export function newMasterSecret(): Uint8Array {
  return randomBytes(32);
}

export function secretToWords(master: Uint8Array): string {
  return entropyToMnemonic(master, wordlist);
}

export function wordsToSecret(words: string): Uint8Array {
  const clean = words.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(clean, wordlist)) throw new Error("Those words are not a valid Noxvault secret");
  const master = mnemonicToEntropy(clean, wordlist);
  if (master.length !== 32) throw new Error("A Noxvault secret is 24 words");
  return master;
}

// ---------- addresses ----------

export function vaultPda(root: Uint8Array, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("vault"), root], programId)[0];
}

export function spentPda(vault: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("spent"), vault.toBytes()], programId)[0];
}

export function recordPda(vault: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("record"), vault.toBytes()], programId)[0];
}

export function unlockPda(vault: PublicKey, payer: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc.encode("unlock"), vault.toBytes(), payer.toBytes()],
    programId
  )[0];
}

export interface VaultKey extends OneTimeKey {
  vault: PublicKey;
}

export function vaultKey(master: Uint8Array, index: number, programId = PROGRAM_ID): VaultKey {
  const key = deriveKey(master, index);
  return { ...key, vault: vaultPda(key.root, programId) };
}

// ---------- unlock plan ----------

export interface UnlockParams {
  program: Program<Noxvault>;
  payer: PublicKey;
  key: VaultKey; // the vault being opened
  next: PublicKey; // a vault whose key is unused
  dest: PublicKey; // wallet that receives the withdrawal (token owner for SPL)
  amount: bigint; // lamports or token base units
  mint?: PublicKey; // omit for SOL
  tokenProgram?: PublicKey; // TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
  hashesPerTx?: number;
}

export interface UnlockPlan {
  digest: Uint8Array;
  signature: Uint8Array[];
  /** Send in order. Each entry is one transaction; all are safe to retry. */
  transactions: { label: string; instructions: TransactionInstruction[] }[];
  /** The same instructions unpacked, one per step (verify steps need a 1.4M CU budget). */
  steps: { label: string; ix: TransactionInstruction }[];
}

/** Split chain indices into contiguous ranges whose hash cost fits one transaction. */
export function verifyRanges(costs: number[], budget: number): [number, number][] {
  const ranges: [number, number][] = [];
  let from = 0;
  let used = 0;
  for (let j = 0; j < costs.length; j++) {
    if (used + costs[j] > budget && j > from) {
      ranges.push([from, j]);
      from = j;
      used = 0;
    }
    used += costs[j];
  }
  ranges.push([from, costs.length]);
  return ranges;
}

export async function planUnlock(p: UnlockParams): Promise<UnlockPlan> {
  const programId = p.program.programId;
  const mint = p.mint ?? SOL_MINT;
  const vault = p.key.vault;
  const digest = messageDigest({
    programId: programId.toBytes(),
    vault: vault.toBytes(),
    mint: mint.toBytes(),
    dest: p.dest.toBytes(),
    nextVault: p.next.toBytes(),
    amount: p.amount,
  });
  const signature = sign(p.key, digest);
  const unlock = unlockPda(vault, p.payer, programId);
  const m = p.program.methods;
  const toArr = (b: Uint8Array) => Array.from(b);

  const open = await m
    .openUnlock({
      pkSeed: toArr(p.key.pkSeed),
      mint,
      dest: p.dest,
      nextVault: p.next,
      amount: new BN(p.amount.toString()),
    })
    .accountsPartial({ payer: p.payer, vault, unlock, systemProgram: SystemProgram.programId })
    .instruction();

  const writes: TransactionInstruction[] = [];
  for (let s = 0; s < LEN; s += SIGS_PER_TX) {
    writes.push(
      await m
        .writeSigs(s, signature.slice(s, s + SIGS_PER_TX).map(toArr))
        .accountsPartial({ payer: p.payer, unlock })
        .instruction()
    );
  }

  const common = {
    payer: p.payer,
    unlock,
    rentReceiver: p.payer,
    vault,
    spent: spentPda(vault, programId),
    nextVault: p.next,
    dest: p.dest,
    systemProgram: SystemProgram.programId,
  };
  let finish: TransactionInstruction;
  if (mint.equals(SOL_MINT)) {
    finish = await m.finishUnlock().accountsPartial(common).instruction();
  } else {
    const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
    const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
    finish = await m
      .finishUnlockToken()
      .accountsPartial({
        ...common,
        mint,
        vaultAta: ata(vault),
        destAta: ata(p.dest),
        nextAta: ata(p.next),
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  // Each step carries an estimated hash-equivalent cost; steps are packed greedily into as
  // few transactions as fit both the 1232-byte size limit and the compute budget.
  const hashBudget = p.hashesPerTx ?? HASHES_PER_TX;
  const steps: { label: string; ix: TransactionInstruction; cost: number }[] = [
    { label: "open", ix: open, cost: 100 },
    ...writes.map((ix, i) => ({ label: `write ${i + 1}/${writes.length}`, ix, cost: 50 })),
  ];
  const costs = verifyCost(digest);
  for (const [from, to] of verifyRanges(costs, hashBudget)) {
    const cost = costs.slice(from, to).reduce((a, b) => a + b, 0);
    const ix = await m.verify(from, to).accountsPartial({ unlock }).instruction();
    steps.push({ label: `verify ${from}–${to - 1}`, ix, cost });
  }
  steps.push({ label: "pay out", ix: finish, cost: mint.equals(SOL_MINT) ? 200 : 700 });

  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const transactions: UnlockPlan["transactions"] = [];
  let cur: typeof steps = [];
  const flush = () => {
    if (!cur.length) return;
    transactions.push({ label: cur.map((s) => s.label).join(" + "), instructions: [budget, ...cur.map((s) => s.ix)] });
    cur = [];
  };
  for (const step of steps) {
    const next = [...cur, step];
    const cost = next.reduce((a, s) => a + s.cost, 0);
    if (cur.length && (cost > hashBudget || txSize(p.payer, [budget, ...next.map((s) => s.ix)]) > 1232)) flush();
    cur.push(step);
  }
  flush();

  return { digest, signature, transactions, steps: steps.map(({ label, ix }) => ({ label, ix })) };
}

/** Serialized size of a legacy transaction with one signer; Infinity if it cannot fit. */
export function txSize(payer: PublicKey, ixs: TransactionInstruction[]): number {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: PublicKey.default.toBase58() }).add(...ixs);
  try {
    return 1 + 64 + tx.serializeMessage().length;
  } catch {
    return Infinity;
  }
}

// ---------- reading ----------

export interface VaultState {
  index: number;
  vault: PublicKey;
  lamports: number;
  spent: boolean;
  successor?: PublicKey;
}

/**
 * Finds a user's vaults from the secret alone: walks indexes until `gap` consecutive
 * vaults are empty and unused. Returns them all plus the first fresh index.
 */
export async function scanVaults(
  program: Program<Noxvault>,
  master: Uint8Array,
  gap = 3
): Promise<{ vaults: VaultState[]; nextFresh: number }> {
  const conn = program.provider.connection;
  const out: VaultState[] = [];
  let empty = 0;
  for (let i = 0; empty < gap; i += gap) {
    const keys = Array.from({ length: gap }, (_, k) => vaultKey(master, i + k, program.programId).vault);
    const spents = keys.map((v) => spentPda(v, program.programId));
    const infos = await conn.getMultipleAccountsInfo([...keys, ...spents]);
    for (let k = 0; k < gap; k++) {
      const acct = infos[k];
      const spentInfo = infos[gap + k];
      const spent = spentInfo ? program.coder.accounts.decode("spent", spentInfo.data) : null;
      const lamports = acct?.lamports ?? 0;
      if (!spent && lamports === 0) {
        empty++;
        continue;
      }
      empty = 0;
      out.push({ index: i + k, vault: keys[k], lamports, spent: !!spent, successor: spent?.successor });
    }
  }
  // Fresh means after every vault ever used, so a key is never reused.
  return { vaults: out, nextFresh: out.reduce((m, v) => Math.max(m, v.index), -1) + 1 };
}
