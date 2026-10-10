// Builds the PUBLIC Merkle tree of one phrase / vault number / slot kind in a worker so the page
// stays responsive. Receives the 32-byte master and returns only public data.
import { buildTree, treeSeeds, seedIndex, PRIMARY_HEIGHT, RECOVERY_HEIGHT } from "@nox/sdk/wots";

type Req = { id: number; master: Uint8Array; vaultNumber: number; recovery: boolean };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, master, vaultNumber, recovery } = e.data;
  try {
    const seeds = treeSeeds(master, seedIndex(vaultNumber, recovery ? 1 : 0));
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
