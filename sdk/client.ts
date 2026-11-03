// Noxvault v4 client: secrets, vault configs, addresses, action plans, history, preflight and
// builders for every permissionless instruction. See docs/SPEC.md; every rule a client must
// follow lives in this file.
import { BN, BorshInstructionCoder, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
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
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
} from "@solana/spl-token";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { randomBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import type { Noxvault } from "./idl/noxvault";
import idl from "./idl/noxvault.json";
import {
  Action,
  Config,
  Heir,
  Kind,
  LEN,
  PRIMARY_HEIGHT,
  PublicTree,
  RECOVERY_HEIGHT,
  TreeCfg,
  TreeSeeds,
  actionHash,
  authPath,
  buildTree,
  configHash,
  encodeAction,
  equal,
  messageDigest,
  normalizeWords,
  seedIndex,
  sign,
  treeSeeds,
  verifyCost,
} from "./wots";

export { idl, normalizeWords };
export type { Noxvault };
export const PROGRAM_ID = new PublicKey(idl.address);
export const SOL_MINT = PublicKey.default;
export const STAKE_CONFIG_ID = new PublicKey("StakeConfig11111111111111111111111111111111");
export const VOTE_PROGRAM_ID = new PublicKey("Vote111111111111111111111111111111111111111");
/** docs/SPEC.md §7: first i with SHA256("noxvault/canary/v1" || u32le(i)) on the curve (i = 0). */
export const CANARY_ADDRESS = new PublicKey("6S396A19NFHWdABtBP17tjfFCZA9LJuuvuPK7hWzj7w9");
export const SIGNER_SLOTS = 3;
export const RECOVERY_TREE = 3;
/** The duress tree (docs/SPEC.md §11): its own phrase, stored in config.duress. */
export const DURESS_TREE = 4;
export const DEFAULT_DURESS_LIMIT = 500_000_000n; // 0.5 SOL
export const DEFAULT_DURESS_LOCK_SECS = 3 * 86_400;
export const TREE_PRIMARY = 0; // the creating owner's slot
export const DAY = 86_400;

/** Hash calls one transaction may spend. Measured ~180 CU each; 6500 stays well under 1.4M CU. */
export const HASHES_PER_TX = 6500;
/** Chains per write_sigs instruction; the packer fits as many as the 1232-byte limit allows. */
export const SIGS_PER_WRITE = 12;

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const ZERO32 = new Uint8Array(32);

// ---------- rate limits ----------

/** Retries an RPC call on rate limits (429) with exponential backoff; other errors pass through. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= attempts || !/429|Too many requests|rate limit/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

// ---------- secrets ----------

export function newMasterSecret(): Uint8Array {
  return randomBytes(32);
}

export function secretToWords(master: Uint8Array): string {
  return entropyToMnemonic(master, wordlist);
}

export function wordsToSecret(words: string): Uint8Array {
  const clean = normalizeWords(words).join(" ");
  if (!validateMnemonic(clean, wordlist)) throw new Error("Those words are not a valid Noxvault phrase");
  const master = mnemonicToEntropy(clean, wordlist);
  if (master.length !== 32) throw new Error("A Noxvault phrase is 24 words");
  return master;
}

// ---------- trees and configs ----------

/** A tree whose secret this client holds. `tree` is its slot in the vault: 0..2 signer, 3 recovery, 4 duress. */
export interface Signer {
  tree: number;
  seeds: TreeSeeds;
  pub: PublicTree;
}

/**
 * Builds a phrase's tree for vault number `vaultNumber` (a few seconds for a signer tree).
 * `slot` is where the tree sits in the vault config; recovery and duress trees use their own
 * seed ranges (docs/SPEC.md §2), so one phrase never yields the same tree in two roles.
 */
export function makeSigner(master: Uint8Array, vaultNumber: number, slot: number, onLeaf?: (done: number, total: number) => void): Signer {
  const range = slot === RECOVERY_TREE ? 1 : slot === DURESS_TREE ? 2 : 0;
  const seeds = treeSeeds(master, seedIndex(vaultNumber, range));
  return { tree: slot, seeds, pub: buildTree(seeds, slot === RECOVERY_TREE ? RECOVERY_HEIGHT : PRIMARY_HEIGHT, onLeaf) };
}

/**
 * The duress tree of a duress phrase (its own 24 words, never the owner's main phrase) for
 * vault number `vaultNumber`. Pass its root as `duressRoot` to `makeConfig`; sign with it like
 * any other signer: it can only withdraw SOL, capped at the duress limit, and starts a lockdown.
 */
export function makeDuressSigner(master: Uint8Array, vaultNumber: number, onLeaf?: (done: number, total: number) => void): Signer {
  return makeSigner(master, vaultNumber, DURESS_TREE, onLeaf);
}

/** Tree `idx` of a config: 0..2 signers, 3 recovery, 4 duress. */
export function treeOf(c: Config, idx: number): TreeCfg {
  if (idx === DURESS_TREE) return c.duress;
  if (idx < 0 || idx > RECOVERY_TREE) throw new Error(`no tree ${idx}`);
  return c.trees[idx];
}

/**
 * The duress root of a vault without a duress phrase: derived from the owner's secret seed, so
 * it is reproducible by the owner (the vault address stays a pure function of phrase + settings)
 * and indistinguishable from a random root to everyone else. No key exists for it.
 */
export function decoyDuressRoot(primary: Signer): Uint8Array {
  return sha256(new Uint8Array([...enc.encode("nox4/decoy-duress"), ...primary.seeds.skSeed]));
}

/** Re-labels a signer for another slot (a co-signer's tree is built once, then placed). */
export function inSlot(s: Signer, slot: number): Signer {
  return { ...s, tree: slot };
}

export interface VaultSettings {
  coSigners?: Uint8Array[]; // roots of up to 2 more signer trees (other people's phrases)
  threshold?: number; // signer approvals needed (default 1)
  recoveryRoot?: Uint8Array; // a recovery holder's tree root; omit for none
  recoveryDelaySecs?: number; // inactivity before recovery may act fully (default 180 days)
  whitelist?: PublicKey[]; // up to 4
  slowDelaySecs?: number; // wait for restricted withdrawals; 0 = refuse them
  instantLimitLamports?: bigint; // restricted SOL that may skip the wait per 24 h
  heirs?: { addr: PublicKey; bps: number }[]; // testament; bps sum to 10000
  testamentDelaySecs?: number; // inactivity before the testament runs (default 365 days if heirs)
  duressRoot?: Uint8Array; // root of a duress phrase's tree (makeDuressSigner); omit for a decoy
  duressLimitLamports?: bigint; // paid at once by a duress withdrawal (default 0.5 SOL)
  duressLockSecs?: number; // lockdown after a duress withdrawal (default 3 days, at least 1 day)
}

export function makeConfig(primary: Signer, s: VaultSettings = {}): Config {
  const signerRoots = [primary.pub.root, ...(s.coSigners ?? [])];
  if (signerRoots.length > SIGNER_SLOTS) throw new Error("at most 3 signer trees");
  const trees = [0, 1, 2].map((i) => (signerRoots[i] ? { root: signerRoots[i], height: PRIMARY_HEIGHT } : { root: ZERO32, height: 0 }));
  trees.push(s.recoveryRoot ? { root: s.recoveryRoot, height: RECOVERY_HEIGHT } : { root: ZERO32, height: 0 });
  const heirs: Heir[] = (s.heirs ?? []).map((h) => ({ addr: h.addr.toBytes(), bps: h.bps }));
  return {
    trees,
    threshold: s.threshold ?? 1,
    recoveryDelay: BigInt(s.recoveryRoot ? s.recoveryDelaySecs ?? 180 * DAY : 0),
    whitelist: (s.whitelist ?? []).map((k) => k.toBytes()),
    slowDelay: BigInt(s.slowDelaySecs ?? 0),
    instantLimit: s.instantLimitLamports ?? 0n,
    heirs,
    testamentDelay: BigInt(heirs.length ? s.testamentDelaySecs ?? 365 * DAY : 0),
    // Always filled, so no vault reveals whether it has a duress phrase (docs/SPEC.md §11).
    duress: { root: s.duressRoot ?? decoyDuressRoot(primary), height: s.duressRoot ? PRIMARY_HEIGHT : primary.pub.height },
    duressLimit: s.duressLimitLamports ?? DEFAULT_DURESS_LIMIT,
    duressLock: BigInt(s.duressLockSecs ?? DEFAULT_DURESS_LOCK_SECS),
  };
}

const pk = (b: Uint8Array) => new PublicKey(b);
const bn = (n: bigint) => new BN(n.toString());

export function toAnchorConfig(c: Config) {
  const pad = <T>(xs: T[], e: T) => [...xs, ...Array(4 - xs.length).fill(e)];
  return {
    trees: c.trees.map((t) => ({ root: Array.from(t.root), height: t.height })),
    threshold: c.threshold,
    recoveryDelay: bn(c.recoveryDelay),
    whitelist: pad(c.whitelist, ZERO32).map(pk),
    slowDelay: bn(c.slowDelay),
    instantLimit: bn(c.instantLimit),
    heirs: pad(c.heirs, { addr: ZERO32, bps: 0 }).map((h) => ({ addr: pk(h.addr), bps: h.bps })),
    testamentDelay: bn(c.testamentDelay),
    duress: { root: Array.from(c.duress.root), height: c.duress.height },
    duressLimit: bn(c.duressLimit),
    duressLock: bn(c.duressLock),
  };
}

export function toAnchorAction(a: Action) {
  const kind = (() => {
    switch (a.kind) {
      case "withdraw":
        return { withdraw: { mint: pk(a.mint), dest: pk(a.dest), amount: bn(a.amount) } };
      case "stake":
        return { stake: { seed: a.seed, vote: pk(a.vote), amount: bn(a.amount) } };
      case "unstake":
        return { unstake: { seed: a.seed } };
      case "collectStake":
        return { collectStake: { seed: a.seed } };
      case "cancel":
        return { cancel: {} };
      case "ping":
        return { ping: {} };
      case "schedule":
        return { schedule: { id: a.id, mint: pk(a.mint), dest: pk(a.dest), amount: bn(a.amount), interval: bn(a.interval), count: a.count, start: bn(a.start) } };
      case "cancelSchedule":
        return { cancelSchedule: { id: a.id } };
      case "budget":
        return { budget: { id: a.id, session: pk(a.session), mint: pk(a.mint), limit: bn(a.limit), period: bn(a.period), expires: bn(a.expires) } };
      case "cancelBudget":
        return { cancelBudget: { id: a.id } };
      case "migrate":
        return { migrate: { newVault: pk(a.newVault) } };
    }
  })();
  return { kind, fee: bn(a.fee), feePayee: pk(a.feePayee) };
}

export function actionFromAnchor(a: { kind: Record<string, Record<string, any>>; fee: BN; feePayee?: PublicKey; fee_payee?: PublicKey }): Action {
  const [kind, f] = Object.entries(a.kind)[0];
  const k = (p: PublicKey) => p.toBytes();
  const n = (x: BN) => BigInt(x.toString());
  const fee = { fee: n(a.fee), feePayee: k((a.feePayee ?? a.fee_payee)!) };
  switch (kind) {
    case "withdraw":
      return { kind, mint: k(f.mint), dest: k(f.dest), amount: n(f.amount), ...fee };
    case "stake":
      return { kind, seed: f.seed, vote: k(f.vote), amount: n(f.amount), ...fee };
    case "unstake":
    case "collectStake":
      return { kind, seed: f.seed, ...fee };
    case "cancel":
    case "ping":
      return { kind, ...fee };
    case "schedule":
      return { kind, id: f.id, mint: k(f.mint), dest: k(f.dest), amount: n(f.amount), interval: n(f.interval), count: f.count, start: n(f.start), ...fee };
    case "cancelSchedule":
    case "cancelBudget":
      return { kind, id: f.id, ...fee };
    case "budget":
      return { kind, id: f.id, session: k(f.session), mint: k(f.mint), limit: n(f.limit), period: n(f.period), expires: n(f.expires), ...fee };
    case "migrate":
      return { kind, newVault: k(f.newVault ?? f.new_vault), ...fee };
  }
  throw new Error(`unknown action ${kind}`);
}

// ---------- addresses ----------

const seed = (s: string) => enc.encode(s);

export function vaultPda(hash: Uint8Array, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("vault"), hash], programId)[0];
}
export function vaultOf(config: Config, programId = PROGRAM_ID): PublicKey {
  return vaultPda(configHash(config), programId);
}
export function statePda(vault: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("state"), vault.toBytes()], programId)[0];
}
export function unlockPda(vault: PublicKey, payer: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("unlock"), vault.toBytes(), payer.toBytes()], programId)[0];
}
export function approvalPda(vault: PublicKey, action: Action, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("approval"), vault.toBytes(), actionHash(action)], programId)[0];
}
export function stakePda(vault: PublicKey, s: number, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("stake"), vault.toBytes(), Uint8Array.of(s)], programId)[0];
}
export function schedulePda(vault: PublicKey, id: number, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("schedule"), vault.toBytes(), Uint8Array.of(id)], programId)[0];
}
export function budgetPda(vault: PublicKey, id: number, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("budget"), vault.toBytes(), Uint8Array.of(id)], programId)[0];
}
export function inboxPda(vault: PublicKey, id: number, programId = PROGRAM_ID): PublicKey {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, id, true);
  return PublicKey.findProgramAddressSync([seed("inbox"), vault.toBytes(), b], programId)[0];
}
export function linkPda(wallet: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("link"), wallet.toBytes()], programId)[0];
}
export function escapePda(wallet: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("escape"), wallet.toBytes()], programId)[0];
}
export function canaryPda(programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("canary")], programId)[0];
}

const ata = (mint: PublicKey, owner: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) => getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);

// ---------- protocol and $NOX tiers (docs/SPEC.md §10) ----------

export const TIER_FREE = 0;
export const TIER_GUARDIAN = 1;
export const TIER_SENTINEL = 2;
export const TIER_NAMES = ["Free", "Guardian", "Sentinel"] as const;

export interface ProtocolView {
  admin: PublicKey;
  noxMint: PublicKey; // default = tiers off
  guardian: bigint;
  sentinel: bigint;
  createFee: bigint; // lamports
  treasury: PublicKey;
  frozen: boolean;
}

export function protocolPda(programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("protocol")], programId)[0];
}

export async function fetchProtocol(program: Program<Noxvault>): Promise<ProtocolView | null> {
  const p = await withRetry(() => program.account.protocol.fetchNullable(protocolPda(program.programId), "confirmed"));
  if (!p) return null;
  return {
    admin: p.admin,
    noxMint: p.params.noxMint,
    guardian: BigInt(p.params.guardian.toString()),
    sentinel: BigInt(p.params.sentinel.toString()),
    createFee: BigInt(p.params.createFee.toString()),
    treasury: p.params.treasury,
    frozen: p.frozen,
  };
}

export interface ProtocolParamsInput {
  noxMint: PublicKey;
  guardian: bigint;
  sentinel: bigint;
  createFee: bigint;
  treasury: PublicKey;
}

const toAnchorParams = (p: ProtocolParamsInput) => ({ noxMint: p.noxMint, guardian: bn(p.guardian), sentinel: bn(p.sentinel), createFee: bn(p.createFee), treasury: p.treasury });

export async function initProtocolIx(program: Program<Noxvault>, admin: PublicKey, params: ProtocolParamsInput) {
  return program.methods.initProtocol(toAnchorParams(params)).accountsPartial({ admin, protocol: protocolPda(program.programId), systemProgram: SystemProgram.programId }).instruction();
}

export async function updateProtocolIx(program: Program<Noxvault>, admin: PublicKey, params: ProtocolParamsInput) {
  return program.methods.updateProtocol(toAnchorParams(params)).accountsPartial({ admin, protocol: protocolPda(program.programId) }).instruction();
}

/** The vault's $NOX account (its ATA under the mint's token program), if it exists. */
export async function noxAccountOf(program: Program<Noxvault>, vault: PublicKey, protocol: ProtocolView | null): Promise<PublicKey | null> {
  if (!protocol || protocol.noxMint.equals(PublicKey.default)) return null;
  const conn = program.provider.connection;
  const mintInfo = await withRetry(() => conn.getAccountInfo(protocol.noxMint, "confirmed"));
  if (!mintInfo) return null;
  const address = ata(protocol.noxMint, vault, mintInfo.owner);
  return (await withRetry(() => conn.getAccountInfo(address, "confirmed"))) ? address : null;
}

export interface TierView {
  tier: number;
  name: (typeof TIER_NAMES)[number];
  held: bigint; // $NOX base units in the vault
  next: bigint | null; // base units still needed for the next tier
  tiersOn: boolean;
}

/** A vault's $NOX tier, exactly as the program computes it. */
export async function vaultTier(program: Program<Noxvault>, vault: PublicKey, protocol?: ProtocolView | null): Promise<TierView> {
  const p = protocol === undefined ? await fetchProtocol(program) : protocol;
  if (!p || p.noxMint.equals(PublicKey.default)) return { tier: TIER_SENTINEL, name: "Sentinel", held: 0n, next: null, tiersOn: false };
  const acct = await noxAccountOf(program, vault, p);
  let held = 0n;
  if (acct) {
    const info = await withRetry(() => program.provider.connection.getTokenAccountBalance(acct, "confirmed"));
    held = BigInt(info.value.amount);
  }
  const tier = held >= p.sentinel ? TIER_SENTINEL : held >= p.guardian ? TIER_GUARDIAN : TIER_FREE;
  const next = tier === TIER_FREE ? p.guardian - held : tier === TIER_GUARDIAN ? p.sentinel - held : null;
  return { tier, name: TIER_NAMES[tier], held, next, tiersOn: true };
}

/** The tier a config needs (multi-signer → Sentinel, testament → Guardian). */
export function tierNeeded(c: Config): number {
  const signers = c.trees.slice(0, SIGNER_SLOTS).filter((t) => !equal(t.root, ZERO32)).length;
  if (signers > 1) return TIER_SENTINEL;
  if (c.testamentDelay > 0n && c.heirs.length) return TIER_GUARDIAN;
  return TIER_FREE;
}

export async function initVaultIx(program: Program<Noxvault>, payer: PublicKey, config: Config) {
  const vault = vaultOf(config, program.programId);
  const protocol = await fetchProtocol(program);
  if (!protocol) throw new Error("The Noxvault protocol account is not initialized on this cluster.");
  const noxAccount = await noxAccountOf(program, vault, protocol);
  return program.methods
    .initVault(toAnchorConfig(config) as never)
    .accountsPartial({
      payer,
      vault,
      state: statePda(vault, program.programId),
      protocol: protocolPda(program.programId),
      noxAccount,
      treasury: protocol.treasury,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// ---------- state ----------

export interface PendingView {
  kind: "withdraw" | "migrate";
  mint: PublicKey;
  dest: PublicKey;
  amount: bigint;
  executableAt: number;
}

export interface VaultStateView {
  vault: PublicKey;
  config: Config;
  used: Uint8Array[];
  lastActive: number;
  createdAt: number;
  actions: number;
  pending: PendingView | null;
  windowStart: number;
  windowSpent: bigint;
  migrateTo: PublicKey | null;
  lockdownUntil: number; // unix seconds; locked while now < lockdownUntil
}

export function decodeState(program: Program<Noxvault>, data: Buffer): VaultStateView {
  const s = program.coder.accounts.decode("vaultState", data);
  const c = s.config;
  const live = (k: PublicKey) => !k.equals(PublicKey.default);
  return {
    vault: s.vault,
    config: {
      trees: c.trees.map((t: { root: number[]; height: number }) => ({ root: Uint8Array.from(t.root), height: t.height })),
      threshold: c.threshold,
      recoveryDelay: BigInt(c.recoveryDelay.toString()),
      whitelist: (c.whitelist as PublicKey[]).filter(live).map((k) => k.toBytes()),
      slowDelay: BigInt(c.slowDelay.toString()),
      instantLimit: BigInt(c.instantLimit.toString()),
      heirs: (c.heirs as { addr: PublicKey; bps: number }[]).filter((h) => live(h.addr)).map((h) => ({ addr: h.addr.toBytes(), bps: h.bps })),
      testamentDelay: BigInt(c.testamentDelay.toString()),
      duress: { root: Uint8Array.from(c.duress.root), height: c.duress.height },
      duressLimit: BigInt(c.duressLimit.toString()),
      duressLock: BigInt(c.duressLock.toString()),
    },
    used: (s.used as number[][]).map((u) => Uint8Array.from(u)),
    lastActive: Number(s.lastActive),
    createdAt: Number(s.createdAt),
    actions: s.actions,
    pending: s.pending
      ? {
          kind: s.pending.kind === 1 ? "migrate" : "withdraw",
          mint: s.pending.mint,
          dest: s.pending.dest,
          amount: BigInt(s.pending.amount.toString()),
          executableAt: Number(s.pending.executableAt),
        }
      : null,
    windowStart: Number(s.windowStart),
    windowSpent: BigInt(s.windowSpent.toString()),
    migrateTo: s.migrateTo ?? null,
    lockdownUntil: Number(s.lockdownUntil),
  };
}

/** Whether the vault is in lockdown after a duress withdrawal (docs/SPEC.md §11). */
export function inLockdown(state: VaultStateView, now = Math.floor(Date.now() / 1000)): boolean {
  return now < state.lockdownUntil;
}

export async function fetchState(program: Program<Noxvault>, vault: PublicKey): Promise<VaultStateView | null> {
  const info = await withRetry(() => program.provider.connection.getAccountInfo(statePda(vault, program.programId), "confirmed"));
  return info ? decodeState(program, info.data) : null;
}

export function leafUsed(state: VaultStateView, tree: number, leaf: number): boolean {
  return (state.used[tree][leaf >> 3] & (1 << (leaf & 7))) !== 0;
}

export function keysLeft(state: VaultStateView, tree: number): number {
  const h = treeOf(state.config, tree).height;
  let used = 0;
  for (let l = 0; l < 1 << h; l++) if (leafUsed(state, tree, l)) used++;
  return (1 << h) - used;
}

export function isRestricted(c: Config, dest: PublicKey): boolean {
  if (c.whitelist.length) return !c.whitelist.some((k) => equal(k, dest.toBytes()));
  return c.instantLimit > 0n;
}

/** Size of the config fields before `duress` (trees .. testament_delay), as encodeConfig writes them. */
const CONFIG_V3_LEN = 4 * 33 + 1 + 8 + 4 * 32 + 8 + 8 + 4 * 34 + 8;

/** Byte offset of the root of tree `slot` (0..3 in config.trees, 4 = config.duress) inside a VaultState account. */
export const treeRootOffset = (slot: number) => 8 + 32 + 1 + 32 + (slot === DURESS_TREE ? CONFIG_V3_LEN : slot * 33);

/** Vaults in which this signer's tree sits in its slot range. Needs an RPC that allows getProgramAccounts. */
export async function findVaultsFor(program: Program<Noxvault>, signer: Signer): Promise<{ state: VaultStateView; slot: number }[]> {
  const slots = signer.tree === RECOVERY_TREE ? [RECOVERY_TREE] : signer.tree === DURESS_TREE ? [DURESS_TREE] : [0, 1, 2];
  const out: { state: VaultStateView; slot: number }[] = [];
  for (const slot of slots) {
    const accts = await withRetry(() =>
      program.provider.connection.getProgramAccounts(program.programId, {
        commitment: "confirmed",
        filters: [{ memcmp: { offset: treeRootOffset(slot), bytes: Buffer.from(signer.pub.root).toString("base64"), encoding: "base64" } as never }],
      })
    );
    for (const a of accts) out.push({ state: decodeState(program, a.account.data), slot });
  }
  return out;
}

export interface ApprovalView {
  address: PublicKey;
  trees: number; // bitmap
  creator: PublicKey;
  createdAt: number;
  action: Action;
}

export async function fetchApproval(program: Program<Noxvault>, vault: PublicKey, action: Action): Promise<ApprovalView | null> {
  const address = approvalPda(vault, action, program.programId);
  const a = await withRetry(() => program.account.approval.fetchNullable(address, "confirmed"));
  if (!a) return null;
  return { address, trees: a.trees, creator: a.creator, createdAt: Number(a.createdAt), action };
}

/** Every open approval of a vault (e.g. waiting for a co-signer). */
export async function vaultApprovals(program: Program<Noxvault>, vault: PublicKey): Promise<ApprovalView[]> {
  const coder = program.coder.types;
  const all = await withRetry(() => program.account.approval.all([{ memcmp: { offset: 8, bytes: vault.toBase58() } }]));
  return all.map((x) => {
    const bytes = Buffer.from(x.account.action.slice(0, x.account.actionLen));
    const action = actionFromAnchor(coder.decode("action", bytes));
    return { address: x.publicKey, trees: x.account.trees, creator: x.account.creator, createdAt: Number(x.account.createdAt), action };
  });
}

const isCancelKind = (a: Action) => a.kind === "cancel" || a.kind === "cancelSchedule" || a.kind === "cancelBudget";

/** Whether an approval set (bitmap) lets the action execute now (docs/SPEC.md §4, §11). */
export function canExecute(state: VaultStateView, trees: number, action: Action, now = Math.floor(Date.now() / 1000)): boolean {
  const signers = [0, 1, 2].filter((t) => trees & (1 << t)).length;
  if (signers >= state.config.threshold) return !inLockdown(state, now) || isCancelKind(action) || action.kind === "ping";
  if (trees & (1 << RECOVERY_TREE)) {
    if (isCancelKind(action)) return true;
    return now >= state.lastActive + Number(state.config.recoveryDelay);
  }
  if (trees === 1 << DURESS_TREE) return action.kind === "withdraw" && equal(action.mint, ZERO32);
  return false;
}

// ---------- signature history ----------

export interface SignedMessage {
  tree: number;
  leaf: number;
  action: Action;
  actionBytes: Uint8Array;
  digest: Uint8Array;
  chains: number[];
  buffers: PublicKey[];
  txs: string[];
}

/** Transactions fetched per request; public RPCs reject large batches with 429. */
const HISTORY_BATCH = 5;
const HISTORY_PAUSE_MS = 400;

/**
 * Every message this signer's tree has ever signed for this vault, read from the vault's full
 * transaction history (failed transactions included: their bytes are public too). A write
 * counts only if its values equal what this key signs for that buffer's message, so values
 * copied into a buffer with a different message do not count. Throws if history is unreadable.
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
  sigs.reverse();

  type Opened = { tree: number; leaf: number; pkSeed: Uint8Array; action: Action };
  const lastOpen = new Map<string, Opened>();
  const found = new Map<string, SignedMessage>();
  const expected = new Map<string, Uint8Array[]>();

  for (let i = 0; i < sigs.length; i += HISTORY_BATCH) {
    const batch = sigs.slice(i, i + HISTORY_BATCH);
    if (i) await new Promise((r) => setTimeout(r, HISTORY_PAUSE_MS)); // stay under public-RPC per-method limits
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
          const o: Opened = { tree: data.tree, leaf: data.leaf, pkSeed: Uint8Array.from(data.pkSeed ?? data.pk_seed), action: actionFromAnchor(data.action) };
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
          const m = found.get(id) ?? ({ tree: o.tree, leaf: o.leaf, action: o.action, actionBytes, digest, chains: [], buffers: [], txs: [] } as SignedMessage);
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
 * The leaf to sign with: a leaf whose signed message is unfinished comes first (it can only
 * ever complete that message); otherwise the lowest leaf never used and never signed.
 */
export function pickLeaf(state: VaultStateView, signer: Signer, signed: SignedMessage[]): { leaf: number; resume?: SignedMessage } {
  const unfinished = signed.find((m) => !leafUsed(state, signer.tree, m.leaf));
  if (unfinished) return { leaf: unfinished.leaf, resume: unfinished };
  const taken = new Set(signed.map((m) => m.leaf));
  for (let l = 0; l < 1 << signer.pub.height; l++) if (!leafUsed(state, signer.tree, l) && !taken.has(l)) return { leaf: l };
  throw new Error("Every one-time key of this tree is used. Migrate to a new vault.");
}

// ---------- plan ----------

export interface ActionParams {
  program: Program<Noxvault>;
  payer: PublicKey;
  vault: PublicKey;
  signer: Signer;
  leaf: number;
  action: Action;
  tokenProgram?: PublicKey; // for token actions: TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
  hashesPerTx?: number;
  /** Execute right after approving. Default: when this approval completes the rules. */
  execute?: boolean;
}

export interface ActionPlan {
  digest: Uint8Array;
  signature: Uint8Array[];
  willExecute: boolean;
  transactions: { label: string; instructions: TransactionInstruction[] }[];
  steps: { label: string; ix: TransactionInstruction }[];
}

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

/**
 * The instruction that executes an approved action. `creator` is whoever opened the approval
 * (gets its rent back). `extra` carries accounts some actions need.
 */
export async function executeIx(
  program: Program<Noxvault>,
  payer: PublicKey,
  vault: PublicKey,
  action: Action,
  creator: PublicKey,
  extra: { tokenProgram?: PublicKey } = {}
): Promise<TransactionInstruction> {
  const programId = program.programId;
  const m = program.methods;
  const base = {
    approval: approvalPda(vault, action, programId),
    creator,
    state: statePda(vault, programId),
    vault,
    feePayee: action.fee > 0n ? pk(action.feePayee) : payer,
    systemProgram: SystemProgram.programId,
  };
  const tokenProgram = extra.tokenProgram ?? TOKEN_PROGRAM_ID;
  switch (action.kind) {
    case "withdraw": {
      const mint = pk(action.mint);
      const dest = pk(action.dest);
      if (mint.equals(SOL_MINT)) return m.executeWithdraw().accountsPartial({ ...base, dest }).instruction();
      return m
        .executeWithdrawToken()
        .accountsPartial({ ...base, payer, mint, vaultAta: ata(mint, vault, tokenProgram), dest, destAta: ata(mint, dest, tokenProgram), tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID })
        .instruction();
    }
    case "stake":
      return m
        .executeStake()
        .accountsPartial({
          ...base,
          stake: stakePda(vault, action.seed, programId),
          vote: pk(action.vote),
          clock: SYSVAR_CLOCK_PUBKEY,
          rent: SYSVAR_RENT_PUBKEY,
          stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
          stakeConfig: STAKE_CONFIG_ID,
          stakeProgram: StakeProgram.programId,
        })
        .instruction();
    case "unstake":
    case "collectStake":
      return m
        .executeStakeAuthority()
        .accountsPartial({ ...base, stake: stakePda(vault, action.seed, programId), clock: SYSVAR_CLOCK_PUBKEY, stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY, stakeProgram: StakeProgram.programId })
        .instruction();
    case "schedule":
    case "budget": {
      const protocol = await fetchProtocol(program);
      const tierAccts = { protocol: protocolPda(programId), noxAccount: await noxAccountOf(program, vault, protocol) };
      return action.kind === "schedule"
        ? m.executeCreateSchedule(action.id).accountsPartial({ ...base, ...tierAccts, payer, schedule: schedulePda(vault, action.id, programId) }).instruction()
        : m.executeCreateBudget(action.id).accountsPartial({ ...base, ...tierAccts, payer, budget: budgetPda(vault, action.id, programId) }).instruction();
    }
    case "cancel":
    case "ping":
    case "cancelSchedule":
    case "cancelBudget":
    case "migrate":
      return m
        .executeAdmin()
        .accountsPartial({
          ...base,
          schedule: action.kind === "cancelSchedule" ? schedulePda(vault, action.id, programId) : null,
          budget: action.kind === "cancelBudget" ? budgetPda(vault, action.id, programId) : null,
          newState: action.kind === "migrate" ? statePda(pk(action.newVault), programId) : null,
        })
        .instruction();
  }
}

export interface PlanStep {
  label: string;
  ix: TransactionInstruction;
  cost: number;
  kind: "open" | "write" | "verify" | "approve" | "execute";
  chains?: [number, number];
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
  opts: { tokenProgram?: PublicKey; hashesPerTx?: number; execute?: boolean; creator?: PublicKey } = {}
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
  if (!Buffer.from(open.data).includes(Buffer.from(actionBytes))) throw new Error("Action encoding mismatch between SDK and program. Refusing to sign.");

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
  const approve = await m
    .approve(Array.from(actionHash(action)))
    .accountsPartial({ payer, unlock, rentReceiver: payer, state: statePda(vault, programId), vault, approval: approvalPda(vault, action, programId), systemProgram: SystemProgram.programId })
    .instruction();
  steps.push({ label: "approve", ix: approve, cost: 300, kind: "approve" });
  if (opts.execute !== false) {
    const exec = await executeIx(program, payer, vault, action, opts.creator ?? payer, { tokenProgram: opts.tokenProgram });
    steps.push({ label: "execute", ix: exec, cost: action.kind === "stake" ? 900 : 700, kind: "execute" });
  }
  return steps;
}

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

/** Whether this signer's approval, added to the existing ones, lets the action execute. */
export async function completesApproval(program: Program<Noxvault>, vault: PublicKey, tree: number, action: Action) {
  const [state, existing] = await Promise.all([fetchState(program, vault), fetchApproval(program, vault, action)]);
  if (!state) throw new Error("This vault is not initialized.");
  const trees = (existing?.trees ?? 0) | (1 << tree);
  return { willExecute: canExecute(state, trees, action), creator: existing?.creator };
}

export async function planAction(p: ActionParams): Promise<ActionPlan> {
  const { program, payer, vault, signer, leaf, action } = p;
  const digest = actionDigest(program.programId, vault, signer.tree, leaf, action);
  const signature = sign(signer.seeds, leaf, digest);
  const status = p.execute === undefined ? await completesApproval(program, vault, signer.tree, action) : { willExecute: p.execute, creator: undefined };
  const steps = await buildSteps(
    program,
    payer,
    { vault, tree: signer.tree, leaf, pkSeed: signer.seeds.pkSeed, authPath: authPath(signer.pub, leaf), signature, action },
    { tokenProgram: p.tokenProgram, hashesPerTx: p.hashesPerTx, execute: status.willExecute, creator: status.creator ?? payer }
  );
  return {
    digest,
    signature,
    willExecute: status.willExecute,
    transactions: packSteps(payer, steps, p.hashesPerTx),
    steps: steps.map(({ label, ix }) => ({ label, ix })),
  };
}

export function txSize(payer: PublicKey, ixs: TransactionInstruction[]): number {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: PublicKey.default.toBase58() }).add(...ixs);
  try {
    return 1 + 64 + tx.serializeMessage().length;
  } catch {
    return Infinity;
  }
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
  const u = await withRetry(() => program.account.unlock.fetchNullable(unlockPda(vault, payer, program.programId), "confirmed"));
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

export function bufferHolds(b: UnlockBuffer, s: SignedAction): boolean {
  return b.tree === s.tree && b.leaf === s.leaf && equal(b.pkSeed, s.pkSeed) && equal(b.actionBytes, encodeAction(s.action));
}

/**
 * The steps still to send given the payer's buffer and the chain. A buffer only counts as
 * progress if it holds exactly this action; anything else in it is closed first. If the leaf
 * is already burned (approved), only execution can remain.
 */
export async function remainingSteps(program: Program<Noxvault>, payer: PublicKey, s: SignedAction, steps: PlanStep[]): Promise<PlanStep[]> {
  const state = await fetchState(program, s.vault);
  if (state && leafUsed(state, s.tree, s.leaf)) {
    const approval = await fetchApproval(program, s.vault, s.action);
    return approval ? steps.filter((st) => st.kind === "execute") : [];
  }
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

// ---------- permissionless follow-ups ----------

export async function executePendingIx(program: Program<Noxvault>, payer: PublicKey, vault: PublicKey, state: VaultStateView, tokenProgram = TOKEN_PROGRAM_ID) {
  if (!state.pending) throw new Error("Nothing is pending");
  const { mint, dest, kind } = state.pending;
  const st = statePda(vault, program.programId);
  if (kind === "migrate" || mint.equals(SOL_MINT))
    return program.methods.executePending().accountsPartial({ state: st, vault, dest, systemProgram: SystemProgram.programId }).instruction();
  return program.methods
    .executePendingToken()
    .accountsPartial({ payer, state: st, vault, mint, vaultAta: ata(mint, vault, tokenProgram), dest, destAta: ata(mint, dest, tokenProgram), tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
}

export interface ScheduleView {
  address: PublicKey;
  id: number;
  mint: PublicKey;
  dest: PublicKey;
  amount: bigint;
  interval: number;
  remaining: number;
  nextAt: number;
}

export async function vaultSchedules(program: Program<Noxvault>, vault: PublicKey): Promise<ScheduleView[]> {
  const all = await withRetry(() => program.account.schedule.all([{ memcmp: { offset: 8, bytes: vault.toBase58() } }]));
  return all.map(({ publicKey, account: s }) => ({
    address: publicKey,
    id: s.id,
    mint: s.mint,
    dest: s.dest,
    amount: BigInt(s.amount.toString()),
    interval: Number(s.interval),
    remaining: s.remaining,
    nextAt: Number(s.nextAt),
  }));
}

export async function runScheduleIx(program: Program<Noxvault>, payer: PublicKey, vault: PublicKey, s: ScheduleView, tokenProgram = TOKEN_PROGRAM_ID) {
  const state = statePda(vault, program.programId);
  if (s.mint.equals(SOL_MINT))
    return program.methods.runSchedule().accountsPartial({ schedule: s.address, state, vault, dest: s.dest, systemProgram: SystemProgram.programId }).instruction();
  return program.methods
    .runScheduleToken()
    .accountsPartial({ payer, schedule: s.address, state, vault, mint: s.mint, vaultAta: ata(s.mint, vault, tokenProgram), dest: s.dest, destAta: ata(s.mint, s.dest, tokenProgram), tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
}

export interface BudgetView {
  address: PublicKey;
  id: number;
  session: PublicKey;
  mint: PublicKey;
  limit: bigint;
  period: number;
  expires: number;
  windowStart: number;
  spent: bigint;
}

export async function vaultBudgets(program: Program<Noxvault>, vault: PublicKey): Promise<BudgetView[]> {
  const all = await withRetry(() => program.account.budget.all([{ memcmp: { offset: 8, bytes: vault.toBase58() } }]));
  return all.map(({ publicKey, account: b }) => ({
    address: publicKey,
    id: b.id,
    session: b.session,
    mint: b.mint,
    limit: BigInt(b.limit.toString()),
    period: Number(b.period),
    expires: Number(b.expires),
    windowStart: Number(b.windowStart),
    spent: BigInt(b.spent.toString()),
  }));
}

/** Left in a budget's current period. */
export function budgetLeft(b: BudgetView, now = Math.floor(Date.now() / 1000)): bigint {
  if (now >= b.expires) return 0n;
  return now >= b.windowStart + b.period ? b.limit : b.limit - b.spent;
}

/** A session key spends from its budget. The session key signs (and pays). */
export async function spendBudgetIx(program: Program<Noxvault>, vault: PublicKey, b: BudgetView, dest: PublicKey, amount: bigint, tokenProgram = TOKEN_PROGRAM_ID) {
  const state = statePda(vault, program.programId);
  if (b.mint.equals(SOL_MINT))
    return program.methods.spendBudget(bn(amount)).accountsPartial({ session: b.session, budget: b.address, state, vault, dest, systemProgram: SystemProgram.programId }).instruction();
  return program.methods
    .spendBudgetToken(bn(amount))
    .accountsPartial({ session: b.session, budget: b.address, state, vault, mint: b.mint, vaultAta: ata(b.mint, vault, tokenProgram), dest, destAta: ata(b.mint, dest, tokenProgram), tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
}

export async function migrateIxs(program: Program<Noxvault>, payer: PublicKey, vault: PublicKey, state: VaultStateView, mints: { mint: PublicKey; tokenProgram: PublicKey }[]) {
  if (!state.migrateTo) throw new Error("No migration has been approved");
  const st = statePda(vault, program.programId);
  const newVault = state.migrateTo;
  const ixs: TransactionInstruction[] = [];
  for (const { mint, tokenProgram } of mints)
    ixs.push(
      await program.methods
        .migrateToken()
        .accountsPartial({ payer, state: st, vault, mint, vaultAta: ata(mint, vault, tokenProgram), newVault, newAta: ata(mint, newVault, tokenProgram), tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .instruction()
    );
  ixs.push(await program.methods.migrateSol().accountsPartial({ state: st, vault, newVault, systemProgram: SystemProgram.programId }).instruction());
  return ixs;
}

export function testamentOpensAt(state: VaultStateView): number | null {
  if (!state.config.testamentDelay || !state.config.heirs.length) return null;
  return state.lastActive + Number(state.config.testamentDelay);
}

/** Testament payout for SOL (or one token): heirs in config order; ATAs created as needed. */
export async function testamentIxs(program: Program<Noxvault>, payer: PublicKey, vault: PublicKey, state: VaultStateView, token?: { mint: PublicKey; tokenProgram: PublicKey }) {
  const st = statePda(vault, program.programId);
  const heirs = state.config.heirs.map((h) => pk(h.addr));
  if (!token) {
    const ix = await program.methods.testamentSol().accountsPartial({ state: st, vault, systemProgram: SystemProgram.programId }).remainingAccounts(heirs.map((h) => ({ pubkey: h, isSigner: false, isWritable: true }))).instruction();
    return [ix];
  }
  const { mint, tokenProgram } = token;
  const heirAtas = heirs.map((h) => ata(mint, h, tokenProgram));
  const creates = heirs.map((h, i) => createAssociatedTokenAccountIdempotentInstruction(payer, heirAtas[i], h, mint, tokenProgram));
  const ix = await program.methods
    .testamentToken()
    .accountsPartial({ state: st, vault, mint, vaultAta: ata(mint, vault, tokenProgram), tokenProgram })
    .remainingAccounts(heirAtas.map((a) => ({ pubkey: a, isSigner: false, isWritable: true })))
    .instruction();
  return [...creates, ix];
}

export async function testamentStakeIx(program: Program<Noxvault>, vault: PublicKey, s: number, collect: boolean) {
  return program.methods
    .testamentStake(s, collect)
    .accountsPartial({ state: statePda(vault, program.programId), vault, stake: stakePda(vault, s, program.programId), clock: SYSVAR_CLOCK_PUBKEY, stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY, stakeProgram: StakeProgram.programId })
    .instruction();
}

export async function sweepInboxIxs(program: Program<Noxvault>, payer: PublicKey, vault: PublicKey, id: number, mints: { mint: PublicKey; tokenProgram: PublicKey }[] = []) {
  const st = statePda(vault, program.programId);
  const inbox = inboxPda(vault, id, program.programId);
  const ixs: TransactionInstruction[] = [];
  for (const { mint, tokenProgram } of mints)
    ixs.push(
      await program.methods
        .sweepInboxToken(id)
        .accountsPartial({ payer, state: st, vault, inbox, mint, inboxAta: ata(mint, inbox, tokenProgram), vaultAta: ata(mint, vault, tokenProgram), tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .instruction()
    );
  ixs.push(await program.methods.sweepInbox(id).accountsPartial({ state: st, vault, inbox, systemProgram: SystemProgram.programId }).instruction());
  return ixs;
}

// ---------- Escape Hatch, registry and canary ----------

export interface LinkView {
  wallet: PublicKey;
  vault: PublicKey;
  createdAt: number;
  panic: boolean;
  change: { vault: PublicKey; at: number } | null;
  escapeTx: Uint8Array;
}

export async function fetchLink(program: Program<Noxvault>, wallet: PublicKey): Promise<LinkView | null> {
  const l = await withRetry(() => program.account.link.fetchNullable(linkPda(wallet, program.programId), "confirmed"));
  if (!l) return null;
  return {
    wallet: l.wallet,
    vault: l.vault,
    createdAt: Number(l.createdAt),
    panic: l.panic,
    change: l.change ? { vault: l.change.vault, at: Number(l.change.at) } : null,
    escapeTx: Uint8Array.from(l.escapeTx),
  };
}

export async function registerLinkIx(program: Program<Noxvault>, wallet: PublicKey, vault: PublicKey) {
  return program.methods
    .registerLink()
    .accountsPartial({ wallet, state: statePda(vault, program.programId), vault, link: linkPda(wallet, program.programId), systemProgram: SystemProgram.programId })
    .instruction();
}

export async function requestLinkChangeIx(program: Program<Noxvault>, wallet: PublicKey, newVault: PublicKey) {
  return program.methods
    .requestLinkChange()
    .accountsPartial({ wallet, link: linkPda(wallet, program.programId), newState: statePda(newVault, program.programId), newVault, canary: canaryPda(program.programId) })
    .instruction();
}

export async function applyLinkChangeIx(program: Program<Noxvault>, wallet: PublicKey) {
  return program.methods.applyLinkChange().accountsPartial({ link: linkPda(wallet, program.programId), canary: canaryPda(program.programId) }).instruction();
}

export async function setPanicIx(program: Program<Noxvault>, wallet: PublicKey, on: boolean) {
  return program.methods.setPanic(on).accountsPartial({ wallet, link: linkPda(wallet, program.programId) }).instruction();
}

export async function setEscapeTxIx(program: Program<Noxvault>, wallet: PublicKey, tx: Uint8Array) {
  return program.methods.setEscapeTx(Buffer.from(tx)).accountsPartial({ wallet, link: linkPda(wallet, program.programId) }).instruction();
}

/** Lets the Escape Hatch move this token account (the wallet signs). */
export function escapeApproveIx(wallet: PublicKey, tokenAccount: PublicKey, tokenProgram = TOKEN_PROGRAM_ID, programId = PROGRAM_ID) {
  return createApproveInstruction(tokenAccount, escapePda(wallet, programId), wallet, BigInt("18446744073709551615"), [], tokenProgram);
}

export async function escapeTokenIx(program: Program<Noxvault>, payer: PublicKey, link: LinkView, source: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
  return program.methods
    .escapeToken()
    .accountsPartial({
      payer,
      link: linkPda(link.wallet, program.programId),
      canary: canaryPda(program.programId),
      escape: escapePda(link.wallet, program.programId),
      source,
      mint,
      vault: link.vault,
      vaultAta: ata(mint, link.vault, tokenProgram),
      tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function escapeSolIx(program: Program<Noxvault>, wallet: PublicKey, vault: PublicKey) {
  return program.methods.escapeSol().accountsPartial({ wallet, link: linkPda(wallet, program.programId), vault, systemProgram: SystemProgram.programId }).instruction();
}

/**
 * Instructions that create a durable nonce account controlled by the wallet. The escape
 * transaction uses it instead of a recent blockhash, so it never expires.
 */
export async function createNonceIxs(conn: Connection, wallet: PublicKey, nonce: PublicKey) {
  const lamports = await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  return SystemProgram.createNonceAccount({ fromPubkey: wallet, noncePubkey: nonce, authorizedPubkey: wallet, lamports }).instructions;
}

/** The unsigned escape transaction: advance the nonce, then move all SOL to the vault. */
export async function buildEscapeSolTx(program: Program<Noxvault>, wallet: PublicKey, vault: PublicKey, nonce: PublicKey): Promise<Transaction> {
  const info = await withRetry(() => program.provider.connection.getAccountInfo(nonce, "confirmed"));
  if (!info) throw new Error("Nonce account not found");
  const n = NonceAccount.fromAccountData(info.data);
  const tx = new Transaction({ feePayer: wallet, nonceInfo: { nonce: n.nonce, nonceInstruction: SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: wallet }) } });
  tx.add(await escapeSolIx(program, wallet, vault));
  return tx;
}

export interface CanaryView {
  watched: PublicKey;
  baseline: bigint;
  tripped: boolean;
  trippedAt: number;
  balance: number;
}

export async function fetchCanary(program: Program<Noxvault>): Promise<CanaryView | null> {
  const c = await withRetry(() => program.account.canary.fetchNullable(canaryPda(program.programId), "confirmed"));
  if (!c) return null;
  const balance = await withRetry(() => program.provider.connection.getBalance(CANARY_ADDRESS, "confirmed"));
  return { watched: c.watched, baseline: BigInt(c.baseline.toString()), tripped: c.tripped, trippedAt: Number(c.trippedAt), balance };
}

export async function initCanaryIx(program: Program<Noxvault>, payer: PublicKey) {
  return program.methods.initCanary().accountsPartial({ payer, canary: canaryPda(program.programId), watched: CANARY_ADDRESS, systemProgram: SystemProgram.programId }).instruction();
}
export async function raiseBaselineIx(program: Program<Noxvault>) {
  return program.methods.raiseBaseline().accountsPartial({ canary: canaryPda(program.programId), watched: CANARY_ADDRESS }).instruction();
}
export async function tripCanaryIx(program: Program<Noxvault>) {
  return program.methods.tripCanary().accountsPartial({ canary: canaryPda(program.programId), watched: CANARY_ADDRESS }).instruction();
}

/** Every linked wallet (for keepers: evacuate them all once the canary trips). */
export async function allLinks(program: Program<Noxvault>): Promise<LinkView[]> {
  const all = await withRetry(() => program.account.link.all());
  return all.map(({ account: l }) => ({
    wallet: l.wallet,
    vault: l.vault,
    createdAt: Number(l.createdAt),
    panic: l.panic,
    change: l.change ? { vault: l.change.vault, at: Number(l.change.at) } : null,
    escapeTx: Uint8Array.from(l.escapeTx),
  }));
}

// ---------- preflight ----------

/**
 * Checks an action BEFORE it is signed. A one-time key signs exactly one message, so a message
 * that can never execute would burn a key for nothing or tempt a second signature.
 * `errors` must be empty before signing; `warnings` need the user's explicit consent.
 */
export async function preflightAction(p: Omit<ActionParams, "hashesPerTx" | "execute">): Promise<{ errors: string[]; warnings: string[] }> {
  const { program, vault, signer, leaf, action } = p;
  const conn = program.provider.connection;
  const programId = program.programId;
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  const state = await fetchState(program, vault);
  if (!state) return { errors: ["This vault is not initialized yet."], warnings };
  const c = state.config;
  if (!equal(treeOf(c, signer.tree).root, signer.pub.root)) errors.push("These words do not belong to this vault (or not to this slot).");
  if (leafUsed(state, signer.tree, leaf)) errors.push(`One-time key #${leaf} is already used.`);

  try {
    const digest = actionDigest(programId, vault, signer.tree, leaf, action);
    const forLeaf = (await findSignedMessages(program, vault, signer)).filter((m) => m.leaf === leaf);
    if (forLeaf.length > 1) errors.push(`One-time key #${leaf} has already signed two different messages. Do not use it.`);
    else if (forLeaf.length === 1 && !equal(forLeaf[0].digest, digest))
      errors.push(`One-time key #${leaf} already signed a different ${forLeaf[0].action.kind}. It can only complete that one.`);
  } catch (e) {
    errors.push(`Could not read this vault's history, so it is not safe to sign (${(e as Error).message}).`);
  }

  const isCancel = isCancelKind(action);
  if (signer.tree === DURESS_TREE) {
    // Capped and instant on chain (docs/SPEC.md §11); deliberately no hint of it here.
    if (action.kind !== "withdraw" || !equal(action.mint, ZERO32)) errors.push("This phrase can only withdraw SOL.");
    return { errors, warnings };
  }
  if (signer.tree < SIGNER_SLOTS && inLockdown(state, now) && !isCancel && action.kind !== "ping")
    errors.push(`This vault is in lockdown until ${new Date(state.lockdownUntil * 1000).toISOString()}: only Ping and cancels execute. The recovery key's Cancel ends it.`);
  let unrestricted = false;
  if (signer.tree === RECOVERY_TREE && !isCancel) {
    const opensAt = state.lastActive + Number(c.recoveryDelay);
    if (now < opensAt) errors.push(`The recovery key can only cancel until ${new Date(opensAt * 1000).toISOString()}.`);
    unrestricted = true;
  }
  if (signer.tree < SIGNER_SLOTS && c.threshold > 1) {
    const existing = await fetchApproval(program, vault, action);
    const have = [0, 1, 2].filter((t) => ((existing?.trees ?? 0) | (1 << signer.tree)) & (1 << t)).length;
    if (have < c.threshold) warnings.push(`This vault needs ${c.threshold} signers: after you, ${c.threshold - have} more must approve this exact action.`);
  }
  if (action.kind === "cancel" && !state.pending) warnings.push("Nothing is pending; this only uses up a one-time key.");
  if (state.migrateTo && action.kind !== "ping") warnings.push("This vault is migrating; funds can be moved to the new vault by anyone.");

  const [vaultInfo, rentMin] = await Promise.all([withRetry(() => conn.getAccountInfo(vault, "confirmed")), withRetry(() => conn.getMinimumBalanceForRentExemption(0))]);
  const lamports = BigInt(vaultInfo?.lamports ?? 0);
  let solOut = action.fee;
  if (action.fee > 0n && equal(action.feePayee, vault.toBytes())) errors.push("The fee cannot be paid to the vault itself.");

  const restrictedCheck = (dest: PublicKey, mint: PublicKey, amount: bigint): boolean => {
    if (unrestricted || !isRestricted(c, dest)) return false;
    if (mint.equals(SOL_MINT) && c.instantLimit > 0n) {
      const spent = now >= state.windowStart + DAY ? 0n : state.windowSpent;
      if (spent + amount <= c.instantLimit) return false;
    }
    if (c.slowDelay === 0n) errors.push("The vault's rules do not allow this destination (whitelist only).");
    else {
      if (state.pending) errors.push("Something is already pending. Wait for it or cancel it first.");
      warnings.push(`This destination is restricted: it waits ${Number(c.slowDelay) / 3600} h and can be cancelled meanwhile.`);
    }
    return true;
  };

  switch (action.kind) {
    case "withdraw": {
      const mint = pk(action.mint);
      const dest = pk(action.dest);
      if (dest.equals(vault)) errors.push("The destination cannot be the vault itself.");
      const queued = restrictedCheck(dest, mint, action.amount);
      if (mint.equals(SOL_MINT)) {
        if (!queued) solOut += action.amount;
        const destInfo = await withRetry(() => conn.getAccountInfo(dest, "confirmed"));
        if (!destInfo && action.amount < BigInt(rentMin)) errors.push(`The destination is empty, so it must receive at least ${rentMin / 1e9} SOL.`);
      } else errors.push(...(await tokenChecks(conn, vault, mint, action.amount, p.tokenProgram ?? TOKEN_PROGRAM_ID, warnings)));
      break;
    }
    case "stake": {
      solOut += action.amount;
      const [voteInfo, stakeInfo, minDelegation, stakeRent] = await Promise.all([
        withRetry(() => conn.getAccountInfo(pk(action.vote), "confirmed")),
        withRetry(() => conn.getAccountInfo(stakePda(vault, action.seed, programId), "confirmed")),
        conn.getStakeMinimumDelegation().then((r) => r.value).catch(() => 1),
        withRetry(() => conn.getMinimumBalanceForRentExemption(200)),
      ]);
      if (!voteInfo || !voteInfo.owner.equals(VOTE_PROGRAM_ID)) errors.push("That is not a validator vote account.");
      if (stakeInfo) errors.push(`Stake slot #${action.seed} is already in use; pick another.`);
      if (action.amount < BigInt(stakeRent + minDelegation)) errors.push(`Stake at least ${(stakeRent + minDelegation) / 1e9} SOL.`);
      break;
    }
    case "unstake":
    case "collectStake": {
      const info = await withRetry(() => conn.getAccountInfo(stakePda(vault, action.seed, programId), "confirmed"));
      if (!info) errors.push(`Stake slot #${action.seed} is empty.`);
      if (action.kind === "collectStake") warnings.push("Collecting only works once the stake is fully deactivated (the epoch after unstaking).");
      break;
    }
    case "schedule": {
      const t = await vaultTier(program, vault);
      if (t.tier < TIER_GUARDIAN) errors.push(`Schedules need the Guardian tier: hold ${t.next} more $NOX base units in the vault.`);
      const exists = await withRetry(() => conn.getAccountInfo(schedulePda(vault, action.id, programId), "confirmed"));
      if (exists) errors.push(`Schedule slot #${action.id} is in use.`);
      if (action.amount <= 0n || action.interval <= 0n || action.count <= 0) errors.push("Amount, interval and count must be positive.");
      if (!unrestricted && isRestricted(c, pk(action.dest))) {
        if (c.slowDelay === 0n) errors.push("The vault's rules do not allow this destination.");
        else warnings.push(`Restricted destination: the first payment starts after ${Number(c.slowDelay) / 3600} h at the earliest.`);
      }
      break;
    }
    case "budget": {
      const t = await vaultTier(program, vault);
      if (t.tier < TIER_GUARDIAN) errors.push(`Budgets need the Guardian tier: hold ${t.next} more $NOX base units in the vault.`);
      const exists = await withRetry(() => conn.getAccountInfo(budgetPda(vault, action.id, programId), "confirmed"));
      if (exists) errors.push(`Budget slot #${action.id} is in use.`);
      if (action.expires <= BigInt(now)) errors.push("The budget must expire in the future.");
      warnings.push("The session key is an ordinary wallet key: whoever holds it can spend up to the budget per period. Keep the limit small.");
      break;
    }
    case "cancelSchedule": {
      if (!(await withRetry(() => conn.getAccountInfo(schedulePda(vault, action.id, programId), "confirmed")))) errors.push(`There is no schedule #${action.id}.`);
      break;
    }
    case "cancelBudget": {
      if (!(await withRetry(() => conn.getAccountInfo(budgetPda(vault, action.id, programId), "confirmed")))) errors.push(`There is no budget #${action.id}.`);
      break;
    }
    case "migrate": {
      const target = await fetchState(program, pk(action.newVault));
      if (!target) errors.push("The new vault is not an initialized Noxvault.");
      if (!unrestricted && c.whitelist.length && !c.whitelist.some((k) => equal(k, action.newVault))) {
        if (c.slowDelay === 0n) errors.push("The vault's rules do not allow migrating to a vault outside the whitelist.");
        else warnings.push(`The new vault is not whitelisted: the migration waits ${Number(c.slowDelay) / 3600} h and can be cancelled.`);
      }
      break;
    }
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
    const acct = await withRetry(() => getAccount(conn, ata(mint, vault, tokenProgram), "confirmed", tokenProgram));
    if (amount > acct.amount) errors.push("The vault holds less of this token than this amount.");
    if (acct.isFrozen) errors.push("The vault's token account is frozen by the token's issuer.");
  } catch {
    errors.push("The vault has no account for this token.");
  }
  try {
    const m = await withRetry(() => getMint(conn, mint, "confirmed", tokenProgram));
    if (m.freezeAuthority) warnings.push("This token has a freeze authority: its issuer could block the withdrawal.");
    const blocking = [ExtensionType.TransferFeeConfig, ExtensionType.TransferHook, ExtensionType.NonTransferable, ExtensionType.PermanentDelegate, ExtensionType.ConfidentialTransferMint];
    const exts = getExtensionTypes(m.tlvData).filter((e) => blocking.includes(e));
    if (exts.length) errors.push(`This token uses Token-2022 extensions Noxvault does not support (${exts.map((e) => ExtensionType[e]).join(", ")}).`);
  } catch {
    errors.push("Could not read this token's mint.");
  }
  return errors;
}

export async function mintTokenProgram(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await withRetry(() => conn.getAccountInfo(mint, "confirmed"));
  if (!info) throw new Error("Mint not found");
  if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Not a token mint");
  return info.owner;
}

export async function vaultStakes(program: Program<Noxvault>, vault: PublicKey, slots = 8) {
  const keys = Array.from({ length: slots }, (_, s) => stakePda(vault, s, program.programId));
  const infos = await withRetry(() => program.provider.connection.getMultipleAccountsInfo(keys, "confirmed"));
  return keys.map((k, s) => (infos[s] ? { seed: s, address: k, lamports: infos[s]!.lamports } : null));
}

export type { Action, Config, Kind };
