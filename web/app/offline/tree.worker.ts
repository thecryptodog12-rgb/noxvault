// Builds a one-time-key tree off the main thread. Receives the master secret, posts progress,
// then the seeds and public tree. Runs with no network access needed.
import { makeSigner, TREE_PRIMARY, RECOVERY_TREE } from "@nox/sdk/client";

type In = { type: "build"; master: Uint8Array; vaultNumber: number; tree: number } | { type: "ping" };

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === "ping") {
    self.postMessage({ type: "pong" });
    return;
  }
  try {
    const tree = m.tree === RECOVERY_TREE ? RECOVERY_TREE : m.tree >= 0 && m.tree <= 2 ? m.tree : TREE_PRIMARY;
    const s = makeSigner(m.master, m.vaultNumber, tree, (done, total) => {
      if (done % 4 === 0 || done === total) self.postMessage({ type: "progress", done, total });
    });
    self.postMessage({ type: "done", tree: s.tree, seeds: s.seeds, pub: s.pub });
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error).message });
  }
};
