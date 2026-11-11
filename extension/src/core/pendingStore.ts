// PORT of the storage half of web/lib/unlock.ts ("the action this browser froze for a leaf"):
// loadPending / savePending / clearPending / markAttempted / wasAttempted / clearAttempted, with the
// same keys and semantics, on chrome.storage.local instead of localStorage (the service worker has
// no localStorage). Async, so callers MUST await savePending / markAttempted before sending.
// Public data only: vault, tree, leaf, the action and its digest.
import type { PendingAction } from "../../../web/lib/unlock";

/** Minimal storage surface (chrome.storage.local, or a fake in tests). */
export interface KV {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const chromeKV = (): KV => ({
  get: (keys) => chrome.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (items) => chrome.storage.local.set(items),
});

const pendKey = (vault: string, tree: number) => `${vault}.${tree}`;
const attKey = (vault: string, tree: number, leaf: number) => `${vault}.${tree}.${leaf}`;

export class PendingStore {
  constructor(private kv: KV = chromeKV()) {}

  private async maps() {
    const got = await this.kv.get(["pendingActions", "attempted"]);
    return {
      pending: (got.pendingActions as Record<string, PendingAction> | undefined) ?? {},
      attempted: (got.attempted as Record<string, number> | undefined) ?? {},
    };
  }

  async loadPending(vault: string, tree: number): Promise<PendingAction | null> {
    const p = (await this.maps()).pending[pendKey(vault, tree)];
    return p && p.v === 2 ? p : null;
  }

  async savePending(p: PendingAction): Promise<void> {
    const { pending } = await this.maps();
    pending[pendKey(p.vault, p.tree)] = p;
    await this.kv.set({ pendingActions: pending });
  }

  async clearPending(vault: string, tree: number): Promise<void> {
    const { pending } = await this.maps();
    delete pending[pendKey(vault, tree)];
    await this.kv.set({ pendingActions: pending });
  }

  /** Set BEFORE the first transaction or relay request of an action is sent. */
  async markAttempted(vault: string, tree: number, leaf: number): Promise<void> {
    const { attempted } = await this.maps();
    attempted[attKey(vault, tree, leaf)] = Date.now();
    await this.kv.set({ attempted });
  }

  async wasAttempted(vault: string, tree: number, leaf: number): Promise<boolean> {
    try {
      return (await this.maps()).attempted[attKey(vault, tree, leaf)] !== undefined;
    } catch {
      return true; // unknown: be safe
    }
  }

  async clearAttempted(vault: string, tree: number, leaf: number): Promise<void> {
    const { attempted } = await this.maps();
    delete attempted[attKey(vault, tree, leaf)];
    await this.kv.set({ attempted });
  }
}
