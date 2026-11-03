"use client";
// Signers for the web app: the slow public tree is built in a Web Worker and cached in
// IndexedDB (public data only, keyed by sha256(pk_seed)). Secrets are never stored here.
import { sha256 } from "@noble/hashes/sha256";
import { DURESS_TREE, RECOVERY_TREE, type Signer } from "@nox/sdk/client";
import { treeSeeds, seedIndex, rootFromPath, leafPublic, authPath, equal, type PublicTree } from "@nox/sdk/wots";
import { hex } from "./format";

const DB = "noxvault";
const STORE = "trees";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function cacheGet(key: string): Promise<PublicTree | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => resolve((q.result as PublicTree) ?? null);
      q.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cachePut(key: string, t: PublicTree) {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(t, key);
  } catch {}
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (t: PublicTree) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./tree.worker.ts", import.meta.url));
  worker.onmessage = (e) => {
    const { id, progress, pub, error } = e.data as { id: number; progress?: [number, number]; pub?: PublicTree; error?: string };
    const w = waiting.get(id);
    if (!w) return;
    if (progress) return w.onProgress?.(progress[0], progress[1]);
    waiting.delete(id);
    if (error) w.reject(new Error(error));
    else w.resolve(pub!);
  };
  return worker;
}

function buildInWorker(master: Uint8Array, vaultNumber: number, range: 0 | 1 | 2, onProgress?: (d: number, t: number) => void): Promise<PublicTree> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, master, vaultNumber, range });
  });
}

/**
 * The tree of vault number `n` of this phrase, placed in `slot` (0..2 signer, 3 recovery, 4 duress).
 * A signer tree is the same whichever signer slot it sits in; recovery and duress use their own seeds.
 * Fast when cached, a few seconds otherwise.
 */
export async function getSigner(master: Uint8Array, vaultNumber: number, slot: number, onProgress?: (done: number, total: number) => void): Promise<Signer> {
  const range = slot === RECOVERY_TREE ? 1 : slot === DURESS_TREE ? 2 : 0;
  const seeds = treeSeeds(master, seedIndex(vaultNumber, range));
  const key = `${range}:${hex(sha256(seeds.pkSeed))}`;
  let pub = await cacheGet(key);
  if (!pub || !equal(pub.pkSeed, seeds.pkSeed)) {
    pub = await buildInWorker(master, vaultNumber, range, onProgress);
    await cachePut(key, pub);
  } else {
    onProgress?.(1 << pub.height, 1 << pub.height);
  }
  if (!equal(pub.pkSeed, seeds.pkSeed)) throw new Error("Tree cache mismatch");
  // Spot check: leaf 0 recomputed here must lead to the cached root (catches a corrupt cache).
  const leaf0 = leafPublic(seeds, 0);
  if (!equal(rootFromPath(seeds.pkSeed, 0, leaf0, authPath(pub, 0)), pub.root)) throw new Error("Cached tree does not match these words");
  return { tree: slot, seeds, pub };
}

export async function clearTreeCache() {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).clear();
  } catch {}
}
