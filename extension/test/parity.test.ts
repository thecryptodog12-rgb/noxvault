// Parity with the site / SDK:
//  - src/core/trees.ts (copied from web/lib/trees.ts) driving the site's own web/lib/tree.worker.ts
//    yields exactly sdk makeSigner's tree;
//  - src/core/create.ts (port of SetupVault) yields exactly the makeConfig the presets describe;
//  - the transactions the extension sends equal sdk planAction's for the same signer/leaf/action,
//    the signature verifies against the tree root, and relay requests round-trip;
//  - pinned vectors for the action encoding and the message digest.
// Masters are random per run (no phrase is committed); vectors use public inputs only.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DAY,
  DURESS_TREE,
  PROGRAM_ID,
  RECOVERY_TREE,
  actionDigest,
  buildSteps,
  makeConfig,
  makeSigner,
  newMasterSecret,
  packSteps,
  planAction,
  vaultOf,
  type Signer,
  type VaultStateView,
} from "../../sdk/client";
import { readProgram } from "../../sdk/integrate";
import { decodeRelayRequest, encodeRelayRequest } from "../../sdk/relayer";
import { authPath, encodeAction, equal, recoverRoot, type Action } from "../../sdk/wots";
import { ANTITHEFT_INSTANT_SOL, PRESETS } from "../../web/lib/presets";
import { configFromJson, configToJson } from "../../web/lib/configJson";
import { actionFromJson, actionToJson } from "../../web/lib/unlock";
import { hex } from "../../web/lib/format";
import { applyPreset, buildConfig, changeDao, defaultForm, type CreateForm } from "../src/core/create";
import { PendingStore } from "../src/core/pendingStore";
import { signedFor } from "../src/core/signing";
import { withdrawTiming, offWhitelist } from "../src/core/timing";
import { buildSignerUncached, getSigner, setWorkerFactory } from "../src/core/trees";

/** Runs the site's real worker module in-process: `self.onmessage` is what web/lib/tree.worker.ts sets. */
async function installSiteWorker() {
  const selfObj: { onmessage?: (e: { data: unknown }) => void; postMessage?: (d: unknown) => void } = {};
  (globalThis as unknown as { self: unknown }).self = selfObj;
  await import("../../web/lib/tree.worker");
  setWorkerFactory(() => {
    const w = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage: (d: unknown) => queueMicrotask(() => selfObj.onmessage!({ data: d })) };
    selfObj.postMessage = (d) => w.onmessage?.({ data: d });
    return w as unknown as Worker;
  });
}

const sameTree = (a: Signer, b: Signer) => {
  expect(a.tree).toBe(b.tree);
  expect(hex(a.pub.root)).toBe(hex(b.pub.root));
  expect(a.pub.height).toBe(b.pub.height);
  expect(a.pub.levels.map((l) => l.map(hex))).toEqual(b.pub.levels.map((l) => l.map(hex)));
  expect(hex(a.seeds.pkSeed)).toBe(hex(b.seeds.pkSeed));
  expect(hex(a.seeds.skSeed)).toBe(hex(b.seeds.skSeed));
};

let master: Uint8Array;
let primary: Signer;

beforeAll(async () => {
  await installSiteWorker();
  master = newMasterSecret();
  primary = makeSigner(master, 2, 0);
});

describe("trees: extension copy of web/lib/trees.ts + the site's worker == sdk makeSigner", () => {
  it("signer tree (vault number 2), with progress", async () => {
    let last: [number, number] = [0, 0];
    const s = await getSigner(master, 2, 0, (d, t) => (last = [d, t]));
    sameTree(s, primary);
    expect(last).toEqual([256, 256]);
  });
  it("the copy still matches web/lib/trees.ts, function by function (getWorker is the one documented change)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const site = readFileSync(join(here, "../../web/lib/trees.ts"), "utf8");
    const ours = readFileSync(join(here, "../src/core/trees.ts"), "utf8").replace(/\s+/g, " ");
    for (const name of ["openDb", "cacheGet", "cachePut", "buildInWorker", "getSigner", "clearTreeCache"]) {
      const m = site.match(new RegExp(`(?:export )?(?:async )?function ${name}\\b[\\s\\S]*?\\n}\\n`));
      expect(m, name).not.toBeNull();
      expect(ours, `${name} drifted from web/lib/trees.ts`).toContain(m![0].replace(/\s+/g, " ").trim());
    }
  });
  it("recovery and duress trees, uncached", async () => {
    sameTree(await buildSignerUncached(master, 2, RECOVERY_TREE), makeSigner(master, 2, RECOVERY_TREE));
    sameTree(await buildSignerUncached(master, 0, DURESS_TREE), makeSigner(master, 0, DURESS_TREE));
  });
});

describe("create: port of SetupVault == makeConfig for every preset", () => {
  const recRoot = new Uint8Array(32).fill(0x5a);
  const DAO = "SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu";
  const ready = (p: (typeof PRESETS)[number][0]): CreateForm => {
    let f = applyPreset({ ...defaultForm(), recRoot, recHanded: true }, p);
    if (p === "dao") f = changeDao(f, DAO);
    if (p === "team" || p === "vesting") f = { ...f, coCodes: ["11".repeat(32), "22".repeat(32)] };
    return f;
  };
  const expected: Record<string, Parameters<typeof makeConfig>[1]> = {
    personal: { coSigners: [], threshold: 1, whitelist: [], slowDelaySecs: 0, instantLimitLamports: 0n, heirs: [] },
    antitheft: { coSigners: [], threshold: 1, recoveryRoot: recRoot, recoveryDelaySecs: 90 * DAY, whitelist: [], slowDelaySecs: 72 * 3600, instantLimitLamports: BigInt(Number(ANTITHEFT_INSTANT_SOL) * 1e9), heirs: [] },
    team: { coSigners: [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)], threshold: 2, recoveryRoot: recRoot, recoveryDelaySecs: 30 * DAY, whitelist: [], slowDelaySecs: 0, instantLimitLamports: 0n, heirs: [] },
    slow: { coSigners: [], threshold: 1, recoveryRoot: recRoot, recoveryDelaySecs: 30 * DAY, whitelist: [], slowDelaySecs: 72 * 3600, instantLimitLamports: 10_000_000n, heirs: [] },
    vesting: { coSigners: [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)], threshold: 2, recoveryRoot: recRoot, recoveryDelaySecs: 30 * DAY, whitelist: [], slowDelaySecs: 72 * 3600, instantLimitLamports: 10_000_000n, heirs: [] },
    dao: { coSigners: [], threshold: 1, recoveryRoot: recRoot, recoveryDelaySecs: 90 * DAY, whitelist: [new PublicKey(DAO)], slowDelaySecs: 0, instantLimitLamports: 0n, heirs: [] },
  };
  for (const [p] of PRESETS) {
    it(p, () => {
      const r = buildConfig(primary, ready(p), PROGRAM_ID);
      if ("error" in r) throw new Error(r.error);
      const want = makeConfig(primary, expected[p]);
      expect(configToJson(r.config)).toEqual(configToJson(want));
      expect(r.vault.toBase58()).toBe(vaultOf(want).toBase58());
      // the saved JSON (the site's nox3.config format) restores the same vault
      expect(vaultOf(configFromJson(configToJson(r.config))).toBase58()).toBe(r.vault.toBase58());
    });
  }
  it("same validation as the site", () => {
    expect(buildConfig(primary, { ...applyPreset(defaultForm(), "antitheft") }, PROGRAM_ID)).toEqual({ error: "Generate the recovery phrase first." });
    expect(buildConfig(primary, { ...applyPreset(defaultForm(), "antitheft"), recRoot }, PROGRAM_ID)).toEqual({ error: "Confirm the recovery phrase was written down / handed over." });
    expect(buildConfig(primary, applyPreset({ ...defaultForm(), recRoot, recHanded: true }, "dao"), PROGRAM_ID)).toMatchObject({ error: expect.stringMatching(/Squads/) });
    expect(buildConfig(primary, { ...defaultForm(), whitelist: ["nope"] }, PROGRAM_ID)).toMatchObject({ error: expect.stringMatching(/Not a valid address/) });
    expect(buildConfig(primary, { ...defaultForm(), heirs: [{ addr: DAO, pct: "60" }] }, PROGRAM_ID)).toEqual({ error: "Heir shares must add up to exactly 100%." });
  });
});

describe("transactions: what the extension signs and sends == sdk planAction", () => {
  const program = readProgram(new Connection("http://127.0.0.1:1"));
  const vault = new PublicKey("B9fCLC48ySs6R7E58zS8NcrvqtFFhNtV6RgMBqQG9Fty");
  const relayer = new PublicKey("HH6D7N6wwLg1Uahdk4xm8uj8kHsrVrMo7AFNf2ymEzH8");
  const action: Action = { kind: "withdraw", mint: new Uint8Array(32), dest: new PublicKey("DmpPGVKPkhsxAWxW5WaxReDa2QxdJZvXk8BaG1SwQXAC").toBytes(), amount: 60_000_000n, fee: 100_000n, feePayee: relayer.toBytes() };

  it("same signature, same instructions, same packing", async () => {
    const leaf = 5;
    const s = signedFor({ program, vault, signer: primary, store: new PendingStore({ get: async () => ({}), set: async () => {} }) }, { leaf, action, mode: "relayer", source: "local" });
    const plan = await planAction({ program, payer: relayer, vault, signer: primary, leaf, action, execute: true });
    expect(s.signature.map(hex)).toEqual(plan.signature.map(hex));
    expect(s.authPath.map(hex)).toEqual(authPath(primary.pub, leaf).map(hex));
    // the signature recovers the tree root the vault stores: the on-chain verifier accepts it
    expect(equal(recoverRoot(s.pkSeed, leaf, actionDigest(PROGRAM_ID, vault, 0, leaf, action), s.signature, s.authPath), primary.pub.root)).toBe(true);
    const steps = await buildSteps(program, relayer, s, { execute: true, creator: relayer });
    const ours = packSteps(relayer, steps);
    const ser = (txs: { label: string; instructions: { data: Buffer; keys: { pubkey: PublicKey }[] }[] }[]) =>
      txs.map((t) => ({ label: t.label, ixs: t.instructions.map((ix) => ({ data: ix.data.toString("hex"), keys: ix.keys.map((k) => k.pubkey.toBase58()) })) }));
    expect(ser(ours)).toEqual(ser(plan.transactions));
    expect(ours.length).toBeGreaterThan(1); // open / write / verify / approve / execute span several transactions
  });

  it("relay request round-trips; the stored PendingAction round-trips", () => {
    const s = signedFor({ program, vault, signer: primary, store: new PendingStore({ get: async () => ({}), set: async () => {} }) }, { leaf: 9, action, mode: "relayer", source: "local" });
    const back = decodeRelayRequest(JSON.parse(JSON.stringify(encodeRelayRequest(s))));
    expect(back.signature.map(hex)).toEqual(s.signature.map(hex));
    expect(encodeAction(back.action)).toEqual(encodeAction(action));
    expect(encodeAction(actionFromJson(JSON.parse(JSON.stringify(actionToJson(action)))))).toEqual(encodeAction(action));
  });

  it("pinned vectors: action encoding and message digest", () => {
    expect(hex(encodeAction(action))).toBe(
      "00" + "00".repeat(32) + hex(new PublicKey("DmpPGVKPkhsxAWxW5WaxReDa2QxdJZvXk8BaG1SwQXAC").toBytes()) + "0087930300000000" + "a086010000000000" + hex(relayer.toBytes())
    );
    expect(hex(actionDigest(PROGRAM_ID, vault, 0, 5, action))).toMatchInlineSnapshot(`"61835b3c14058c02ec1d22131ef0e70e7bc5a041738494f109ab73a3b968f92c"`);
  });
});

describe("timing shown before signing (same rules as preflight / the program)", () => {
  const DEST = new PublicKey("DmpPGVKPkhsxAWxW5WaxReDa2QxdJZvXk8BaG1SwQXAC");
  const WL = new PublicKey("BFwro7RnsG9GR2jV3yGXGwtGkRq8MDxH9LSoTAjMQf2x");
  const st = (c: Partial<VaultStateView["config"]>, extra: Partial<VaultStateView> = {}): VaultStateView =>
    ({
      config: { ...makeConfig(primary, {}), ...c },
      used: [],
      lastActive: 1_000,
      windowStart: 0,
      windowSpent: 0n,
      ...extra,
    }) as unknown as VaultStateView;
  const w = (amount: bigint, dest = DEST, mint = new Uint8Array(32)): Action => ({ kind: "withdraw", mint, dest: dest.toBytes(), amount, fee: 0n, feePayee: dest.toBytes() });
  const NOW = 2_000_000;
  it("anti-theft style: whitelist instant, small amounts instant, larger ones wait", () => {
    const s = st({ whitelist: [WL.toBytes()], instantLimit: 50_000_000n, slowDelay: 72n * 3600n });
    expect(withdrawTiming(s, 0, w(5_000_000_000n, WL), NOW)?.kind).toBe("instant");
    expect(withdrawTiming(s, 0, w(10_000_000n), NOW)?.kind).toBe("instant");
    expect(withdrawTiming(s, 0, w(60_000_000n), NOW)).toMatchObject({ kind: "wait", secs: 72 * 3600 });
    expect(withdrawTiming(s, 0, w(1n, DEST, new Uint8Array(32).fill(4)), NOW)?.kind).toBe("wait");
    expect(offWhitelist(s, DEST.toBytes())).toBe(true);
    expect(offWhitelist(s, WL.toBytes())).toBe(false);
    // today's spending counts against the limit
    expect(withdrawTiming(st(s.config, { windowStart: NOW - 100, windowSpent: 45_000_000n }), 0, w(10_000_000n), NOW)?.kind).toBe("wait");
  });
  it("strict whitelist refuses; no rules = instant; recovery after the delay is unrestricted", () => {
    expect(withdrawTiming(st({ whitelist: [WL.toBytes()], slowDelay: 0n }), 0, w(1n), NOW)?.kind).toBe("refused");
    expect(withdrawTiming(st({}), 0, w(1n), NOW)?.kind).toBe("instant");
    const r = st({ whitelist: [WL.toBytes()], slowDelay: 0n, recoveryDelay: 100n });
    expect(withdrawTiming(r, RECOVERY_TREE, w(1n), NOW)?.kind).toBe("instant");
  });
});
