import { describe, expect, it } from "vitest";
import { ACTION_HEADERS, CHAIN_ID, fundDescription, solToLamports } from "./actions";

describe("solToLamports", () => {
  it("parses decimals exactly", () => {
    expect(solToLamports("0.1")).toBe(100_000_000n);
    expect(solToLamports("0.5")).toBe(500_000_000n);
    expect(solToLamports("1")).toBe(1_000_000_000n);
    expect(solToLamports(".25")).toBe(250_000_000n);
    expect(solToLamports("1,5")).toBe(1_500_000_000n);
    expect(solToLamports("0.000000001")).toBe(1n);
  });
  it("refuses junk", () => {
    for (const s of ["", "0", "-1", "1e3", "abc", "0.0000000001", "1.2.3", null, undefined]) expect(solToLamports(s)).toBeNull();
  });
});

describe("action headers", () => {
  it("carry CORS, version and devnet chain id", () => {
    expect(ACTION_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
    expect(ACTION_HEADERS["X-Action-Version"]).toBe("2.4");
    expect(ACTION_HEADERS["X-Blockchain-Ids"]).toBe(CHAIN_ID);
    expect(CHAIN_ID).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });
});

describe("fundDescription", () => {
  it("lists rules and caveats", () => {
    const d = fundDescription(["Rule A."], ["Caveat B."], 1_250_000_000);
    expect(d).toContain("1.25 SOL");
    expect(d).toContain("• Rule A.");
    expect(d).toContain("! Caveat B.");
  });
});
