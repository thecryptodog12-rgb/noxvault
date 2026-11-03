import { describe, expect, it } from "vitest";
import { riskOf, type RiskInput } from "./exposure";

const base: RiskInput = { kind: "wallet", lamports: 0, stakeWithdrawable: 0, stakeStakerOnly: 0, tokens: 0, usd: null, delegations: 0, escapeArmed: false, activity: null, now: 1_800_000_000 };

describe("riskOf", () => {
  it("vaults and program addresses have no ed25519 exposure", () => {
    expect(riskOf({ ...base, kind: "vault", lamports: 1e12 }).level).toBe("none");
    expect(riskOf({ ...base, kind: "pda", lamports: 1e12 }).level).toBe("none");
  });

  it("grades wallets by value, in USD when priced and SOL otherwise", () => {
    expect(riskOf(base).level).toBe("low");
    expect(riskOf({ ...base, lamports: 5e8 }).level).toBe("low");
    expect(riskOf({ ...base, lamports: 2e9 }).level).toBe("medium");
    expect(riskOf({ ...base, lamports: 50e9, stakeWithdrawable: 60e9 }).level).toBe("high");
    expect(riskOf({ ...base, lamports: 1e9, usd: 50 }).level).toBe("low");
    expect(riskOf({ ...base, lamports: 1e9, usd: 20_000 }).level).toBe("high");
  });

  it("explains the exposure honestly and lists what adds to it", () => {
    const r = riskOf({ ...base, lamports: 2e9, stakeWithdrawable: 1e9, stakeStakerOnly: 1, tokens: 3, delegations: 1, activity: { count: 3000, capped: true, last: 1_800_000_000 - 86400 * 3, first: 1, failed: 0 } });
    const text = r.points.join(" ");
    expect(text).toMatch(/address is the public key/);
    expect(text).toMatch(/1 SOL is staked/);
    expect(text).toMatch(/redelegate/);
    expect(text).toMatch(/3 token balances/);
    expect(text).toMatch(/delegate/);
    expect(text).toMatch(/More than 3,000 transactions, last 3 days ago/);
    expect(text).not.toMatch(/hack|untraceable/i);
  });
});
