// One-time-key tracking in the extension's port of the site's ActionPanel (src/core/signing.ts).
// The chain reads (findSignedMessages, fetchState, preflightAction, …) are mocked; pickLeaf, leafUsed
// and the rest are the SDK's real code. The rules under test: never hand out a used leaf, read the
// on-chain used bitmap fresh, resume an unfinished signed message, persist before sending.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../sdk/client", async (orig) => {
  const m = await orig<typeof import("../../sdk/client")>();
  return { ...m, findSignedMessages: vi.fn(), fetchState: vi.fn(), preflightAction: vi.fn(), completesApproval: vi.fn(), buildSteps: vi.fn(), remainingSteps: vi.fn(), packSteps: vi.fn() };
});
vi.mock("../../web/lib/unlock", async (orig) => {
  const m = await orig<typeof import("../../web/lib/unlock")>();
  return { ...m, sendIxs: vi.fn() };
});

import { PublicKey } from "@solana/web3.js";
import * as sdk from "../../sdk/client";
import { actionDigest, leafUsed, PROGRAM_ID, type SignedMessage, type Signer, type VaultStateView } from "../../sdk/client";
import { encodeAction, type Action } from "../../sdk/wots";
import * as unlock from "../../web/lib/unlock";
import { hex } from "../../web/lib/format";
import { PendingStore, type KV } from "../src/core/pendingStore";
import { cancelKind, feeFor, loadHistory, lockdownFree, prepare, sendFrozen, type Ctx, type FeeDeps } from "../src/core/signing";
import { clocks, headline } from "../src/lib/status";

const VAULT = new PublicKey("B9fCLC48ySs6R7E58zS8NcrvqtFFhNtV6RgMBqQG9Fty");
const DEST = new PublicKey("DmpPGVKPkhsxAWxW5WaxReDa2QxdJZvXk8BaG1SwQXAC");
const RELAYER = new PublicKey("HH6D7N6wwLg1Uahdk4xm8uj8kHsrVrMo7AFNf2ymEzH8");

const signer: Signer = {
  tree: 0,
  seeds: { skSeed: new Uint8Array(32).fill(1), pkSeed: new Uint8Array(32).fill(2) },
  // levels are only read for auth paths here; the real tree is covered in parity.test.ts
  pub: { height: 8, pkSeed: new Uint8Array(32).fill(2), levels: Array.from({ length: 9 }, (_, h) => Array.from({ length: 256 >> h }, () => new Uint8Array(32))), root: new Uint8Array(32).fill(3) },
};

function state(used: number[] = []): VaultStateView {
  const bits = Array.from({ length: 5 }, () => new Uint8Array(32));
  for (const l of used) bits[0][l >> 3] |= 1 << (l & 7);
  return {
    vault: VAULT,
    config: {
      trees: [{ root: signer.pub.root, height: 8 }, { root: new Uint8Array(32), height: 0 }, { root: new Uint8Array(32), height: 0 }, { root: new Uint8Array(32), height: 0 }],
      threshold: 1,
      recoveryDelay: 0n,
      whitelist: [],
      slowDelay: 0n,
      instantLimit: 0n,
      heirs: [],
      testamentDelay: 0n,
      duress: { root: new Uint8Array(32).fill(9), height: 8 },
      duressLimit: 0n,
      duressLock: 86400n,
    },
    used: bits,
    lastActive: 0,
    createdAt: 0,
    actions: 0,
    pending: null,
    windowStart: 0,
    windowSpent: 0n,
    migrateTo: null,
    lockdownUntil: 0,
  };
}

const withdraw = (amount: bigint, fee = 100_000n): Action => ({ kind: "withdraw", mint: new Uint8Array(32), dest: DEST.toBytes(), amount, fee, feePayee: RELAYER.toBytes() });

function signedMsg(leaf: number, action: Action): SignedMessage {
  const digest = actionDigest(PROGRAM_ID, VAULT, 0, leaf, action);
  return { tree: 0, leaf, action, actionBytes: encodeAction(action), digest, chains: [0], buffers: [], txs: ["x"] };
}

/** In-memory KV that logs every write, to check ordering. */
function memKV(log: string[]): KV {
  const data: Record<string, unknown> = {};
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in data) out[k] = JSON.parse(JSON.stringify(data[k]));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        data[k] = JSON.parse(JSON.stringify(v));
        log.push(`set:${k}:${Object.keys(v as object).join(",")}`);
      }
    },
  };
}

const program = { programId: PROGRAM_ID, provider: { connection: {} } } as unknown as Ctx["program"];
let log: string[];
let ctx: Ctx;
const m = vi.mocked(sdk);

beforeEach(() => {
  vi.clearAllMocks();
  log = [];
  ctx = { program, vault: VAULT, signer, store: new PendingStore(memKV(log)) };
  m.findSignedMessages.mockResolvedValue([]);
});

describe("which one-time key signs (loadHistory = ActionPanel.loadHistory)", () => {
  it("never hands out a used or already-signing leaf (randomized)", async () => {
    for (let round = 0; round < 60; round++) {
      const used = [...new Set(Array.from({ length: Math.floor(Math.random() * 200) }, () => Math.floor(Math.random() * 256)))];
      // finished messages are on used leaves; none unfinished in this test
      const signed = used.filter(() => Math.random() < 0.3).map((l) => signedMsg(l, withdraw(BigInt(l + 1))));
      const st = state(used);
      m.fetchState.mockResolvedValue(st);
      m.findSignedMessages.mockResolvedValue(signed);
      const { history } = await loadHistory(ctx, state());
      expect(history.kind).toBe("ready");
      if (history.kind !== "ready") continue;
      expect(leafUsed(st, 0, history.leaf)).toBe(false);
      expect(signed.some((s) => s.leaf === history.leaf)).toBe(false);
      const lowestFree = [...Array(256).keys()].find((l) => !used.includes(l));
      expect(history.leaf).toBe(lowestFree);
    }
  });

  it("reads the used bitmap fresh from the chain, not the state the page had", async () => {
    m.fetchState.mockResolvedValue(state([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const { history } = await loadHistory(ctx, state());
    expect(history.kind === "ready" && history.leaf).toBe(10);
  });

  it("resumes an unfinished signed message: chain wins over local memory", async () => {
    const a = withdraw(5_000_000n);
    m.fetchState.mockResolvedValue(state([0, 1]));
    m.findSignedMessages.mockResolvedValue([signedMsg(0, withdraw(1n)), signedMsg(1, withdraw(2n)), signedMsg(7, a)]);
    await ctx.store.savePending({ v: 2, vault: VAULT.toBase58(), tree: 0, leaf: 2, action: unlock.actionToJson(withdraw(9n)), digest: "00", mode: "relayer", createdAt: 1 });
    const r = await loadHistory(ctx, state());
    expect(r.frozen).toMatchObject({ leaf: 7, source: "chain", mode: "relayer" });
    expect(encodeAction(r.frozen!.action)).toEqual(encodeAction(a));
    expect(r.note).toMatch(/different action/);
    const saved = await ctx.store.loadPending(VAULT.toBase58(), 0);
    expect(saved).toMatchObject({ leaf: 7, digest: hex(actionDigest(PROGRAM_ID, VAULT, 0, 7, a)) });
  });

  it("keeps a locally frozen action whose send may be in flight", async () => {
    m.fetchState.mockResolvedValue(state([0, 1]));
    const a = withdraw(3n);
    await ctx.store.savePending({ v: 2, vault: VAULT.toBase58(), tree: 0, leaf: 4, action: unlock.actionToJson(a), digest: hex(actionDigest(PROGRAM_ID, VAULT, 0, 4, a)), mode: "relayer", createdAt: 1 });
    // not attempted and not the next leaf: not frozen
    expect((await loadHistory(ctx, state())).frozen).toBeNull();
    await ctx.store.markAttempted(VAULT.toBase58(), 0, 4);
    const r = await loadHistory(ctx, state());
    expect(r.frozen).toMatchObject({ leaf: 4, source: "local" });
    expect(r.history.kind === "ready" && r.history.leaf).toBe(2);
  });

  it("drops the local record once its leaf is used on chain", async () => {
    await ctx.store.savePending({ v: 2, vault: VAULT.toBase58(), tree: 0, leaf: 4, action: unlock.actionToJson(withdraw(3n)), digest: "ab", mode: "relayer", createdAt: 1 });
    await ctx.store.markAttempted(VAULT.toBase58(), 0, 4);
    m.fetchState.mockResolvedValue(state([0, 1, 2, 3, 4]));
    const r = await loadHistory(ctx, state());
    expect(r.frozen).toBeNull();
    expect(await ctx.store.loadPending(VAULT.toBase58(), 0)).toBeNull();
    expect(await ctx.store.wasAttempted(VAULT.toBase58(), 0, 4)).toBe(false);
  });

  it("all 256 keys used → exhausted; unreadable history → blocked", async () => {
    m.fetchState.mockResolvedValue(state([...Array(256).keys()]));
    expect((await loadHistory(ctx, state())).history.kind).toBe("exhausted");
    m.findSignedMessages.mockRejectedValue(new Error("429"));
    const r = await loadHistory(ctx, state());
    expect(r.history.kind).toBe("error");
    expect(r.frozen).toBeNull();
  });
});

describe("freezing and sending (prepare / sendFrozen)", () => {
  const deps = (st: VaultStateView): FeeDeps => ({ relayer: { relayer: RELAYER.toBase58(), minFee: "100000", sentinelFree: false }, feePayer: null, sentinelFree: false, state: st, tree: 0 });

  it("does not freeze on preflight errors, or on warnings without consent", async () => {
    const st = state();
    m.fetchState.mockResolvedValue(st);
    m.preflightAction.mockResolvedValue({ errors: ["The vault holds less SOL than this needs (amount plus fee)."], warnings: [] });
    let r = await prepare(ctx, { leaf: 0, action: withdraw(1n), mode: "relayer", deps: deps(st), prev: null, consent: false });
    expect(r.frozen).toBeUndefined();
    expect(await ctx.store.loadPending(VAULT.toBase58(), 0)).toBeNull();

    m.preflightAction.mockResolvedValue({ errors: [], warnings: ["This destination is restricted: it waits 72 h and can be cancelled meanwhile."] });
    r = await prepare(ctx, { leaf: 0, action: withdraw(1n), mode: "relayer", deps: deps(st), prev: null, consent: true });
    expect(r.frozen).toBeUndefined(); // consent only counts for the same, already-shown check
    const again = await prepare(ctx, { leaf: 0, action: withdraw(1n), mode: "relayer", deps: deps(st), prev: r.pre, consent: true });
    expect(again.frozen).toMatchObject({ leaf: 0, source: "local", mode: "relayer" });
    expect(await ctx.store.loadPending(VAULT.toBase58(), 0)).toMatchObject({ leaf: 0, mode: "relayer" });
  });

  it("refuses when another one-time key has an unfinished signed message", async () => {
    const st = state();
    m.fetchState.mockResolvedValue(st);
    m.preflightAction.mockResolvedValue({ errors: [], warnings: [] });
    m.findSignedMessages.mockResolvedValue([signedMsg(3, withdraw(77n))]);
    const r = await prepare(ctx, { leaf: 0, action: withdraw(1n), mode: "relayer", deps: deps(st), prev: null, consent: false });
    expect(r.pre.errors.join(" ")).toMatch(/One-time key #3 already signed/);
    expect(r.frozen).toBeUndefined();
    expect(r.reloadHistory).toBe(true);
  });

  it("relayer: 'attempted' is persisted before the relay request, pending cleared after", async () => {
    m.completesApproval.mockResolvedValue({ willExecute: true, creator: undefined });
    const order: string[] = [];
    const store = ctx.store;
    const origMark = store.markAttempted.bind(store);
    store.markAttempted = async (...a) => {
      await origMark(...a);
      order.push("attempted");
    };
    await store.savePending({ v: 2, vault: VAULT.toBase58(), tree: 0, leaf: 0, action: unlock.actionToJson(withdraw(1n)), digest: "x", mode: "relayer", createdAt: 1 });
    const res = await sendFrozen(ctx, { leaf: 0, action: withdraw(1n), mode: "relayer", source: "local" }, "relayer", {
      relay: async (s) => {
        order.push("relay");
        expect(s.leaf).toBe(0);
        expect(s.signature).toHaveLength(34);
        return ["sig1", "sig2"];
      },
    });
    expect(order).toEqual(["attempted", "relay"]);
    expect(res.executed).toBe(true);
    expect(res.steps.map((s) => s.sig)).toEqual(["sig1", "sig2"]);
    expect(await store.loadPending(VAULT.toBase58(), 0)).toBeNull();
  });

  it("fee account: 'attempted' is persisted before every transaction", async () => {
    m.completesApproval.mockResolvedValue({ willExecute: true, creator: undefined });
    m.buildSteps.mockResolvedValue([]);
    m.remainingSteps.mockResolvedValue([{ label: "open", ix: {} as never, cost: 1, kind: "open" }]);
    m.packSteps.mockReturnValue([
      { label: "open + write 1/3", instructions: [] },
      { label: "verify", instructions: [] },
    ]);
    const order: string[] = [];
    const store = ctx.store;
    const origMark = store.markAttempted.bind(store);
    store.markAttempted = async (...a) => {
      await origMark(...a);
      order.push("attempted");
    };
    vi.mocked(unlock.sendIxs).mockImplementation(async () => {
      order.push("tx");
      return `sig${order.length}`;
    });
    const payer = new PublicKey("BFwro7RnsG9GR2jV3yGXGwtGkRq8MDxH9LSoTAjMQf2x");
    const res = await sendFrozen(ctx, { leaf: 0, action: { ...withdraw(1n, 0n), feePayee: payer.toBytes() }, mode: "wallet", source: "local" }, "wallet", { payer, send: async () => "unused" });
    expect(order).toEqual(["attempted", "tx", "attempted", "tx"]);
    expect(res.steps.every((s) => s.st === "done")).toBe(true);
  });
});

describe("v4.2: cancel and freeze (CancelLock)", () => {
  const RECOVERY = sdk.RECOVERY_TREE;

  it("the recovery phrase cancels and freezes for the chosen days; 14 by default", () => {
    expect(sdk.DEFAULT_CANCEL_LOCK_DAYS).toBe(14);
    expect(cancelKind({ tree: RECOVERY, freeze: true, days: 14, supported: true })).toEqual({ kind: { kind: "cancelLock", secs: 14n * 86_400n } });
    expect(cancelKind({ tree: RECOVERY, freeze: false, days: 14, supported: true })).toEqual({ kind: { kind: "cancel" } });
    expect(() => cancelKind({ tree: RECOVERY, freeze: true, days: 0, supported: true })).toThrow("1 to 90 days");
    expect(() => cancelKind({ tree: RECOVERY, freeze: true, days: 91, supported: true })).toThrow("1 to 90 days");
    expect(cancelKind({ tree: RECOVERY, freeze: true, days: 90, supported: true }).kind).toEqual({ kind: "cancelLock", secs: 90n * 86_400n });
  });

  it("falls back to a plain cancel, with a note, on a program without CancelLock or for the owner's phrase", () => {
    const old = cancelKind({ tree: RECOVERY, freeze: true, days: 14, supported: false });
    expect(old.kind).toEqual({ kind: "cancel" });
    expect(old.note).toContain("v4.2");
    expect(cancelKind({ tree: 0, freeze: true, days: 14, supported: true }).kind).toEqual({ kind: "cancel" });
  });

  it("recognizes the old program's refusal: it cannot even decode the action", () => {
    expect(sdk.isUnsupportedActionError(new Error("failed: custom program error: 0x66"))).toBe(true);
    expect(sdk.isUnsupportedActionError({ logs: ["Program log: AnchorError occurred. Error Code: InstructionDidNotDeserialize."] })).toBe(true);
    expect(sdk.isUnsupportedActionError({ message: JSON.stringify({ InstructionError: [0, { Custom: 102 }] }) })).toBe(true);
    expect(sdk.isUnsupportedActionError(new Error("custom program error: 0x660"))).toBe(false);
    expect(sdk.isUnsupportedActionError(new Error("Error Code: Lockdown"))).toBe(false);
  });

  it("the relayer sends the recovery phrase's cancels free, also outside a lockdown", () => {
    const st = state();
    expect(lockdownFree(st, RECOVERY, "cancelLock")).toBe(true);
    expect(lockdownFree(st, RECOVERY, "cancel")).toBe(true);
    expect(lockdownFree(st, 0, "cancel")).toBe(false);
    const d: FeeDeps = { relayer: { relayer: RELAYER.toBase58(), minFee: "100000" } as never, feePayer: null, sentinelFree: false, state: st, tree: RECOVERY };
    expect(feeFor("relayer", "cancelLock", d).fee).toBe(0n);
  });

  it("the vault status shows the freeze and when it ends", () => {
    const NOW = 1_800_000_000;
    const snap = { lockdownUntil: NOW + 14 * 86_400, pending: null, recoveryAt: null, testamentAt: null, letters: [], tokens: [] } as never;
    expect(headline(snap, NOW).label).toBe("LOCKDOWN");
    expect(headline(snap, NOW).detail).toContain("frozen");
    expect(clocks(snap, NOW)[0]).toMatchObject({ label: "Lockdown / freeze ends", at: NOW + 14 * 86_400 });
  });
});
