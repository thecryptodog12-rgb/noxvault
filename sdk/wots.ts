// WOTS+ one-time signatures as specified in docs/SPEC.md.
// Pure functions over Uint8Array, no Solana dependency, so the web app can run them anywhere.
import { sha256 } from "@noble/hashes/sha256";

export const N = 32;
export const W = 256;
export const LEN1 = 32;
export const LEN2 = 2;
export const LEN = LEN1 + LEN2;
export const STEPS = W - 1;

const enc = new TextEncoder();
const D_SK = enc.encode("nox/sk");
const D_PK = enc.encode("nox/pk");
const D_CHAIN = enc.encode("nox/chain");
const D_ROOT = enc.encode("nox/root");
const D_MSG = enc.encode("nox/msg/v1");

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
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

export interface OneTimeKey {
  index: number;
  pkSeed: Uint8Array;
  secrets: Uint8Array[]; // LEN chain starts
  ends: Uint8Array[]; // LEN chain ends
  root: Uint8Array;
}

/** One step of chain j, moving from position k to k+1. */
export function F(pkSeed: Uint8Array, j: number, k: number, v: Uint8Array): Uint8Array {
  return sha256(concat(pkSeed, Uint8Array.of(j, k), v));
}

export function chain(pkSeed: Uint8Array, j: number, v: Uint8Array, start: number, steps: number): Uint8Array {
  for (let k = start; k < start + steps; k++) v = F(pkSeed, j, k, v);
  return v;
}

export function rootFromEnds(pkSeed: Uint8Array, ends: Uint8Array[]): Uint8Array {
  return sha256(concat(D_ROOT, pkSeed, ...ends));
}

export function deriveKey(master: Uint8Array, index: number): OneTimeKey {
  if (master.length !== 32) throw new Error("master secret must be 32 bytes");
  const skSeed = sha256(concat(D_SK, master, u32le(index)));
  const pkSeed = sha256(concat(D_PK, master, u32le(index)));
  const secrets: Uint8Array[] = [];
  const ends: Uint8Array[] = [];
  for (let j = 0; j < LEN; j++) {
    const x = sha256(concat(D_CHAIN, skSeed, Uint8Array.of(j)));
    secrets.push(x);
    ends.push(chain(pkSeed, j, x, 0, STEPS));
  }
  return { index, pkSeed, secrets, ends, root: rootFromEnds(pkSeed, ends) };
}

/** The 34 base-256 digits (message bytes + 2 checksum digits) for a 32-byte digest. */
export function digits(digest: Uint8Array): number[] {
  if (digest.length !== LEN1) throw new Error("digest must be 32 bytes");
  const a = Array.from(digest);
  const csum = a.reduce((s, x) => s + (STEPS - x), 0);
  a.push(csum >> 8, csum & 0xff);
  return a;
}

export function sign(key: OneTimeKey, digest: Uint8Array): Uint8Array[] {
  return digits(digest).map((a, j) => chain(key.pkSeed, j, key.secrets[j], 0, a));
}

/** Rebuilds the root a signature commits to. Valid iff it equals the vault's root. */
export function recoverRoot(pkSeed: Uint8Array, digest: Uint8Array, sig: Uint8Array[]): Uint8Array {
  if (sig.length !== LEN) throw new Error(`signature must have ${LEN} chains`);
  const ends = digits(digest).map((a, j) => chain(pkSeed, j, sig[j], a, STEPS - a));
  return rootFromEnds(pkSeed, ends);
}

export function verify(root: Uint8Array, pkSeed: Uint8Array, digest: Uint8Array, sig: Uint8Array[]): boolean {
  return equal(recoverRoot(pkSeed, digest, sig), root);
}

export interface UnlockMessage {
  programId: Uint8Array;
  vault: Uint8Array;
  mint: Uint8Array; // 32 zero bytes for SOL
  dest: Uint8Array;
  nextVault: Uint8Array;
  amount: bigint;
}

export function messageDigest(m: UnlockMessage): Uint8Array {
  return sha256(concat(D_MSG, m.programId, m.vault, m.mint, m.dest, m.nextVault, u64le(m.amount)));
}

/** Hash calls the on-chain verifier makes for each chain, used to split verify across txs. */
export function verifyCost(digest: Uint8Array): number[] {
  return digits(digest).map((a) => STEPS - a);
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
