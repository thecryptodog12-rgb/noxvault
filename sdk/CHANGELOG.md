# Changelog

The SDK version follows the program version (`0.4.1` = program v4.1, docs/SPEC.md).

## 0.4.2

Matches program v4.2 (docs/SPEC.md "Changes in v4.2"). **Not yet deployed on devnet**: until the
program is upgraded, the deployed program cannot decode `cancelLock` (`InstructionDidNotDeserialize`,
before any key is burned); use `supportsCancelLock` to check. Account layouts are unchanged, every
earlier action encoding is unchanged (`cancelLock` is appended as tag 12), so 0.4.2 is backward
compatible with v4.1 vaults and code.

### Program v4.2 rules the SDK now follows

- New action `{ kind: "cancelLock", secs }` (`Kind::CancelLock`, borsh `u8(12) || i64le(secs)`):
  the recovery tree's cancel and freeze. Only an approval that includes the recovery tree executes
  it (`CancelLockNeedsRecovery`, 6045); `secs` from 1 to 90 days (`LockOutOfRange`, 6046). It
  clears what `cancel` clears and sets `lockdown_until = max(lockdown_until, now + secs)`.
- A lockdown binds only approvals without the recovery tree; signers + recovery together act
  normally and, during a lockdown, `migrate` starts at once (the escape).
- Signer and duress approvals made during a lockdown no longer reset `lastActive`.
- During a lockdown a signer-only `cancel` no longer clears a started migration.

### Added

- `cancelLockAction(days = 14, fee?, feePayee?)`, `cancelLockInBounds`, `MIN_CANCEL_LOCK_SECS`,
  `MAX_CANCEL_LOCK_SECS`, `DEFAULT_CANCEL_LOCK_DAYS` (14).
- `supportsCancelLock(program, payer, vault?)`: simulates one `open_unlock` (nothing is signed or
  sent) to tell whether the deployed program knows `cancelLock`; `isUnsupportedActionError(e)`.
- `preflightAction` takes `together: true` for an action the signer and recovery phrases both
  approve (the escape); it explains the freeze before a recovery `cancelLock` is signed.
- `freeEmergencyAction` (relayer): the recovery phrase's `cancel` and `cancelLock` are relayed free.

### Changed

- `canExecute` follows the v4.2 rules above (`state.rs` `approval_mode`).
- `PROGRAM_ERROR_TEXT` / `explainError`: the two new errors, and the `Lockdown` text mentions the escape.
- The relay request codec accepts the `secs` field.

## 0.4.1

First npm release. Matches program v4.1 on devnet (`8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4`).
v4.1 keeps every v4 account layout, so v4 vaults keep working; it adds checks and constants that
close the findings of the internal review (docs/audit/INVARIANTS.md §9).

### Program v4.1 rules the SDK now follows

- `MAX_ACTION_FEE` = 10 000 000 lamports (0.01 SOL). The program refuses a larger `fee` on every
  execution path (`FeeTooHigh`, 6040); `relayFee` never asks for more than the cap.
- No fee during a lockdown: a `Ping` or cancel approved by the signers alone must carry `fee = 0`
  (`FeeInLockdown`, 6041). `freeLockdownAction` lets relayers send those for free.
- A `Migrate` is restricted like a withdrawal destination: it waits `slow_delay` (or is refused)
  unless the new vault is whitelisted or the vault has no rules.
- Session budgets spend only to non-restricted destinations, and cannot be created when every
  destination is restricted (`BudgetDestRestricted`, 6043); see `hasUnrestricted`.
- `Cancel` also clears a started migration (`migrate_to`).
- `init_vault` refuses the same root in two slots: signers, recovery and duress (`DuplicateRoot`, 6042).
- Delays, schedule intervals and budget periods are at most 10 years, `MAX_DURATION_SECS`
  (`DurationTooLong`, 6044).
- `preflightAction` reports all of the above before anything is signed; `explainError` and
  `PROGRAM_ERROR_TEXT` turn the new errors into sentences.

### Package

- Published as an npm package with ESM, CommonJS and type declarations; one entry point
  (`@noxvault/sdk`) plus `@noxvault/sdk/idl.json`.
- Ships the program id (`PROGRAM_ID`), the IDL (`idl`) and its type (`Noxvault`).
- New integration helpers: `readProgram`, `fundVaultIx`, `fundVaultTokenIxs`, `buildFundTokenIxs`,
  `vaultTokenAccount`, `fundLinks`, `NOXVAULT_SITE`.
- `@solana/web3.js`, `@coral-xyz/anchor` and `@solana/spl-token` are peer dependencies.
- Works under Node's native ESM loader (anchor's `BN` is read from the CommonJS build when needed).
