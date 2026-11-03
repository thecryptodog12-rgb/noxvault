import { describe, expect, it } from "vitest";
import { MAX_ACTION_FEE, PROGRAM_ERROR_TEXT, explainError, idl } from "@nox/sdk/client";
import { freeLockdownAction, relayFee } from "@nox/sdk/relayer";

// v4.1 (docs/SPEC.md §4 "The fee", §11): what the relay route and the ActionPanel show.
describe("v4.1 fee rules in the app", () => {
  it("the relayer never asks more than the program's cap", () => {
    expect(MAX_ACTION_FEE).toBe(10_000_000n);
    expect(relayFee({ minFee: 100_000n })).toBe(100_000n);
    expect(relayFee({ minFee: 100_000n }, 1_461_600n)).toBe(1_561_600n); // + letter-key account rent
    expect(relayFee({ minFee: 50_000_000n })).toBe(MAX_ACTION_FEE);
  });

  it("only the signers' Ping and cancels in a lockdown are relayed free", () => {
    expect(freeLockdownAction(0, "ping", true)).toBe(true);
    expect(freeLockdownAction(2, "cancelBudget", true)).toBe(true);
    expect(freeLockdownAction(0, "ping", false)).toBe(false);
    expect(freeLockdownAction(3, "cancel", true)).toBe(false); // recovery may pay the capped fee
    expect(freeLockdownAction(0, "withdraw", true)).toBe(false);
  });

  it("every new program error reads as a sentence, by name or by code", () => {
    const errs = (idl as unknown as { errors: { code: number; name: string }[] }).errors;
    for (const name of ["FeeTooHigh", "FeeInLockdown", "DuplicateRoot", "BudgetDestRestricted", "DurationTooLong"]) {
      const e = errs.find((x) => x.name === name);
      expect(e, name).toBeTruthy();
      expect(explainError(new Error(`AnchorError occurred. Error Code: ${name}. Error Number: ${e!.code}.`))).toBe(PROGRAM_ERROR_TEXT[name]);
      expect(explainError(new Error(`Transaction simulation failed: custom program error: 0x${e!.code.toString(16)}`))).toBe(PROGRAM_ERROR_TEXT[name]);
    }
    expect(explainError({ message: "x", logs: ["Program log: AnchorError ... Error Code: BudgetDestRestricted."] })).toContain("non-restricted");
    expect(explainError(new Error("fee must be at least 100000 lamports"))).toBe("fee must be at least 100000 lamports");
  });
});
