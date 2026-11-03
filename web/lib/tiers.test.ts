import { describe, expect, it } from "vitest";
import { TIER_FREE, TIER_GUARDIAN, TIER_SENTINEL } from "@nox/sdk/client";
import { tierGap, tierProgress, tierTarget } from "./tiers";

const p = { guardian: 10_000n, sentinel: 100_000n };

describe("tier math", () => {
  it("targets and gaps", () => {
    expect(tierTarget(TIER_FREE, p)).toBe(0n);
    expect(tierTarget(TIER_GUARDIAN, p)).toBe(10_000n);
    expect(tierTarget(TIER_SENTINEL, p)).toBe(100_000n);
    expect(tierGap(4_000n, 10_000n)).toBe(6_000n);
    expect(tierGap(12_000n, 10_000n)).toBe(0n);
  });

  it("progress is piecewise: Guardian sits at the middle", () => {
    expect(tierProgress(0n, p)).toBe(0);
    expect(tierProgress(5_000n, p)).toBe(25);
    expect(tierProgress(10_000n, p)).toBe(50);
    expect(tierProgress(55_000n, p)).toBe(75);
    expect(tierProgress(100_000n, p)).toBe(100);
    expect(tierProgress(10n ** 12n, p)).toBe(100);
  });
});
