// Noxvault client: addresses, keys and the transaction plan for an unlock. See docs/SPEC.md.
import { BN, BorshInstructionCoder, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
} from "@solana/spl-token";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { randomBytes } from "@noble/hashes/utils";
import type { Noxvault } from "./idl/noxvault";
import idl from "./idl/noxvault.json";
import { LEN, OneTimeKey, deriveKey, equal, messageDigest, sign, verifyCost } from "./wots";

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

// ---------- preflight ----------

/**
 * Checks an unlock BEFORE it is signed. A one-time key must sign exactly one message, so a
 * message that can never be paid out (empty destination below rent, a frozen token account,
 * a fee on transfer…) would leave the user choosing between a stuck vault and a weakened key.
 * `errors` must be empty before signing; `warnings` need the user's explicit consent.
 */
export async function preflightUnlock(
  p: Omit<UnlockParams, "hashesPerTx">
): Promise<{ errors: string[]; warnings: string[] }> {
  const conn = p.program.provider.connection;
  const programId = p.program.programId;
  const mint = p.mint ?? SOL_MINT;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (p.amount <= 0n) errors.push("Amount must be greater than zero.");
  if (p.dest.equals(p.key.vault)) errors.push("The destination cannot be the vault itself.");
  if (p.next.equals(p.key.vault)) errors.push("The next vault cannot be the vault being opened.");

  // The one rule that matters most: this key may only ever sign one message.
  try {
    const digest = messageDigest({
      programId: programId.toBytes(),
      vault: p.key.vault.toBytes(),
      mint: mint.toBytes(),
      dest: p.dest.toBytes(),
      nextVault: p.next.toBytes(),
      amount: p.amount,
    });
    const signed = await findSignedMessages(p.program, p.key);
    if (signed.length > 1)
      errors.push("This vault's key has already signed two different messages. Move nothing more with it; contact support.");
    else if (signed.length === 1 && !equal(signed[0].digest, digest))
      errors.push(
        `This vault's key already signed a withdrawal of ${signed[0].amount} to ${signed[0].dest.toBase58()}. ` +
          "It can only ever complete that one; finish it instead."
      );
  } catch (e) {
    errors.push(`Could not read this vault's history, so it is not safe to sign (${(e as Error).message}).`);
  }

  const [spent, nextSpent, nextInfo, vaultInfo, destInfo] = await conn.getMultipleAccountsInfo([
    spentPda(p.key.vault, programId),
    spentPda(p.next, programId),
    p.next,
    p.key.vault,
    p.dest,
  ]);
  if (spent) errors.push("This vault's key is already used. Its funds are forwarded with a sweep, not an unlock.");
  if (nextSpent) errors.push("The next vault's key is already used. Pick a fresh vault.");
  if (nextInfo && nextInfo.lamports > 0) warnings.push("The next vault already holds SOL; make sure it is yours and unused.");
  const rentMin = await conn.getMinimumBalanceForRentExemption(0);

  if (mint.equals(SOL_MINT)) {
    const balance = BigInt(vaultInfo?.lamports ?? 0);
    if (p.amount > balance) errors.push("The vault holds less than this amount.");
    const destLamports = destInfo?.lamports ?? 0;
    const rest = balance - p.amount;
    const payout = rest > 0n && rest < BigInt(rentMin) && !nextInfo?.lamports ? balance : p.amount;
    if (destLamports === 0 && payout < BigInt(rentMin))
      errors.push(`The destination is empty, so it must receive at least ${rentMin / 1e9} SOL.`);
    return { errors, warnings };
  }

  const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
  const vaultAta = getAssociatedTokenAddressSync(mint, p.key.vault, true, tokenProgram);
  try {
    const acct = await getAccount(conn, vaultAta, "confirmed", tokenProgram);
    if (p.amount > acct.amount) errors.push("The vault holds less of this token than this amount.");
    if (acct.isFrozen) errors.push("The vault's token account is frozen by the token's issuer.");
  } catch {
    errors.push("The vault has no account for this token.");
  }
  try {
    const m = await getMint(conn, mint, "confirmed", tokenProgram);
    if (m.freezeAuthority)
      warnings.push("This token has a freeze authority: its issuer could freeze the vault and block the unlock.");
    const blocking = [
      ExtensionType.TransferFeeConfig,
      ExtensionType.TransferHook,
      ExtensionType.NonTransferable,
      ExtensionType.PermanentDelegate,
      ExtensionType.ConfidentialTransferMint,
    ];
    const exts = getExtensionTypes(m.tlvData).filter((e) => blocking.includes(e));
    if (exts.length)
      errors.push(`This token uses Token-2022 extensions Noxvault does not support (${exts.map((e) => ExtensionType[e]).join(", ")}).`);
  } catch {
    errors.push("Could not read this token's mint.");
  }
  return { errors, warnings };
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
        .accountsPartial({ payer: p.payer, vault, unlock })
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

// ---------- signature history ----------

export interface SignedMessage {
  mint: PublicKey;
  dest: PublicKey;
  next: PublicKey;
  amount: bigint;
  digest: Uint8Array;
  /** Chain indexes whose signature values have been published for this message. */
  chains: number[];
  /** Unlock buffers that held this message (one per payer that tried it). */
  buffers: PublicKey[];
  /** Transactions that published them, oldest first. */
  txs: string[];
}

/**
 * Every message this vault's one-time key has ever signed, read from the vault's full
 * transaction history (failed transactions included: their bytes are public too).
 *
 * This is the source of truth before signing: if it returns a message, the key is committed
 * to it and the client must only ever resend that message; if it returns two, the key is
 * already weakened. Values someone copied into a buffer with a different message do not
 * count: a write counts only if its values equal what this key signs for that buffer's message.
 * Throws if the history cannot be read; callers must then refuse to sign.
 */
export async function findSignedMessages(
  program: Program<Noxvault>,
  key: VaultKey
): Promise<SignedMessage[]> {
  const conn = program.provider.connection;
  const programId = program.programId;
  const vault = key.vault;

  const sigs: string[] = [];
  for (let before: string | undefined; ; ) {
    const page = await conn.getSignaturesForAddress(vault, { before, limit: 1000 }, "confirmed");
    sigs.push(...page.map((s) => s.signature));
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  sigs.reverse(); // oldest first

  type Args = { mint: PublicKey; dest: PublicKey; nextVault: PublicKey; amount: BN; pkSeed: number[] };
  const lastOpen = new Map<string, Args>(); // buffer address → latest message opened in it
  const found = new Map<string, SignedMessage>();

  for (let i = 0; i < sigs.length; i += 25) {
    const batch = sigs.slice(i, i + 25);
    const txs = await conn.getTransactions(batch, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    txs.forEach((tx, t) => {
      if (!tx) throw new Error(`Could not load transaction ${batch[t]}`);
      const msg = tx.transaction.message;
      const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
      const opensHere = new Map<string, Args>();
      for (const ix of msg.compiledInstructions) {
        if (!keys.get(ix.programIdIndex)?.equals(programId)) continue;
        const decoded = (program.coder.instruction as BorshInstructionCoder).decode(Buffer.from(ix.data));
        if (!decoded) continue;
        const acct = (n: number) => keys.get(ix.accountKeyIndexes[n]);
        if (decoded.name === "openUnlock" || decoded.name === "open_unlock") {
          if (!acct(1)?.equals(vault)) continue;
          const args = (decoded.data as { args: Args }).args;
          const buf = acct(2)!.toBase58();
          opensHere.set(buf, args);
          lastOpen.set(buf, args);
        } else if (decoded.name === "writeSigs" || decoded.name === "write_sigs") {
          if (!acct(1)?.equals(vault)) continue;
          const buf = acct(2)!.toBase58();
          const args = opensHere.get(buf) ?? lastOpen.get(buf);
          if (!args || !equal(Uint8Array.from(args.pkSeed), key.pkSeed)) continue;
          const { start, sigs: values } = decoded.data as { start: number; sigs: number[][] };
          const digest = messageDigest({
            programId: programId.toBytes(),
            vault: vault.toBytes(),
            mint: args.mint.toBytes(),
            dest: args.dest.toBytes(),
            nextVault: args.nextVault.toBytes(),
            amount: BigInt(args.amount.toString()),
          });
          const expected = sign(key, digest);
          const ours = values.every((v, k) => start + k < LEN && equal(Uint8Array.from(v), expected[start + k]));
          if (!ours || !values.length) continue;
          const id = Buffer.from(digest).toString("hex");
          const m =
            found.get(id) ??
            ({
              mint: args.mint,
              dest: args.dest,
              next: args.nextVault,
              amount: BigInt(args.amount.toString()),
              digest,
              chains: [],
              buffers: [],
              txs: [],
            } as SignedMessage);
          for (let k = 0; k < values.length; k++) if (!m.chains.includes(start + k)) m.chains.push(start + k);
          if (!m.buffers.some((b) => b.toBase58() === buf)) m.buffers.push(new PublicKey(buf));
          if (!m.txs.includes(batch[t])) m.txs.push(batch[t]);
          found.set(id, m);
        }
      }
    });
  }
  return [...found.values()];
}

// ---------- reading ----------

export interface VaultState {
  index: number;
  vault: PublicKey;
  lamports: number;
  spent: boolean;
  successor?: PublicKey;
}

async function holdsTokens(conn: Connection, owner: PublicKey): Promise<boolean> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const { value } = await conn.getTokenAccountsByOwner(owner, { programId });
    if (value.length) return true;
  }
  return false;
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
      // A vault can hold tokens with 0 SOL: its token accounts' rent is paid by the depositor.
      if (!spent && lamports === 0 && !(await holdsTokens(conn, keys[k]))) {
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
