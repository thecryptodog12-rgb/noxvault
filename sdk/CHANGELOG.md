# Changelog

The SDK version follows the program version (`0.4.1` = program v4.1, docs/SPEC.md).

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
