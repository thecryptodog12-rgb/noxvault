import { describe, expect, it } from "vitest";
import { badgeCount, dedupe, extAlerts, fmtTokenAmount } from "../src/lib/alerts";
import { DEST, MINT, NOW, SOL, VAULT, snap } from "./fixtures";

const pending = (p: Partial<NonNullable<ReturnType<typeof snap>["pending"]>> = {}) =>
  snap({ pending: { kind: "withdraw", mint: SOL, dest: DEST, amount: "42000000000", executableAt: NOW + 71 * 3600, ...p } });

describe("extAlerts", () => {
  it("a quiet vault raises nothing", () => {
    expect(extAlerts(null, snap(), NOW)).toEqual([]);
  });

  it("pending SOL withdrawal: amount, short vault, countdown, recovery link, urgent", () => {
    const [a] = extAlerts(null, pending(), NOW);
    expect(a.kind).toBe("pending");
    expect(a.urgent).toBe(true);
    expect(a.message).toBe(`⚠️ 42 SOL wants to leave vault B9fC…9Fty to DmpP…QXAC: executes in 2 days 23 h. Not you? Cancel with your recovery phrase.`);
    expect(a.url).toBe(`https://www.nox-vault.com/recovery?vault=${VAULT}`);
    expect(a.id.startsWith(`devnet:${VAULT}:pending:`)).toBe(true);
  });

  it("pending past its time says it can execute now", () => {
    const [a] = extAlerts(null, pending({ executableAt: NOW - 1 }), NOW);
    expect(a.message).toContain("can execute now");
  });

  it("token withdrawal uses decimals when the vault holds the mint", () => {
    const s = pending({ mint: MINT, amount: "1500000" });
    s.tokens = [{ mint: MINT, ui: "10", raw: "10000000", decimals: 6 }];
    expect(extAlerts(null, s, NOW)[0].message).toContain("⚠️ 1.5 of Fdk8…HTow wants to leave");
    expect(fmtTokenAmount(MINT, "1500000", s.tokens)).toBe("1.5 of Fdk8…HTow");
    expect(fmtTokenAmount(MINT, "7", [])).toBe("7 base units of Fdk8…HTow");
  });

  it("migration and lockdown are urgent", () => {
    const m = extAlerts(null, pending({ kind: "migrate" }), NOW);
    expect(m[0].kind).toBe("migrate");
    expect(m[0].message).toContain("All funds of vault B9fC…9Fty");
    const l = extAlerts(null, snap({ lockdownUntil: NOW + 3 * 86_400 }), NOW);
    expect(l.map((x) => [x.kind, x.urgent])).toEqual([["lockdown", true]]);
    expect(l[0].message).toContain("duress");
  });

  it("recovery clock inside 14 days warns, links to the owner page, not urgent", () => {
    const a = extAlerts(null, snap({ recoveryAt: NOW + 2 * 86_400 }), NOW);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "recovery", urgent: false, url: "https://www.nox-vault.com/mine" });
    expect(extAlerts(null, snap({ recoveryAt: NOW + 30 * 86_400 }), NOW)).toEqual([]);
  });
});

describe("dedupe", () => {
  it("notifies each event once", () => {
    const alerts = extAlerts(null, pending(), NOW);
    const first = dedupe(alerts, {}, NOW);
    expect(first.fresh).toHaveLength(1);
    const second = dedupe(extAlerts(null, pending(), NOW + 120), first.seen, NOW + 120);
    expect(second.fresh).toHaveLength(0);
  });

  it("a new pending withdrawal after a cancel notifies again", () => {
    const first = dedupe(extAlerts(null, pending(), NOW), {}, NOW);
    const other = dedupe(extAlerts(null, pending({ executableAt: NOW + 80 * 3600 }), NOW + 600), first.seen, NOW + 600);
    expect(other.fresh).toHaveLength(1);
  });

  it("keeps live ids forever, drops old dead ones", () => {
    const old = { "devnet:x:pending:1": NOW - 100 * 86_400, "devnet:y:lockdown:2": NOW - 1000 };
    const live = extAlerts(null, pending(), NOW);
    const seenLive = { [live[0].id]: NOW - 100 * 86_400 };
    const r = dedupe(live, { ...old, ...seenLive }, NOW);
    expect(Object.keys(r.seen).sort()).toEqual([live[0].id, "devnet:y:lockdown:2"].sort());
    expect(r.fresh).toHaveLength(0);
  });

  it("schedule payouts are recorded but not notified", () => {
    const prev = snap({ schedules: [{ id: 0, mint: SOL, dest: DEST, amount: "1000", remaining: 3, nextAt: NOW }] });
    const cur = snap({ schedules: [{ id: 0, mint: SOL, dest: DEST, amount: "1000", remaining: 2, nextAt: NOW + 86_400 }] });
    const alerts = extAlerts(prev, cur, NOW);
    expect(alerts.map((a) => a.kind)).toEqual(["schedule"]);
    const r = dedupe(alerts, {}, NOW);
    expect(r.fresh).toHaveLength(0);
    expect(Object.keys(r.seen)).toHaveLength(1);
  });
});

describe("badgeCount", () => {
  it("counts pending and active lockdowns", () => {
    expect(badgeCount([snap(), null, undefined], NOW)).toBe(0);
    expect(badgeCount([pending(), snap({ lockdownUntil: NOW + 10 }), snap({ lockdownUntil: NOW - 10 })], NOW)).toBe(2);
  });
});
