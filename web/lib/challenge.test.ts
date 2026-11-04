import { describe, expect, it } from "vitest";
import { challengeExplorerUrl, daysUnbroken, parseCluster, parseStart, parseVault } from "./challenge";

describe("challenge config", () => {
  it("accepts only a valid vault address", () => {
    expect(parseVault(undefined)).toBe("");
    expect(parseVault("  ")).toBe("");
    expect(parseVault("not-an-address")).toBe("");
    expect(parseVault(" 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4 ")).toBe("8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4");
  });

  it("defaults the cluster to mainnet", () => {
    expect(parseCluster(undefined)).toBe("mainnet-beta");
    expect(parseCluster("nonsense")).toBe("mainnet-beta");
    expect(parseCluster("devnet")).toBe("devnet");
  });

  it("parses the start date", () => {
    expect(parseStart(undefined)).toBeNull();
    expect(parseStart("soon")).toBeNull();
    expect(parseStart("2027-01-01T00:00:00Z")).toBe(1798761600);
  });

  it("counts whole days unbroken", () => {
    const start = 1_000_000;
    expect(daysUnbroken(null, start)).toBe(0);
    expect(daysUnbroken(start, start - 10)).toBe(0);
    expect(daysUnbroken(start, start + 86399)).toBe(0);
    expect(daysUnbroken(start, start + 86400 * 3 + 5)).toBe(3);
  });

  it("links the explorer to the challenge cluster", () => {
    expect(challengeExplorerUrl("abc", "address", "mainnet-beta")).toBe("https://explorer.solana.com/address/abc");
    expect(challengeExplorerUrl("sig", "tx", "devnet")).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
  });
});
