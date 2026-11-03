import { describe, expect, it } from "vitest";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { burnAmountOf, burnedInTx } from "./burns";

const MINT = "Mint111111111111111111111111111111111111111";
const WALLET = "Wa11et1111111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111111";

const burn = (info: Record<string, unknown>, type = "burn", program = "spl-token") =>
  ({ program, programId: {} as never, parsed: { type, info } }) as never;

const tx = (outer: unknown[], inner: unknown[] = [], err: unknown = null) =>
  ({
    blockTime: 1_700_000_000,
    meta: { err, innerInstructions: inner.length ? [{ index: 0, instructions: inner }] : [] },
    transaction: { message: { instructions: outer } },
  }) as unknown as ParsedTransactionWithMeta;

describe("burn counting", () => {
  it("counts burn and burnChecked by the wallet on the mint", () => {
    expect(burnAmountOf(burn({ mint: MINT, authority: WALLET, amount: "500" }), MINT, WALLET)).toBe(500n);
    expect(burnAmountOf(burn({ mint: MINT, authority: WALLET, tokenAmount: { amount: "7" } }, "burnChecked"), MINT, WALLET)).toBe(7n);
    expect(burnAmountOf(burn({ mint: MINT, multisigAuthority: WALLET, amount: "3" }, "burn", "spl-token-2022"), MINT, WALLET)).toBe(3n);
  });

  it("ignores other mints, other authorities, transfers and unparsed instructions", () => {
    expect(burnAmountOf(burn({ mint: OTHER, authority: WALLET, amount: "1" }), MINT, WALLET)).toBeNull();
    expect(burnAmountOf(burn({ mint: MINT, authority: OTHER, amount: "1" }), MINT, WALLET)).toBeNull();
    expect(burnAmountOf(burn({ mint: MINT, authority: WALLET, amount: "1" }, "transfer"), MINT, WALLET)).toBeNull();
    expect(burnAmountOf({ programId: {}, accounts: [], data: "" } as never, MINT, WALLET)).toBeNull();
  });

  it("sums outer and inner instructions, and skips failed transactions", () => {
    const t = tx([burn({ mint: MINT, authority: WALLET, amount: "10" })], [burn({ mint: MINT, authority: WALLET, amount: "5" })]);
    expect(burnedInTx(t, MINT, WALLET)).toBe(15n);
    expect(burnedInTx(tx([burn({ mint: MINT, authority: WALLET, amount: "10" })], [], { InstructionError: [0, "x"] }), MINT, WALLET)).toBe(0n);
    expect(burnedInTx(null, MINT, WALLET)).toBe(0n);
  });
});
