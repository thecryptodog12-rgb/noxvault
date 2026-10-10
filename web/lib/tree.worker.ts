// Builds the PUBLIC Merkle tree of one phrase/vault-number/tree in a worker so the page stays
// responsive. Receives the 32-byte master and returns only public data (levels, pk_seed, root).
import { buildTree, treeSeeds, PRIMARY_HEIGHT, RECOVERY_HEIGHT } from "@nox/sdk/wots";
import { seedIndex } from "./treeIndex";

type Req = { id: number; master: Uint8Array; vaultNumber: number; tree: 0 | 1 };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, master, vaultNumber, tree } = e.data;
  try {
    const seeds = treeSeeds(master, seedIndex(vaultNumber, tree));
    let last = 0;
    const pub = buildTree(seeds, tree === 0 ? PRIMARY_HEIGHT : RECOVERY_HEIGHT, (done, total) => {
      if (done === total || done - last >= 4) {
        last = done;
        (self as unknown as Worker).postMessage({ id, progress: [done, total] });
      }
    });
    (self as unknown as Worker).postMessage({ id, pub: { height: pub.height, pkSeed: pub.pkSeed, levels: pub.levels, root: pub.root } });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
