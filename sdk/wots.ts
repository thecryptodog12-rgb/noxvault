// WOTS+ one-time keys in a Merkle tree, exactly as in docs/SPEC.md §2–5.
// Pure functions over Uint8Array, no Solana dependency, so it also runs in a web worker.
import { sha256 } from "@noble/hashes/sha256";

export const N = 32;
export const W = 256;
export const LEN1 = 32;
export const LEN2 = 2;
export const LEN = LEN1 + LEN2;
export const STEPS = W - 1;
export const PRIMARY_HEIGHT = 8;
export const RECOVERY_HEIGHT = 4;

const enc = new TextEncoder();
const D_SK = enc.encode("nox2/sk");
const D_PK = enc.encode("nox2/pk");
const D_CHAIN = enc.encode("nox2/chain");
const D_LEAF = enc.encode("nox2/leaf");
const D_NODE = enc.encode("nox2/node");
const D_MSG = enc.encode("nox3/msg");
const D_CONFIG = enc.encode("nox3/config");
const D_ACTION = enc.encode("nox3/action");

// ---------- bytes ----------

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const u8 = (n: number) => Uint8Array.of(n);

export function u16le(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
}

export function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

export function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

export function i64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The phrase words in a pasted text, in order. Tolerates the numbered list the app shows
 * ("1 vocal 2 govern…", "1. vocal", "1) vocal"), line breaks, commas and mixed case.
 */
export function normalizeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

// ---------- keys, chains, leaves ----------

export interface TreeSeeds {
  skSeed: Uint8Array;
  pkSeed: Uint8Array;
}

/**
 * Seed index of a tree (docs/SPEC.md §2): signer = v, recovery = v + 2^31, duress = v + 2^30.
 * Vault numbers stay below 2^30, so the three ranges never overlap.
 */
export function seedIndex(vaultNumber: number, tree: 0 | 1 | 2): number {
  return (vaultNumber + (tree === 1 ? 0x8000_0000 : tree === 2 ? 0x4000_0000 : 0)) >>> 0;
}

export function treeSeeds(master: Uint8Array, vaultNumber: number): TreeSeeds {
  if (master.length !== 32) throw new Error("master secret must be 32 bytes");
  return {
    skSeed: sha256(concat(D_SK, master, u32le(vaultNumber))),
    pkSeed: sha256(concat(D_PK, master, u32le(vaultNumber))),
  };
}

/** One step of chain j of leaf l, moving from position k to k+1. */
export function F(pkSeed: Uint8Array, leaf: number, j: number, k: number, v: Uint8Array): Uint8Array {
  return sha256(concat(pkSeed, u16le(leaf), Uint8Array.of(j, k), v));
}

export function chain(pkSeed: Uint8Array, leaf: number, j: number, v: Uint8Array, start: number, steps: number): Uint8Array {
  for (let k = start; k < start + steps; k++) v = F(pkSeed, leaf, j, k, v);
  return v;
}

export function chainSecret(skSeed: Uint8Array, leaf: number, j: number): Uint8Array {
  return sha256(concat(D_CHAIN, skSeed, u16le(leaf), u8(j)));
}

export function leafHash(pkSeed: Uint8Array, leaf: number, ends: Uint8Array[]): Uint8Array {
  return sha256(concat(D_LEAF, pkSeed, u16le(leaf), ...ends));
}

export function leafPublic(seeds: TreeSeeds, leaf: number): Uint8Array {
  const ends: Uint8Array[] = [];
  for (let j = 0; j < LEN; j++) ends.push(chain(seeds.pkSeed, leaf, j, chainSecret(seeds.skSeed, leaf, j), 0, STEPS));
  return leafHash(seeds.pkSeed, leaf, ends);
}

export function node(pkSeed: Uint8Array, h: number, i: number, a: Uint8Array, b: Uint8Array): Uint8Array {
  return sha256(concat(D_NODE, pkSeed, u8(h), u16le(i), a, b));
}

// ---------- tree ----------

/** Public part of a tree: every node, level 0 (leaves) to the root. Safe to cache. */
export interface PublicTree {
  height: number;
  pkSeed: Uint8Array;
  levels: Uint8Array[][];
  root: Uint8Array;
}

export function buildTree(seeds: TreeSeeds, height: number, onLeaf?: (done: number, total: number) => void): PublicTree {
  const total = 1 << height;
  const leaves: Uint8Array[] = [];
  for (let l = 0; l < total; l++) {
    leaves.push(leafPublic(seeds, l));
    onLeaf?.(l + 1, total);
  }
  const levels = [leaves];
  for (let h = 1; h <= height; h++) {
    const below = levels[h - 1];
    const row: Uint8Array[] = [];
    for (let i = 0; i < below.length / 2; i++) row.push(node(seeds.pkSeed, h, i, below[2 * i], below[2 * i + 1]));
    levels.push(row);
  }
  return { height, pkSeed: seeds.pkSeed, levels, root: levels[height][0] };
}

export function authPath(tree: PublicTree, leaf: number): Uint8Array[] {
  const path: Uint8Array[] = [];
  for (let h = 0, i = leaf; h < tree.height; h++, i >>= 1) path.push(tree.levels[h][i ^ 1]);
  return path;
}

export function rootFromPath(pkSeed: Uint8Array, leaf: number, leafH: Uint8Array, path: Uint8Array[]): Uint8Array {
  let cur = leafH;
  let idx = leaf;
  path.forEach((sib, i) => {
    const parent = idx >> 1;
    cur = idx & 1 ? node(pkSeed, i + 1, parent, sib, cur) : node(pkSeed, i + 1, parent, cur, sib);
    idx = parent;
  });
  return cur;
}

// ---------- messages ----------

/** The 34 base-256 digits (message bytes + 2 checksum digits) for a 32-byte digest. */
export function digits(digest: Uint8Array): number[] {
  if (digest.length !== LEN1) throw new Error("digest must be 32 bytes");
  const a = Array.from(digest);
  const csum = a.reduce((s, x) => s + (STEPS - x), 0);
  a.push(csum >> 8, csum & 0xff);
  return a;
}

export function messageDigest(programId: Uint8Array, vault: Uint8Array, tree: number, leaf: number, action: Uint8Array): Uint8Array {
  return sha256(concat(D_MSG, programId, vault, u8(tree), u16le(leaf), action));
}

export function sign(seeds: TreeSeeds, leaf: number, digest: Uint8Array): Uint8Array[] {
  return digits(digest).map((a, j) => chain(seeds.pkSeed, leaf, j, chainSecret(seeds.skSeed, leaf, j), 0, a));
}

/** Rebuilds the tree root a signature commits to. Valid iff it equals the vault's root. */
export function recoverRoot(pkSeed: Uint8Array, leaf: number, digest: Uint8Array, sig: Uint8Array[], path: Uint8Array[]): Uint8Array {
  if (sig.length !== LEN) throw new Error(`signature must have ${LEN} chains`);
  const ends = digits(digest).map((a, j) => chain(pkSeed, leaf, j, sig[j], a, STEPS - a));
  return rootFromPath(pkSeed, leaf, leafHash(pkSeed, leaf, ends), path);
}

/** Hash calls the on-chain verifier makes per chain, used to split verify across txs. */
export function verifyCost(digest: Uint8Array): number[] {
  return digits(digest).map((a) => STEPS - a);
}

// ---------- borsh encodings (docs/SPEC.md §3–4) ----------

export type Key32 = Uint8Array; // a 32-byte public key

export type Kind =
  | { kind: "withdraw"; mint: Key32; dest: Key32; amount: bigint }
  | { kind: "stake"; seed: number; vote: Key32; amount: bigint }
  | { kind: "unstake"; seed: number }
  | { kind: "collectStake"; seed: number }
  | { kind: "cancel" }
  | { kind: "ping" }
  | { kind: "schedule"; id: number; mint: Key32; dest: Key32; amount: bigint; interval: bigint; count: number; start: bigint }
  | { kind: "cancelSchedule"; id: number }
  | { kind: "budget"; id: number; session: Key32; mint: Key32; limit: bigint; period: bigint; expires: bigint }
  | { kind: "cancelBudget"; id: number }
  | { kind: "migrate"; newVault: Key32 }
  | { kind: "letterKey"; key: Key32 } // sealed letters (docs/SPEC.md §12); all-zero key revokes
  | { kind: "cancelLock"; secs: bigint }; // v4.2: recovery cancel + freeze for secs (1 to 90 days)

/** An action plus the fee the vault pays (lamports) to whoever executes it. */
export type Action = Kind & { fee: bigint; feePayee: Key32 };

export const KIND_TAGS: Kind["kind"][] = [
  "withdraw", "stake", "unstake", "collectStake", "cancel", "ping",
  "schedule", "cancelSchedule", "budget", "cancelBudget", "migrate", "letterKey",
  "cancelLock", // v4.2, tag 12 (append only: earlier tags never change)
];

export function encodeKind(k: Kind): Uint8Array {
  const tag = u8(KIND_TAGS.indexOf(k.kind));
  switch (k.kind) {
    case "withdraw":
      return concat(tag, k.mint, k.dest, u64le(k.amount));
    case "stake":
      return concat(tag, u8(k.seed), k.vote, u64le(k.amount));
    case "unstake":
    case "collectStake":
      return concat(tag, u8(k.seed));
    case "cancel":
    case "ping":
      return tag;
    case "schedule":
      return concat(tag, u8(k.id), k.mint, k.dest, u64le(k.amount), i64le(k.interval), u16le(k.count), i64le(k.start));
    case "cancelSchedule":
    case "cancelBudget":
      return concat(tag, u8(k.id));
    case "budget":
      return concat(tag, u8(k.id), k.session, k.mint, u64le(k.limit), i64le(k.period), i64le(k.expires));
    case "migrate":
      return concat(tag, k.newVault);
    case "letterKey":
      return concat(tag, k.key);
    case "cancelLock":
      return concat(tag, i64le(k.secs));
  }
}

export function encodeAction(a: Action): Uint8Array {
  return concat(encodeKind(a), u64le(a.fee), a.feePayee);
}

export function actionHash(a: Action): Uint8Array {
  return sha256(concat(D_ACTION, encodeAction(a)));
}

export interface TreeCfg {
  root: Uint8Array; // all zero = slot unused
  height: number;
}

export interface Heir {
  addr: Key32;
  bps: number;
}

export interface Config {
  trees: TreeCfg[]; // exactly 4: three signer slots, then recovery
  threshold: number;
  recoveryDelay: bigint;
  whitelist: Key32[]; // up to 4
  slowDelay: bigint;
  instantLimit: bigint; // lamports per 24 h
  heirs: Heir[]; // up to 4, bps sum 10000
  testamentDelay: bigint;
  duress: TreeCfg; // always filled: a random-looking root when there is no duress phrase
  duressLimit: bigint; // lamports a duress withdrawal pays out at once
  duressLock: bigint; // lockdown seconds after a duress withdrawal (>= 1 day)
}

const pad4 = <T>(xs: T[], empty: T): T[] => {
  if (xs.length > 4) throw new Error("at most 4 entries");
  return [...xs, ...Array(4 - xs.length).fill(empty)];
};

export function encodeConfig(c: Config): Uint8Array {
  if (c.trees.length !== 4) throw new Error("config needs exactly 4 tree slots");
  return concat(
    ...c.trees.map((t) => concat(t.root, u8(t.height))),
    u8(c.threshold),
    i64le(c.recoveryDelay),
    ...pad4(c.whitelist, new Uint8Array(32)),
    i64le(c.slowDelay),
    u64le(c.instantLimit),
    ...pad4(c.heirs, { addr: new Uint8Array(32), bps: 0 }).map((h) => concat(h.addr, u16le(h.bps))),
    i64le(c.testamentDelay),
    c.duress.root,
    u8(c.duress.height),
    u64le(c.duressLimit),
    i64le(c.duressLock)
  );
}

export function configHash(c: Config): Uint8Array {
  return sha256(concat(D_CONFIG, encodeConfig(c)));
}
