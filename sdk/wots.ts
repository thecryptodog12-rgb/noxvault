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
const D_MSG = enc.encode("nox2/msg");
const D_CONFIG = enc.encode("nox2/config");

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

// ---------- keys, chains, leaves ----------

export interface TreeSeeds {
  skSeed: Uint8Array;
  pkSeed: Uint8Array;
}

/** Seed index of a tree (docs/SPEC.md §2): primary = v, recovery = v + 2^31. */
export function seedIndex(vaultNumber: number, tree: 0 | 1): number {
  return (vaultNumber + (tree === 1 ? 0x8000_0000 : 0)) >>> 0;
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

// ---------- borsh encodings (docs/SPEC.md §4–5) ----------

export type Key32 = Uint8Array; // a 32-byte public key

export type Action =
  | { kind: "withdraw"; mint: Key32; dest: Key32; amount: bigint; fee: bigint; feePayee: Key32 }
  | { kind: "stake"; seed: number; vote: Key32; amount: bigint; fee: bigint; feePayee: Key32 }
  | { kind: "unstake"; seed: number; fee: bigint; feePayee: Key32 }
  | { kind: "collectStake"; seed: number; fee: bigint; feePayee: Key32 }
  | { kind: "cancel"; fee: bigint; feePayee: Key32 }
  | { kind: "ping"; fee: bigint; feePayee: Key32 };

export function encodeAction(a: Action): Uint8Array {
  switch (a.kind) {
    case "withdraw":
      return concat(u8(0), a.mint, a.dest, u64le(a.amount), u64le(a.fee), a.feePayee);
    case "stake":
      return concat(u8(1), u8(a.seed), a.vote, u64le(a.amount), u64le(a.fee), a.feePayee);
    case "unstake":
      return concat(u8(2), u8(a.seed), u64le(a.fee), a.feePayee);
    case "collectStake":
      return concat(u8(3), u8(a.seed), u64le(a.fee), a.feePayee);
    case "cancel":
      return concat(u8(4), u64le(a.fee), a.feePayee);
    case "ping":
      return concat(u8(5), u64le(a.fee), a.feePayee);
  }
}

export interface Config {
  primaryRoot: Uint8Array;
  primaryHeight: number;
  recoveryRoot: Uint8Array; // 32 zero bytes = none
  recoveryHeight: number;
  recoveryDelay: bigint; // seconds
  whitelist: Key32[]; // up to 4; missing slots are empty
  slowDelay: bigint; // seconds; 0 = outside the whitelist is refused
}

export function encodeConfig(c: Config): Uint8Array {
  if (c.whitelist.length > 4) throw new Error("at most 4 whitelisted addresses");
  const slots = [...c.whitelist, ...Array(4 - c.whitelist.length).fill(new Uint8Array(32))];
  return concat(
    c.primaryRoot,
    u8(c.primaryHeight),
    c.recoveryRoot,
    u8(c.recoveryHeight),
    i64le(c.recoveryDelay),
    ...slots,
    i64le(c.slowDelay)
  );
}

export function configHash(c: Config): Uint8Array {
  return sha256(concat(D_CONFIG, encodeConfig(c)));
}
