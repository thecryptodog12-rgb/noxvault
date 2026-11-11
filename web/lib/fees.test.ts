import { describe, expect, it } from "vitest";
import { MAX_ACTION_FEE, PROGRAM_ERROR_TEXT, cancelLockAction, canExecute, explainError, idl, type VaultStateView } from "@nox/sdk/client";
import { freeEmergencyAction, freeLockdownAction, relayFee } from "@nox/sdk/relayer";
import { describeAction } from "./unlock";
import { summarize } from "./offline";

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
    for (const name of ["FeeTooHigh", "FeeInLockdown", "DuplicateRoot", "BudgetDestRestricted", "DurationTooLong", "CancelLockNeedsRecovery", "LockOutOfRange"]) {
      const e = errs.find((x) => x.name === name);
      expect(e, name).toBeTruthy();
      expect(explainError(new Error(`AnchorError occurred. Error Code: ${name}. Error Number: ${e!.code}.`))).toBe(PROGRAM_ERROR_TEXT[name]);
      expect(explainError(new Error(`Transaction simulation failed: custom program error: 0x${e!.code.toString(16)}`))).toBe(PROGRAM_ERROR_TEXT[name]);
    }
    expect(explainError({ message: "x", logs: ["Program log: AnchorError ... Error Code: BudgetDestRestricted."] })).toContain("non-restricted");
    expect(explainError(new Error("fee must be at least 100000 lamports"))).toBe("fee must be at least 100000 lamports");
  });
});

// v4.2 (docs/SPEC.md §4, §11): the recovery phrase's cancel and freeze.
describe("v4.2 cancel and freeze in the app", () => {
  it("the recovery phrase's Cancel and CancelLock are relayed free; nobody else's", () => {
    expect(freeEmergencyAction(3, "cancelLock")).toBe(true);
    expect(freeEmergencyAction(3, "cancel")).toBe(true);
    expect(freeEmergencyAction(0, "cancelLock")).toBe(false);
    expect(freeEmergencyAction(3, "withdraw")).toBe(false);
  });

  it("describes the action in plain words, 14 days by default", () => {
    const a = cancelLockAction();
    expect(a).toMatchObject({ kind: "cancelLock", secs: 14n * 86_400n, fee: 0n });
    expect(describeAction(a)).toContain("freeze the vault for 14 d");
    expect(summarize("V", 3, 0, a).headline).toContain("freeze the vault for 14 days");
    expect(() => cancelLockAction(0.5)).toThrow();
    expect(() => cancelLockAction(91)).toThrow();
  });

  it("during a freeze the signers alone are blocked, signers + recovery are not", () => {
    const now = 1_800_000_000;
    const st = { config: { threshold: 1, recoveryDelay: 86_400n }, lockdownUntil: now + 14 * 86_400, lastActive: now } as unknown as VaultStateView;
    const migrate = { kind: "migrate", newVault: new Uint8Array(32).fill(5), fee: 0n, feePayee: new Uint8Array(32) } as const;
    expect(canExecute(st, 0b0001, migrate, now)).toBe(false);
    expect(canExecute(st, 0b1001, migrate, now)).toBe(true);
    expect(canExecute(st, 0b0001, cancelLockAction(), now)).toBe(false);
    expect(canExecute(st, 0b1000, cancelLockAction(), now)).toBe(true);
  });
});
