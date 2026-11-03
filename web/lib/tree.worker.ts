// Builds the PUBLIC Merkle tree of one phrase / vault number / slot kind in a worker so the page
// stays responsive. Receives the 32-byte master and returns only public data.
import { buildTree, treeSeeds, seedIndex, PRIMARY_HEIGHT, RECOVERY_HEIGHT } from "@nox/sdk/wots";

// range: 0 signer, 1 recovery, 2 duress (sdk seedIndex)
type Req = { id: number; master: Uint8Array; vaultNumber: number; range: 0 | 1 | 2 };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, master, vaultNumber, range } = e.data;
  const recovery = range === 1;
  try {
    const seeds = treeSeeds(master, seedIndex(vaultNumber, range));
    let last = 0;
    const pub = buildTree(seeds, recovery ? RECOVERY_HEIGHT : PRIMARY_HEIGHT, (done, total) => {
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
