// Noxvault v2 client: secrets, vault configs, addresses, action plans, history and preflight.
// See docs/SPEC.md; every rule there that a client must follow lives in this file.
import { BN, BorshInstructionCoder, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  StakeProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
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
import {
  Action,
  Config,
  LEN,
  PRIMARY_HEIGHT,
  PublicTree,
  RECOVERY_HEIGHT,
  TreeSeeds,
  authPath,
  buildTree,
  configHash,
  encodeAction,
  equal,
  messageDigest,
  seedIndex,
  sign,
  treeSeeds,
  verifyCost,
} from "./wots";

export { idl };
export type { Noxvault };
export const PROGRAM_ID = new PublicKey(idl.address);
export const SOL_MINT = PublicKey.default;
export const STAKE_CONFIG_ID = new PublicKey("StakeConfig11111111111111111111111111111111");
export const VOTE_PROGRAM_ID = new PublicKey("Vote111111111111111111111111111111111111111");
export const TREE_PRIMARY = 0;
export const TREE_RECOVERY = 1;

/** Hash calls one transaction may spend. Measured ~180 CU each; 6500 stays well under 1.4M CU. */
export const HASHES_PER_TX = 6500;
/** Chains per write_sigs instruction; the packer fits as many as the 1232-byte limit allows. */
export const SIGS_PER_WRITE = 12;

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// ---------- secrets ----------

export function newMasterSecret(): Uint8Array {
  return randomBytes(32);
}

export function secretToWords(master: Uint8Array): string {
  return entropyToMnemonic(master, wordlist);
}

export function wordsToSecret(words: string): Uint8Array {
  const clean = words.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(clean, wordlist)) throw new Error("Those words are not a valid Noxvault phrase");
  const master = mnemonicToEntropy(clean, wordlist);
  if (master.length !== 32) throw new Error("A Noxvault phrase is 24 words");
  return master;
}

// ---------- trees and configs ----------

/** A tree whose secret this client holds: it can sign with it. */
export interface Signer {
  tree: typeof TREE_PRIMARY | typeof TREE_RECOVERY;
  seeds: TreeSeeds;
  pub: PublicTree;
}

/**
 * Builds the tree of vault number `vaultNumber` from a phrase (a few seconds for the primary
 * tree). The recovery tree of a phrase uses a separate index range, so one phrase can never
 * produce the same keys as primary and recovery.
 */
export function makeSigner(
  master: Uint8Array,
  vaultNumber: number,
  tree: Signer["tree"],
  onLeaf?: (done: number, total: number) => void
): Signer {
  const seeds = treeSeeds(master, seedIndex(vaultNumber, tree));
  return { tree, seeds, pub: buildTree(seeds, tree === TREE_PRIMARY ? PRIMARY_HEIGHT : RECOVERY_HEIGHT, onLeaf) };
}

export interface VaultSettings {
  recoveryRoot?: Uint8Array; // from the recovery holder; omit for no recovery
  recoveryDelaySecs?: number; // inactivity before recovery may act fully
  whitelist?: PublicKey[]; // up to 4
  slowDelaySecs?: number; // delay for withdrawals outside the whitelist; 0 = refuse them
}

export function makeConfig(primary: Signer, s: VaultSettings = {}): Config {
  const hasRecovery = !!s.recoveryRoot;
  return {
    primaryRoot: primary.pub.root,
    primaryHeight: primary.pub.height,
    recoveryRoot: s.recoveryRoot ?? new Uint8Array(32),
    recoveryHeight: hasRecovery ? RECOVERY_HEIGHT : 0,
    recoveryDelay: BigInt(hasRecovery ? s.recoveryDelaySecs ?? 180 * 86400 : 0),
    whitelist: (s.whitelist ?? []).map((k) => k.toBytes()),
    slowDelay: BigInt(s.slowDelaySecs ?? 0),
  };
}

export function toAnchorConfig(c: Config) {
  const slots = [...c.whitelist, ...Array(4 - c.whitelist.length).fill(new Uint8Array(32))];
  return {
    primaryRoot: Array.from(c.primaryRoot),
    primaryHeight: c.primaryHeight,
    recoveryRoot: Array.from(c.recoveryRoot),
    recoveryHeight: c.recoveryHeight,
    recoveryDelay: new BN(c.recoveryDelay.toString()),
    whitelist: slots.map((k: Uint8Array) => new PublicKey(k)),
    slowDelay: new BN(c.slowDelay.toString()),
  };
}

export function toAnchorAction(a: Action) {
  const pk = (b: Uint8Array) => new PublicKey(b);
  const bn = (n: bigint) => new BN(n.toString());
  switch (a.kind) {
    case "withdraw":
      return { withdraw: { mint: pk(a.mint), dest: pk(a.dest), amount: bn(a.amount), fee: bn(a.fee), feePayee: pk(a.feePayee) } };
    case "stake":
      return { stake: { seed: a.seed, vote: pk(a.vote), amount: bn(a.amount), fee: bn(a.fee), feePayee: pk(a.feePayee) } };
    case "unstake":
      return { unstake: { seed: a.seed, fee: bn(a.fee), feePayee: pk(a.feePayee) } };
    case "collectStake":
      return { collectStake: { seed: a.seed, fee: bn(a.fee), feePayee: pk(a.feePayee) } };
    case "cancel":
      return { cancel: { fee: bn(a.fee), feePayee: pk(a.feePayee) } };
    case "ping":
      return { ping: { fee: bn(a.fee), feePayee: pk(a.feePayee) } };
  }
}

// ---------- addresses ----------

export function vaultPda(hash: Uint8Array, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("vault"), hash], programId)[0];
}

export function vaultOf(config: Config, programId = PROGRAM_ID): PublicKey {
  return vaultPda(configHash(config), programId);
}

export function statePda(vault: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("state"), vault.toBytes()], programId)[0];
}

export function unlockPda(vault: PublicKey, payer: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("unlock"), vault.toBytes(), payer.toBytes()], programId)[0];
}

export function stakePda(vault: PublicKey, seed: number, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("stake"), vault.toBytes(), Uint8Array.of(seed)], programId)[0];
}

export async function initVaultIx(program: Program<Noxvault>, payer: PublicKey, config: Config) {
  const vault = vaultOf(config, program.programId);
  return program.methods
    .initVault(toAnchorConfig(config))
    .accountsPartial({ payer, vault, state: statePda(vault, program.programId), systemProgram: SystemProgram.programId })
    .instruction();
}

// ---------- state ----------

export interface VaultStateView {
  vault: PublicKey;
  config: Config;
  usedPrimary: Uint8Array;
  usedRecovery: Uint8Array;
  lastActive: number;
  createdAt: number;
  actions: number;
  pending: null | { mint: PublicKey; dest: PublicKey; amount: bigint; executableAt: number; leaf: number };
}

export function decodeState(program: Program<Noxvault>, data: Buffer): VaultStateView {
  const s = program.coder.accounts.decode("vaultState", data);
  const c = s.config;
  return {
    vault: s.vault,
    config: {
      primaryRoot: Uint8Array.from(c.primaryRoot),
      primaryHeight: c.primaryHeight,
      recoveryRoot: Uint8Array.from(c.recoveryRoot),
      recoveryHeight: c.recoveryHeight,
      recoveryDelay: BigInt(c.recoveryDelay.toString()),
      whitelist: (c.whitelist as PublicKey[]).filter((k) => !k.equals(PublicKey.default)).map((k) => k.toBytes()),
      slowDelay: BigInt(c.slowDelay.toString()),
    },
    usedPrimary: Uint8Array.from(s.usedPrimary),
    usedRecovery: Uint8Array.from(s.usedRecovery),
    lastActive: Number(s.lastActive),
    createdAt: Number(s.createdAt),
    actions: s.actions,
    pending: s.pending
      ? {
          mint: s.pending.mint,
          dest: s.pending.dest,
          amount: BigInt(s.pending.amount.toString()),
          executableAt: Number(s.pending.executableAt),
          leaf: s.pending.leaf,
        }
      : null,
  };
}

export async function fetchState(program: Program<Noxvault>, vault: PublicKey): Promise<VaultStateView | null> {
  const info = await program.provider.connection.getAccountInfo(statePda(vault, program.programId), "confirmed");
  return info ? decodeState(program, info.data) : null;
}

export function leafUsed(state: VaultStateView, tree: number, leaf: number): boolean {
  const map = tree === TREE_PRIMARY ? state.usedPrimary : state.usedRecovery;
  return (map[leaf >> 3] & (1 << (leaf & 7))) !== 0;
}

/** Byte offset of config.primary_root inside a VaultState account (discriminator, vault, bump, hash). */
export const PRIMARY_ROOT_OFFSET = 8 + 32 + 1 + 32;
export const RECOVERY_ROOT_OFFSET = PRIMARY_ROOT_OFFSET + 32 + 1;

/** Vaults whose primary (or recovery) tree is this signer's. Needs an RPC that allows getProgramAccounts. */
export async function findVaultsFor(program: Program<Noxvault>, signer: Signer): Promise<VaultStateView[]> {
  const offset = signer.tree === TREE_PRIMARY ? PRIMARY_ROOT_OFFSET : RECOVERY_ROOT_OFFSET;
  const accts = await program.provider.connection.getProgramAccounts(program.programId, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset, bytes: Buffer.from(signer.pub.root).toString("base64"), encoding: "base64" } as never }],
  });
  return accts.map((a) => decodeState(program, a.account.data));
}

// ---------- signature history ----------

/** Transactions fetched per request; public RPCs reject large batches with 429. */
const HISTORY_BATCH = 5;

/** Retries an RPC call on rate limits (429) with exponential backoff; other errors pass through. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= attempts || !/429|Too many requests|rate limit/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

export interface SignedMessage {
  tree: number;
  leaf: number;
  action: Action;
  actionBytes: Uint8Array;
  digest: Uint8Array;
  /** Chain indexes whose signature values have been published for this message. */
  chains: number[];
  buffers: PublicKey[];
  txs: string[];
}

function actionFromAnchor(a: Record<string, Record<string, unknown>>): Action {
  const [kind, f] = Object.entries(a)[0] as [string, Record<string, any>];
  const k = (p: PublicKey) => p.toBytes();
  const n = (x: BN) => BigInt(x.toString());
  const payee = k(f.feePayee ?? f.fee_payee);
  switch (kind) {
    case "withdraw":
      return { kind, mint: k(f.mint), dest: k(f.dest), amount: n(f.amount), fee: n(f.fee), feePayee: payee };
    case "stake":
      return { kind, seed: f.seed, vote: k(f.vote), amount: n(f.amount), fee: n(f.fee), feePayee: payee };
    case "unstake":
    case "collectStake":
      return { kind, seed: f.seed, fee: n(f.fee), feePayee: payee };
    case "cancel":
    case "ping":
      return { kind, fee: n(f.fee), feePayee: payee };
  }
  throw new Error(`unknown action ${kind}`);
}

/**
 * Every message this signer's tree has ever signed for this vault, read from the vault's full
 * transaction history (failed transactions included: their bytes are public too).
 * A write counts only if its values equal what this key signs for that buffer's message, so
 * values someone copied into a buffer with a different message do not count.
 * Throws if the history cannot be read; callers must then refuse to sign.
 */
export async function findSignedMessages(program: Program<Noxvault>, vault: PublicKey, signer: Signer): Promise<SignedMessage[]> {
  const conn = program.provider.connection;
  const programId = program.programId;
  const coder = program.coder.instruction as BorshInstructionCoder;

  const sigs: string[] = [];
  for (let before: string | undefined; ; ) {
    const page = await withRetry(() => conn.getSignaturesForAddress(vault, { before, limit: 1000 }, "confirmed"));
    sigs.push(...page.map((s) => s.signature));
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  sigs.reverse(); // oldest first

  type Opened = { tree: number; leaf: number; pkSeed: Uint8Array; action: Action };
  const lastOpen = new Map<string, Opened>();
  const found = new Map<string, SignedMessage>();
  const expected = new Map<string, Uint8Array[]>();

  for (let i = 0; i < sigs.length; i += HISTORY_BATCH) {
    const batch = sigs.slice(i, i + HISTORY_BATCH);
    const txs = await withRetry(() => conn.getTransactions(batch, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
    txs.forEach((tx, t) => {
      if (!tx) throw new Error(`Could not load transaction ${batch[t]}`);
      const msg = tx.transaction.message;
      const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
      const opensHere = new Map<string, Opened>();
      for (const ix of msg.compiledInstructions) {
        if (!keys.get(ix.programIdIndex)?.equals(programId)) continue;
        const decoded = coder.decode(Buffer.from(ix.data));
        if (!decoded) continue;
        const acct = (n: number) => keys.get(ix.accountKeyIndexes[n]);
        const data = decoded.data as Record<string, any>;
        if (decoded.name === "openUnlock" || decoded.name === "open_unlock") {
          if (!acct(1)?.equals(vault)) continue;
          const o: Opened = {
            tree: data.tree,
            leaf: data.leaf,
            pkSeed: Uint8Array.from(data.pkSeed ?? data.pk_seed),
            action: actionFromAnchor(data.action),
          };
          const buf = acct(3)!.toBase58();
          opensHere.set(buf, o);
          lastOpen.set(buf, o);
        } else if (decoded.name === "writeSigs" || decoded.name === "write_sigs") {
          if (!acct(1)?.equals(vault)) continue;
          const buf = acct(2)!.toBase58();
          const o = opensHere.get(buf) ?? lastOpen.get(buf);
          if (!o || o.tree !== signer.tree || !equal(o.pkSeed, signer.seeds.pkSeed)) continue;
          const actionBytes = encodeAction(o.action);
          const digest = messageDigest(programId.toBytes(), vault.toBytes(), o.tree, o.leaf, actionBytes);
          const id = `${o.leaf}:${hex(digest)}`;
          if (!expected.has(id)) expected.set(id, sign(signer.seeds, o.leaf, digest));
          const want = expected.get(id)!;
          const values = (data.sigs as number[][]).map((v) => Uint8Array.from(v));
          const start = data.start as number;
          if (!values.length || !values.every((v, k) => start + k < LEN && equal(v, want[start + k]))) continue;
          const m =
            found.get(id) ??
            ({ tree: o.tree, leaf: o.leaf, action: o.action, actionBytes, digest, chains: [], buffers: [], txs: [] } as SignedMessage);
          values.forEach((_, k) => m.chains.includes(start + k) || m.chains.push(start + k));
          if (!m.buffers.some((b) => b.toBase58() === buf)) m.buffers.push(new PublicKey(buf));
          if (!m.txs.includes(batch[t])) m.txs.push(batch[t]);
          found.set(id, m);
        }
      }
    });
  }
  return [...found.values()];
}

/**
 * The leaf to sign with: a leaf whose signed message is still unfinished comes first (it can
 * only ever complete that message); otherwise the lowest leaf never used and never signed.
 */
export function pickLeaf(state: VaultStateView, signer: Signer, signed: SignedMessage[]): { leaf: number; resume?: SignedMessage } {
  const unfinished = signed.find((m) => !leafUsed(state, signer.tree, m.leaf));
  if (unfinished) return { leaf: unfinished.leaf, resume: unfinished };
  const taken = new Set(signed.map((m) => m.leaf));
  for (let l = 0; l < 1 << signer.pub.height; l++) if (!leafUsed(state, signer.tree, l) && !taken.has(l)) return { leaf: l };
  throw new Error("Every one-time key of this tree is used. Move the funds to a new vault.");
}

// ---------- plan ----------

export interface ActionParams {
  program: Program<Noxvault>;
  payer: PublicKey;
  vault: PublicKey;
  signer: Signer;
  leaf: number;
  action: Action;
  tokenProgram?: PublicKey; // for token withdrawals: TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
  hashesPerTx?: number;
}

export interface ActionPlan {
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

export function actionDigest(programId: PublicKey, vault: PublicKey, tree: number, leaf: number, action: Action): Uint8Array {
  return messageDigest(programId.toBytes(), vault.toBytes(), tree, leaf, encodeAction(action));
}

export async function finishIx(p: Omit<ActionParams, "leaf" | "signer" | "hashesPerTx">): Promise<TransactionInstruction> {
  const { program, payer, vault, action } = p;
  const programId = program.programId;
  const m = program.methods;
  const feePayee = action.fee > 0n ? new PublicKey(action.feePayee) : payer;
  const base = {
    unlock: unlockPda(vault, payer, programId),
    rentReceiver: payer,
    state: statePda(vault, programId),
    vault,
    feePayee,
    systemProgram: SystemProgram.programId,
  };
  switch (action.kind) {
    case "withdraw": {
      const mint = new PublicKey(action.mint);
      const dest = new PublicKey(action.dest);
      if (mint.equals(SOL_MINT)) return m.finishWithdraw().accountsPartial({ ...base, dest }).instruction();
      const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
      const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true, tokenProgram);
      return m
        .finishWithdrawToken()
        .accountsPartial({
          ...base,
          payer,
          mint,
          vaultAta: ata(vault),
          dest,
          destAta: ata(dest),
          tokenProgram,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .instruction();
    }
    case "stake":
      return m
        .finishStake()
        .accountsPartial({
          ...base,
          stake: stakePda(vault, action.seed, programId),
          vote: new PublicKey(action.vote),
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
          stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
          stakeConfig: STAKE_CONFIG_ID,
          stakeProgram: StakeProgram.programId,
        })
        .instruction();
    case "unstake":
    case "collectStake": {
      const accts = {
        ...base,
        stake: stakePda(vault, action.seed, programId),
        clock: SYSVAR_CLOCK_PUBKEY,
        stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
        stakeProgram: StakeProgram.programId,
      };
      return action.kind === "unstake"
        ? m.finishUnstake().accountsPartial(accts).instruction()
        : m.finishCollectStake().accountsPartial(accts).instruction();
    }
    case "cancel":
    case "ping":
      return m.finishAdmin().accountsPartial(base).instruction();
  }
}

export interface PlanStep {
  label: string;
  ix: TransactionInstruction;
  cost: number;
  kind: "open" | "write" | "verify" | "execute";
  chains?: [number, number]; // write / verify: chain range [from, to)
}

/** Everything needed to build the transactions of an already-signed action. All public. */
export interface SignedAction {
  vault: PublicKey;
  tree: number;
  leaf: number;
  pkSeed: Uint8Array;
  authPath: Uint8Array[];
  signature: Uint8Array[];
  action: Action;
}

export async function buildSteps(
  program: Program<Noxvault>,
  payer: PublicKey,
  s: SignedAction,
  opts: { tokenProgram?: PublicKey; hashesPerTx?: number } = {}
): Promise<PlanStep[]> {
  const programId = program.programId;
  const { vault, tree, leaf, action, signature } = s;
  const actionBytes = encodeAction(action);
  const digest = messageDigest(programId.toBytes(), vault.toBytes(), tree, leaf, actionBytes);
  const unlock = unlockPda(vault, payer, programId);
  const m = program.methods;
  const arr = (b: Uint8Array) => Array.from(b);

  const open = await m
    .openUnlock(tree, leaf, arr(s.pkSeed), s.authPath.map(arr), toAnchorAction(action) as never)
    .accountsPartial({ payer, vault, state: statePda(vault, programId), unlock, systemProgram: SystemProgram.programId })
    .instruction();
  // The program signs over the action bytes it decodes. If Anchor's encoding ever differed from
  // encodeAction, the published signature would not match the on-chain message: refuse.
  if (!Buffer.from(open.data).includes(Buffer.from(actionBytes)))
    throw new Error("Action encoding mismatch between SDK and program. Refusing to sign.");

  const steps: PlanStep[] = [{ label: "open", ix: open, cost: 100, kind: "open" }];
  for (let from = 0, n = 1; from < LEN; from += SIGS_PER_WRITE, n++) {
    const to = Math.min(from + SIGS_PER_WRITE, LEN);
    const ix = await m.writeSigs(from, signature.slice(from, to).map(arr)).accountsPartial({ payer, vault, unlock }).instruction();
    steps.push({ label: `write ${n}/${Math.ceil(LEN / SIGS_PER_WRITE)}`, ix, cost: 50, kind: "write", chains: [from, to] });
  }
  const costs = verifyCost(digest);
  for (const [from, to] of verifyRanges(costs, opts.hashesPerTx ?? HASHES_PER_TX)) {
    const ix = await m.verify(from, to).accountsPartial({ unlock }).instruction();
    steps.push({ label: `verify ${from}–${to - 1}`, ix, cost: costs.slice(from, to).reduce((a, b) => a + b, 0), kind: "verify", chains: [from, to] });
  }
  const execute = await finishIx({ program, payer, vault, action, tokenProgram: opts.tokenProgram });
  steps.push({ label: "execute", ix: execute, cost: action.kind === "stake" ? 900 : 700, kind: "execute" });
  return steps;
}

/** Packs steps greedily into as few transactions as fit both the size limit and the compute budget. */
export function packSteps(payer: PublicKey, steps: PlanStep[], hashBudget = HASHES_PER_TX): ActionPlan["transactions"] {
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const transactions: ActionPlan["transactions"] = [];
  let cur: PlanStep[] = [];
  const flush = () => {
    if (!cur.length) return;
    transactions.push({ label: cur.map((s) => s.label).join(" + "), instructions: [budget, ...cur.map((s) => s.ix)] });
    cur = [];
  };
  for (const step of steps) {
    const next = [...cur, step];
    const cost = next.reduce((a, s) => a + s.cost, 0);
    if (cur.length && (cost > hashBudget || txSize(payer, [budget, ...next.map((s) => s.ix)]) > 1232)) flush();
    cur.push(step);
  }
  flush();
  return transactions;
}

export async function planAction(p: ActionParams): Promise<ActionPlan> {
  const { program, payer, vault, signer, leaf, action } = p;
  const digest = actionDigest(program.programId, vault, signer.tree, leaf, action);
  const signature = sign(signer.seeds, leaf, digest);
  const steps = await buildSteps(
    program,
    payer,
    { vault, tree: signer.tree, leaf, pkSeed: signer.seeds.pkSeed, authPath: authPath(signer.pub, leaf), signature, action },
    { tokenProgram: p.tokenProgram, hashesPerTx: p.hashesPerTx }
  );
  return {
    digest,
    signature,
    transactions: packSteps(payer, steps, p.hashesPerTx),
    steps: steps.map(({ label, ix }) => ({ label, ix })),
  };
}

// ---------- buffers ----------

export interface UnlockBuffer {
  vault: PublicKey;
  payer: PublicKey;
  pkSeed: Uint8Array;
  tree: number;
  leaf: number;
  actionBytes: Uint8Array;
  frozen: boolean;
  written: bigint;
  verified: bigint;
}

export async function fetchBuffer(program: Program<Noxvault>, vault: PublicKey, payer: PublicKey): Promise<UnlockBuffer | null> {
  const u = await program.account.unlock.fetchNullable(unlockPda(vault, payer, program.programId), "confirmed");
  if (!u) return null;
  return {
    vault: u.vault,
    payer: u.payer,
    pkSeed: Uint8Array.from(u.pkSeed),
    tree: u.tree,
    leaf: u.leaf,
    actionBytes: Uint8Array.from(u.action).slice(0, u.actionLen),
    frozen: u.frozen !== 0,
    written: BigInt(u.written.toString()),
    verified: BigInt(u.verified.toString()),
  };
}

/** Whether a buffer holds exactly this signed action (same key, leaf and message). */
export function bufferHolds(b: UnlockBuffer, s: SignedAction): boolean {
  return b.tree === s.tree && b.leaf === s.leaf && equal(b.pkSeed, s.pkSeed) && equal(b.actionBytes, encodeAction(s.action));
}

/**
 * The steps still to send given the payer's buffer. A buffer only counts as progress if it holds
 * exactly this action; anything else in it is closed first (cancel_unlock).
 */
export async function remainingSteps(program: Program<Noxvault>, payer: PublicKey, s: SignedAction, steps: PlanStep[]): Promise<PlanStep[]> {
  const buf = await fetchBuffer(program, s.vault, payer);
  if (!buf) return steps;
  if (!bufferHolds(buf, s)) {
    const ix = await program.methods.cancelUnlock().accountsPartial({ payer, unlock: unlockPda(s.vault, payer, program.programId) }).instruction();
    return [{ label: "close stale buffer", ix, cost: 50, kind: "open" }, ...steps];
  }
  const all = (word: bigint, [from, to]: [number, number]) => {
    for (let j = from; j < to; j++) if (((word >> BigInt(j)) & 1n) === 0n) return false;
    return true;
  };
  return steps.filter((st) => {
    if (st.kind === "open") return false;
    if (st.kind === "write") return !(buf.frozen || all(buf.written, st.chains!));
    if (st.kind === "verify") return !all(buf.verified, st.chains!);
    return true;
  });
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

export async function executePendingIx(program: Program<Noxvault>, payer: PublicKey, vault: PublicKey, state: VaultStateView, tokenProgram = TOKEN_PROGRAM_ID) {
  if (!state.pending) throw new Error("No withdrawal is pending");
  const { mint, dest } = state.pending;
  const st = statePda(vault, program.programId);
  if (mint.equals(SOL_MINT))
    return program.methods.executePending().accountsPartial({ state: st, vault, dest, systemProgram: SystemProgram.programId }).instruction();
  const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true, tokenProgram);
  return program.methods
    .executePendingToken()
    .accountsPartial({
      payer,
      state: st,
      vault,
      mint,
      vaultAta: ata(vault),
      dest,
      destAta: ata(dest),
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// ---------- preflight ----------

/**
 * Checks an action BEFORE it is signed. A one-time key signs exactly one message, so a message
 * that can never execute would burn a key for nothing or tempt a second signature.
 * `errors` must be empty before signing; `warnings` need the user's explicit consent.
 */
export async function preflightAction(p: Omit<ActionParams, "hashesPerTx">): Promise<{ errors: string[]; warnings: string[] }> {
  const { program, vault, signer, leaf, action } = p;
  const conn = program.provider.connection;
  const programId = program.programId;
  const errors: string[] = [];
  const warnings: string[] = [];

  const state = await fetchState(program, vault);
  if (!state) return { errors: ["This vault is not initialized yet."], warnings };
  const c = state.config;
  const root = signer.tree === TREE_PRIMARY ? c.primaryRoot : c.recoveryRoot;
  if (!equal(root, signer.pub.root)) errors.push("These words do not belong to this vault.");
  if (leafUsed(state, signer.tree, leaf)) errors.push(`One-time key #${leaf} is already used.`);

  // The one rule that matters most: this key may only ever sign one message.
  try {
    const digest = actionDigest(programId, vault, signer.tree, leaf, action);
    const forLeaf = (await findSignedMessages(program, vault, signer)).filter((m) => m.leaf === leaf);
    if (forLeaf.length > 1) errors.push(`One-time key #${leaf} has already signed two different messages. Do not use it.`);
    else if (forLeaf.length === 1 && !equal(forLeaf[0].digest, digest))
      errors.push(`One-time key #${leaf} already signed a different ${forLeaf[0].action.kind}. It can only complete that one.`);
  } catch (e) {
    errors.push(`Could not read this vault's history, so it is not safe to sign (${(e as Error).message}).`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (signer.tree === TREE_RECOVERY && action.kind !== "cancel") {
    const opensAt = state.lastActive + Number(c.recoveryDelay);
    if (now < opensAt) errors.push(`The recovery key can only cancel until ${new Date(opensAt * 1000).toISOString()}.`);
  }
  if (action.kind === "cancel" && !state.pending) warnings.push("Nothing is pending; this only uses up a one-time key.");

  const [vaultInfo, rentMin] = await Promise.all([
    conn.getAccountInfo(vault, "confirmed"),
    conn.getMinimumBalanceForRentExemption(0),
  ]);
  const lamports = BigInt(vaultInfo?.lamports ?? 0);
  let solOut = action.fee;
  if (action.fee > 0n && equal(action.feePayee, vault.toBytes())) errors.push("The fee cannot be paid to the vault itself.");

  if (action.kind === "withdraw") {
    const mint = new PublicKey(action.mint);
    const dest = new PublicKey(action.dest);
    if (dest.equals(vault)) errors.push("The destination cannot be the vault itself.");
    const wl = c.whitelist.map((k) => new PublicKey(k));
    const outside = signer.tree === TREE_PRIMARY && wl.length > 0 && !wl.some((k) => k.equals(dest));
    if (outside && c.slowDelay === 0n) errors.push("This vault only pays out to its whitelist.");
    if (outside && c.slowDelay > 0n) {
      if (state.pending) errors.push("A withdrawal is already pending. Wait for it or cancel it first.");
      warnings.push(`This address is not on the whitelist: the withdrawal waits ${Number(c.slowDelay) / 3600} h and can be cancelled meanwhile.`);
    }
    if (mint.equals(SOL_MINT)) {
      if (!outside) solOut += action.amount;
      const destInfo = await conn.getAccountInfo(dest, "confirmed");
      if (!destInfo && action.amount < BigInt(rentMin))
        errors.push(`The destination is empty, so it must receive at least ${rentMin / 1e9} SOL.`);
    } else {
      errors.push(...(await tokenChecks(conn, vault, mint, action.amount, p.tokenProgram ?? TOKEN_PROGRAM_ID, warnings)));
    }
  } else if (action.kind === "stake") {
    solOut += action.amount;
    const [voteInfo, stakeInfo, minDelegation, stakeRent] = await Promise.all([
      conn.getAccountInfo(new PublicKey(action.vote), "confirmed"),
      conn.getAccountInfo(stakePda(vault, action.seed, programId), "confirmed"),
      conn.getStakeMinimumDelegation().then((r) => r.value).catch(() => 1),
      conn.getMinimumBalanceForRentExemption(200),
    ]);
    if (!voteInfo || !voteInfo.owner.equals(VOTE_PROGRAM_ID)) errors.push("That is not a validator vote account.");
    if (stakeInfo) errors.push(`Stake slot #${action.seed} is already in use; pick another.`);
    if (action.amount < BigInt(stakeRent + minDelegation)) errors.push(`Stake at least ${(stakeRent + minDelegation) / 1e9} SOL.`);
  } else if (action.kind === "unstake" || action.kind === "collectStake") {
    const info = await conn.getAccountInfo(stakePda(vault, action.seed, programId), "confirmed");
    if (!info) errors.push(`Stake slot #${action.seed} is empty.`);
    if (action.kind === "collectStake") warnings.push("Collecting only works once the stake is fully deactivated (the epoch after unstaking).");
  }

  if (solOut > lamports) errors.push("The vault holds less SOL than this needs (amount plus fee).");
  const left = lamports - solOut;
  if (solOut <= lamports && left > 0n && left < BigInt(rentMin))
    errors.push(`This would leave ${Number(left) / 1e9} SOL in the vault, below the rent minimum. Withdraw everything or leave at least ${rentMin / 1e9} SOL.`);
  return { errors, warnings };
}

async function tokenChecks(conn: Connection, vault: PublicKey, mint: PublicKey, amount: bigint, tokenProgram: PublicKey, warnings: string[]): Promise<string[]> {
  const errors: string[] = [];
  try {
    const acct = await getAccount(conn, getAssociatedTokenAddressSync(mint, vault, true, tokenProgram), "confirmed", tokenProgram);
    if (amount > acct.amount) errors.push("The vault holds less of this token than this amount.");
    if (acct.isFrozen) errors.push("The vault's token account is frozen by the token's issuer.");
  } catch {
    errors.push("The vault has no account for this token.");
  }
  try {
    const m = await getMint(conn, mint, "confirmed", tokenProgram);
    if (m.freezeAuthority) warnings.push("This token has a freeze authority: its issuer could block the withdrawal.");
    const blocking = [
      ExtensionType.TransferFeeConfig,
      ExtensionType.TransferHook,
      ExtensionType.NonTransferable,
      ExtensionType.PermanentDelegate,
      ExtensionType.ConfidentialTransferMint,
    ];
    const exts = getExtensionTypes(m.tlvData).filter((e) => blocking.includes(e));
    if (exts.length) errors.push(`This token uses Token-2022 extensions Noxvault does not support (${exts.map((e) => ExtensionType[e]).join(", ")}).`);
  } catch {
    errors.push("Could not read this token's mint.");
  }
  return errors;
}

/** Token program that owns a mint, read from chain. */
export async function mintTokenProgram(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("Mint not found");
  if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Not a token mint");
  return info.owner;
}

/** The vault's stake accounts in slots 0..slots-1 (null where empty). */
export async function vaultStakes(program: Program<Noxvault>, vault: PublicKey, slots = 8) {
  const keys = Array.from({ length: slots }, (_, s) => stakePda(vault, s, program.programId));
  const infos = await program.provider.connection.getMultipleAccountsInfo(keys, "confirmed");
  return keys.map((k, s) => (infos[s] ? { seed: s, address: k, lamports: infos[s]!.lamports } : null));
}
