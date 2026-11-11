import { describe, expect, it } from "vitest";
import { base58Decode, base58Encode, explorerUrl, parseAddress, rpcFor, rpcOriginPattern, siteLinks } from "../src/lib/net";
import { qrSvg } from "../src/lib/qr";
import { ruleLines, rulesFromConfig } from "../src/lib/rules";
import { clocks, countdown, headline } from "../src/lib/status";
import type { Config } from "../../sdk/wots";
import { DEST, NOW, SOL, VAULT, rules, snap } from "./fixtures";

describe("addresses", () => {
  it("accepts real 32-byte base58 addresses, rejects the rest", () => {
    expect(parseAddress(`  ${VAULT}\n`)).toBe(VAULT);
    expect(parseAddress("11111111111111111111111111111111")).toBe("11111111111111111111111111111111");
    expect(parseAddress("not an address")).toBeNull();
    expect(parseAddress(VAULT.slice(0, 30))).toBeNull();
    expect(parseAddress(VAULT.replace("B", "0"))).toBeNull(); // 0 is not base58
    expect(parseAddress("abandon ability able about above absent absorb abstract absurd abuse access accident")).toBeNull();
  });
  it("base58 round-trips, leading zeros included", () => {
    const b = new Uint8Array(32);
    b[5] = 7;
    b[31] = 255;
    expect(base58Decode(base58Encode(b))).toEqual(b);
    expect(base58Encode(base58Decode(VAULT)!)).toBe(VAULT);
  });
});

describe("rpc + links", () => {
  it("custom RPC must be https (or http on localhost) and maps to an origin pattern", () => {
    expect(rpcOriginPattern("https://devnet.helius-rpc.com/?api-key=x")).toBe("https://devnet.helius-rpc.com/*");
    expect(rpcOriginPattern("http://localhost:8899")).toBe("http://localhost/*");
    expect(rpcOriginPattern("http://evil.example")).toBeNull();
    expect(rpcOriginPattern("https://user:pw@host.example")).toBeNull();
    expect(rpcOriginPattern("nope")).toBeNull();
    expect(rpcFor("devnet", "")).toBe("https://api.devnet.solana.com");
    expect(rpcFor("custom", "https://x.example")).toBe("https://x.example");
  });
  it("deep links point at the site's real routes", () => {
    const l = siteLinks(VAULT);
    expect(l.view).toBe(`https://www.nox-vault.com/t/${VAULT}`);
    expect(l.fund).toBe(`https://www.nox-vault.com/fund/${VAULT}`);
    expect(l.owner).toBe("https://www.nox-vault.com/mine");
    expect(l.recovery).toBe(`https://www.nox-vault.com/recovery?vault=${VAULT}`);
    expect(explorerUrl(VAULT, "devnet")).toContain("?cluster=devnet");
  });
});

describe("rules", () => {
  const key = (n: number) => base58Decode(n ? DEST : VAULT)!;
  const config = (p: Partial<Config> = {}): Config => ({
    trees: [
      { root: new Uint8Array(32).fill(1), height: 8 },
      { root: new Uint8Array(32), height: 0 },
      { root: new Uint8Array(32), height: 0 },
      { root: new Uint8Array(32), height: 0 },
    ],
    threshold: 1,
    recoveryDelay: 0n,
    whitelist: [],
    slowDelay: 0n,
    instantLimit: 0n,
    heirs: [],
    testamentDelay: 0n,
    duress: { root: new Uint8Array(32).fill(9), height: 4 },
    duressLimit: 500_000_000n,
    duressLock: 259_200n,
    ...p,
  });

  it("flattens a decoded config", () => {
    const c = config({ recoveryDelay: 90n * 86_400n, whitelist: [key(1)], slowDelay: 172_800n, heirs: [{ addr: key(0), bps: 10_000 }], testamentDelay: 365n * 86_400n });
    c.trees[1] = { root: new Uint8Array(32).fill(2), height: 8 };
    c.trees[3] = { root: new Uint8Array(32).fill(3), height: 6 };
    c.threshold = 2;
    const r = rulesFromConfig(c, 250);
    expect(r).toMatchObject({ signers: 2, threshold: 2, slowDelay: 172_800, whitelist: [DEST], recoveryDelay: 90 * 86_400, keysLeft: 250, keysTotal: 256 });
    expect(r.testament).toEqual({ delay: 365 * 86_400, heirs: [{ addr: VAULT, bps: 10_000 }] });
  });

  it("no recovery tree → null; testament needs heirs and a delay", () => {
    const r = rulesFromConfig(config({ testamentDelay: 100n }), 256);
    expect(r.recoveryDelay).toBeNull();
    expect(r.testament).toBeNull();
  });

  it("summarises the withdrawal rules per SPEC §4", () => {
    const by = (r: ReturnType<typeof rules>) => Object.fromEntries(ruleLines(r).map((l) => [l.label, l]));
    expect(by(rules()).Withdrawals).toMatchObject({ value: "any address, instantly", tone: "warn" });
    expect(by(rules({ slowDelay: 172_800, instantLimit: "1000000000" })).Withdrawals.value).toBe("wait 2 days, cancellable");
    expect(by(rules({ slowDelay: 172_800, instantLimit: "1000000000" }))["Instant limit"].value).toBe("1 SOL / 24 h");
    expect(by(rules({ whitelist: [DEST], slowDelay: 0 })).Withdrawals.value).toBe("whitelist instant; others refused");
    expect(by(rules({ signers: 3, threshold: 2 })).Signers.value).toBe("2 of 3 must sign");
    expect(by(rules({ recoveryDelay: 86_400 * 30 })).Recovery.value).toBe("cancel anytime; takeover after 30 days inactive");
    expect(by(rules({ keysLeft: 4 }))["One-time keys"].tone).toBe("warn");
  });
});

describe("status", () => {
  it("headline priority: lockdown > pending > clocks > secure", () => {
    expect(headline(snap(), NOW)).toMatchObject({ tone: "ok", label: "SECURE" });
    expect(headline(snap({ recoveryAt: NOW + 86_400 }), NOW).label).toBe("CLOCK RUNNING");
    expect(headline(snap({ recoveryAt: NOW - 1 }), NOW).label).toBe("OWNER INACTIVE");
    const p = snap({ pending: { kind: "withdraw", mint: SOL, dest: DEST, amount: "1000000000", executableAt: NOW + 3600 } });
    expect(headline(p, NOW)).toMatchObject({ tone: "warn", label: "WITHDRAWAL PENDING", detail: "1 SOL → DmpP…QXAC, in 1 h" });
    expect(headline({ ...p, lockdownUntil: NOW + 60 }, NOW).label).toBe("LOCKDOWN");
  });
  it("lists clocks", () => {
    const c = clocks(snap({ recoveryAt: NOW + 100, testamentAt: NOW + 30 * 86_400, letters: [{ id: 1, label: "kids", unlockRound: "1", opensAt: NOW + 5 }] }), NOW);
    expect(c.map((x) => x.label)).toEqual(["Recovery takeover", "Testament opens", 'Letter "kids"']);
  });
  it("countdown formats", () => {
    expect(countdown(0)).toBe("now");
    expect(countdown(65)).toBe("1m 05s");
    expect(countdown(71 * 3600 + 61)).toBe("2d 23h 01m");
    expect(countdown(3 * 3600 + 5)).toBe("3h 00m 05s");
  });
});

describe("qr", () => {
  it("renders an svg locally", () => {
    const s = qrSvg(VAULT);
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).toContain('fill="#03070a"');
    expect(s).not.toMatch(/href|<image/); // nothing remote
  });
});
