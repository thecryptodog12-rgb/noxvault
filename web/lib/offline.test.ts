import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { SOL_MINT, type SignedAction } from "@nox/sdk/client";
import type { Action } from "@nox/sdk/wots";
import {
  PartCollector,
  SIGNED_PREFIX,
  UNSIGNED_PREFIX,
  decodeUnsigned,
  encodeUnsigned,
  matchesUnsigned,
  parsePart,
  parseSubmitInput,
  splitForQr,
} from "./offline";

// Deterministic pseudo-random text and shuffles, so failures reproduce.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const textOf = (len: number, seed = 1) => {
  const r = rng(seed);
  const abc = "0123456789abcdef{}\":,[]ABCDEFxyz ";
  return Array.from({ length: len }, () => abc[Math.floor(r() * abc.length)]).join("");
};
function shuffle<T>(a: T[], seed: number): T[] {
  const r = rng(seed);
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const VAULT = new PublicKey("CGiG5w5aiiMSNq2bJfjQ1rJuxcHGrTGDXs3wrR4FLc2V");
const DEST = new PublicKey("6S396A19NFHWdABtBP17tjfFCZA9LJuuvuPK7hWzj7w9");

describe("QR chunk framing", () => {
  it("round-trips texts of many sizes in order", () => {
    for (const len of [0, 1, 299, 300, 301, 1400, 2900, 3100]) {
      for (const size of [100, 300, 800]) {
        const text = textOf(len, len + size);
        const parts = splitForQr(text, size);
        expect(parts.length).toBe(Math.max(1, Math.ceil(len / size)));
        for (const p of parts) expect(p.length - p.indexOf(":", p.indexOf("/")) - 1).toBeLessThanOrEqual(size);
        const c = new PartCollector();
        for (const p of parts) expect(c.add(p)).toBe("new");
        expect(c.done).toBe(true);
        expect(c.text()).toBe(text);
      }
    }
  });

  it("reassembles out-of-order frames", () => {
    const text = textOf(2900, 7); // about the size of a signed request
    const parts = splitForQr(text, 300);
    for (let seed = 1; seed <= 20; seed++) {
      const c = new PartCollector();
      for (const p of shuffle(parts, seed)) c.add(p);
      expect(c.text()).toBe(text);
    }
  });

  it("ignores duplicate frames, as from a looping animation", () => {
    const text = textOf(1500, 3);
    const parts = splitForQr(text, 200);
    const c = new PartCollector();
    // two full loops starting mid-sequence, each frame seen twice in a row
    const seq = [...parts.slice(3), ...parts, ...parts.slice(0, 3)].flatMap((p) => [p, p]);
    const results = seq.map((p) => c.add(p));
    expect(results.filter((r) => r === "new").length).toBe(parts.length);
    expect(results.filter((r) => r === "dup").length).toBe(seq.length - parts.length);
    expect(c.text()).toBe(text);
  });

  it("tracks what is missing and is not done early", () => {
    const parts = splitForQr(textOf(1000, 9), 100);
    const c = new PartCollector();
    for (const p of parts) if (!p.includes(":4/") && !p.includes(":9/")) c.add(p);
    expect(c.done).toBe(false);
    expect(c.text()).toBeNull();
    expect(c.missing()).toEqual([4, 9]);
  });

  it("refuses frames from a different request", () => {
    const a = splitForQr(textOf(900, 1), 300);
    const b = splitForQr(textOf(900, 2), 300);
    const c = new PartCollector();
    c.add(a[0]);
    expect(c.add(b[1])).toBe("other");
    c.add(a[1]);
    c.add(a[2]);
    expect(c.text()).toBe(textOf(900, 1));
  });

  it("detects a tampered chunk by checksum", () => {
    const text = textOf(600, 4);
    const parts = splitForQr(text, 200);
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith("x") ? "y" : "x");
    const c = new PartCollector();
    for (const p of parts) c.add(p);
    expect(c.done).toBe(true);
    expect(() => c.text()).toThrow(/checksum/);
  });

  it("keeps signed and unsigned prefixes apart", () => {
    const u = splitForQr("hello", 10, UNSIGNED_PREFIX);
    expect(u[0].startsWith("NOXA1:")).toBe(true);
    expect(parsePart(u[0], SIGNED_PREFIX)).toBeNull();
    expect(new PartCollector(SIGNED_PREFIX).add(u[0])).toBe("bad");
    const c = new PartCollector(UNSIGNED_PREFIX);
    expect(c.add(u[0])).toBe("new");
    expect(c.text()).toBe("hello");
  });

  it("rejects malformed frames", () => {
    for (const bad of ["", "hello", "NOX1:zzzzzzzz:1/2:x", "NOX1:0123abcd:0/2:x", "NOX1:0123abcd:3/2:x", "NOX1:0123abcd:1/65:x"]) expect(parsePart(bad)).toBeNull();
    expect(() => splitForQr(textOf(1000), 10)).toThrow(/Too many/);
  });
});

describe("unsigned requests", () => {
  const withdraw: Action = { kind: "withdraw", mint: SOL_MINT.toBytes(), dest: DEST.toBytes(), amount: 1_500_000_000n, fee: 20_000n, feePayee: DEST.toBytes() };

  it("round-trips through JSON and QR parts", () => {
    const text = encodeUnsigned({ vault: VAULT, tree: 0, leaf: 7, action: withdraw, decimals: 9 });
    const c = new PartCollector(UNSIGNED_PREFIX);
    for (const p of shuffle(splitForQr(text, 120, UNSIGNED_PREFIX), 5)) c.add(p);
    const u = decodeUnsigned(c.text()!);
    expect(u.vault.equals(VAULT)).toBe(true);
    expect(u.tree).toBe(0);
    expect(u.leaf).toBe(7);
    expect(u.decimals).toBe(9);
    expect(u.action).toEqual(withdraw);
  });

  it("round-trips every kind the form can build", () => {
    const actions: Action[] = [
      { kind: "schedule", id: 2, mint: SOL_MINT.toBytes(), dest: DEST.toBytes(), amount: 5n, interval: 86400n, count: 12, start: 1_800_000_000n, fee: 0n, feePayee: new Uint8Array(32) },
      { kind: "budget", id: 1, session: DEST.toBytes(), mint: SOL_MINT.toBytes(), limit: 9n, period: 3600n, expires: 1_900_000_000n, fee: 0n, feePayee: new Uint8Array(32) },
      { kind: "stake", seed: 3, vote: DEST.toBytes(), amount: 10n, fee: 0n, feePayee: new Uint8Array(32) },
      { kind: "unstake", seed: 3, fee: 0n, feePayee: new Uint8Array(32) },
      { kind: "migrate", newVault: VAULT.toBytes(), fee: 0n, feePayee: new Uint8Array(32) },
      { kind: "ping", fee: 0n, feePayee: new Uint8Array(32) },
      { kind: "cancel", fee: 0n, feePayee: new Uint8Array(32) },
    ];
    for (const action of actions) expect(decodeUnsigned(encodeUnsigned({ vault: VAULT, tree: 3, leaf: 15, action })).action).toEqual(action);
  });

  it("rejects anything that is not exactly an unsigned request", () => {
    const good = JSON.parse(encodeUnsigned({ vault: VAULT, tree: 0, leaf: 1, action: withdraw }));
    const bad = [
      "not json",
      JSON.stringify({ ...good, t: "nox-unsigned/0" }),
      JSON.stringify({ ...good, tree: 4 }),
      JSON.stringify({ ...good, leaf: 256 }),
      JSON.stringify({ ...good, vault: "nope" }),
      JSON.stringify({ ...good, action: { ...good.action, amount: "-1" } }),
      JSON.stringify({ ...good, action: { ...good.action, extra: 1 } }),
      JSON.stringify({ ...good, action: { kind: "withdraw" } }),
      JSON.stringify({ ...good, action: { ...good.action, kind: "letterKey" } }),
    ];
    for (const b of bad) expect(() => decodeUnsigned(b)).toThrow();
  });

  it("matches a signed request only for the identical action", () => {
    const u = decodeUnsigned(encodeUnsigned({ vault: VAULT, tree: 0, leaf: 1, action: withdraw }));
    const s: SignedAction = { vault: VAULT, tree: 0, leaf: 1, pkSeed: new Uint8Array(32), authPath: [], signature: [], action: withdraw };
    expect(matchesUnsigned(s, u)).toBe(true);
    expect(matchesUnsigned({ ...s, leaf: 2 }, u)).toBe(false);
    expect(matchesUnsigned({ ...s, action: { ...withdraw, amount: 1n } }, u)).toBe(false);
    expect(matchesUnsigned({ ...s, action: { ...withdraw, dest: VAULT.toBytes() } }, u)).toBe(false);
  });

  it("does not let an unsigned request pass as a signed one", () => {
    const parts = splitForQr(encodeUnsigned({ vault: VAULT, tree: 0, leaf: 1, action: withdraw }), 100, UNSIGNED_PREFIX);
    expect(() => parseSubmitInput(parts.join("\n"))).toThrow();
  });
});
