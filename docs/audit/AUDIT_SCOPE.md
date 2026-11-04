# Noxvault v4: audit scope

Read together with `THREAT_MODEL.md`, `INVARIANTS.md`, `docs/SPEC.md` (v4, the single
source of truth) and `docs/WHITEPAPER.md`.

## 1. In scope

| File | Lines | What |
|---|---:|---|
| `programs/noxvault/src/lib.rs` | 1 888 | 45 instructions, account structs, rules (`authorize`, `gate`, `budget_spend`, `split`, …), errors |
| `programs/noxvault/src/state.rs` | 367 | Accounts (`VaultState`, `Approval`, `Unlock` zero-copy, `Schedule`, `Budget`, `Link`, `Protocol`, `Canary`, `LetterKey`, `Letter`), `Config`, `Action`, constants |
| `programs/noxvault/src/wots.rs` | 78 | WOTS+ digits/checksum, chains, leaf and node hashes, domains |
| **Program total** | **2 333** | |

Secondary scope (the program relies on these encodings; review them for parity with the
program):

| File | Lines | What |
|---|---:|---|
| `sdk/wots.ts` | 308 | Key derivation, signing, borsh encodings of `Action` and `Config` |
| `sdk/client.ts` | 1 606 | PDAs, instruction builders, `planAction`, `findSignedMessages` / `pickLeaf` (the one-message-per-leaf client rule, SPEC §9), preflight |
| `sdk/relayer.ts` | 169 | Relayer checks (fee policy, signature re-verification) |

Tests (not in scope, but useful):

| File | Lines | What |
|---|---:|---|
| `tests/noxvault.ts` | 855 | 38 end-to-end tests against a local validator |
| `tests/properties.chain.ts` | 416 | 11 on-chain property tests: differential/fuzz properties + gap proofs (GAP-xx) |
| `tests/properties.sdk.ts` | 466 | 28 pure property tests on WOTS+ and the rules model |
| `tests/model.ts` | 164 | TypeScript model of the program's pure rules, line-referenced to `lib.rs` |
| `programs/noxvault/tests/props.rs` | 314 | 13 Rust host property tests, incl. Rust ↔ TS parity vectors |

Build:

- Anchor 0.31.1, Solana CLI 2.1.0 (Agave), platform-tools v1.43 (rustc 1.79.0).
- `overflow-checks = true`, `opt-level = "s"`, `lto = "fat"`.
- Dependencies: `anchor-lang` 0.31.1 (`init-if-needed`), `anchor-spl` 0.31.1, `bytemuck`.
- `target/deploy/noxvault.so` at the time of writing: 816 272 bytes, sha256
  `4988233e691a678aef34e6d626c2f109d2808d61cbd97eaa0fce588657262bb5` (local, non-verifiable
  build). Use `anchor build --verifiable` for the audited artifact.
- Program id `8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4` (devnet).

## 2. Build and test

```bash
pnpm install                      # root (program tests, SDK)
anchor build
anchor test                       # local validator: all 38 e2e + 11 on-chain property + 28 pure property tests (~6 min)
pnpm test:props                   # pure property tests only, no validator (~3 s)
pnpm test:rust                    # Rust host property tests (cargo test -p noxvault --test props)
FC_CHAIN_RUNS=20 anchor test      # more fast-check runs for the on-chain properties (slower)
FC_SEED=<seed> pnpm test:props    # replay a failing fast-check run
NOX_PROP_SEED=<u64> NOX_PROP_RUNS=<n> pnpm test:rust   # other seed / more runs for the Rust properties
cd web && pnpm install && pnpm build   # the site (has its own lockfile)
```

Notes:

- `anchor test` runs `tests/**/*.ts` in one mocha process, in file order. `properties.chain.ts`
  reuses the protocol account that `noxvault.ts` creates, and creates one if it runs alone.
- The stake test waits two 64-slot epochs (`Anchor.toml`: `slots_per_epoch = "64"`).
- Several e2e tests use second-scale delays (`recoveryDelaySecs: 8`, `sleep(4500)`, …). On a
  heavily loaded machine one of them can miss its window (see §4, K-9).
- The default validator port is 8899. To run beside another validator, set `[test.validator]`
  `rpc_port` in `Anchor.toml` locally.

### How the property tests work

- **Pure (fast-check 4.10.2, pinned).** WOTS+ on height-2 trees (the maths is the same as at
  height 8). Encodings and domains. The rules model (`tests/model.ts`): random configs and
  random sequences of withdrawals, duress payouts, budgets, splits.
- **On chain (fast-check, small run counts).** The same generators drive the real program:
  - P-21: random actions and targets against a burned leaf.
  - P-22: cross-vault and cross-slot signature replay.
  - P-23: random whitelist / instant-limit / delay configs and withdrawal sequences, compared
    step by step with the model, including `window_spent`.
  - P-24: random duress limits, balances, amounts and fees, compared with the model to the lamport.
  - P-25: random letter write/overwrite/close/stranger sequences. After each step the vault's
    lamports and its whole `VaultState` account data are unchanged.
- **Gap proofs.** `GAP-01`, `GAP-01b`, `GAP-02`, `GAP-03` (and `P-11b`, `P-19b`) pin the current,
  unwanted behaviour, so each finding comes with an executable reproduction. Invert them when
  the program is fixed.
- **Rust (no extra crates).** A fixed-seed xorshift generator drives properties of the real
  `wots.rs` and `state.rs` code on the host (checksum, chain composition, Merkle paths, digest
  binding, `Config::restricted`, `tree_of`, the leaf bitmap, lockdown allow-list, `Letter::space`).
  R-01 pins Rust to the TypeScript SDK with vectors produced by `sdk/wots.ts`.

### Trident (Rust fuzzing for Anchor)

Not added. Reasons:

- **No fuzzing engine is installed.** Trident drives honggfuzz or AFL (`cargo hfuzz` /
  `cargo afl`), and neither is on this machine. Installing them is a system change outside
  this repo's scope.
- **The current releases (0.12, 0.13-rc) pull in the split `solana-*-interface` crates.** In
  this workspace they would resolve into the same `Cargo.lock` that `cargo-build-sbf`
  (platform-tools rustc 1.79) reads. The program already avoids the newer stake interface crate
  because it needs a newer Rust (`lib.rs:4`). Moving the shared lockfile risks the program
  build, so it was not attempted.
- **What covers the same ground instead:**
  - fast-check properties that run against the real program on the local validator
    (stateful sequences, differential against a model);
  - Rust host properties over the pure code.
- **Recommended for the audit:** a Trident harness in a separate workspace with its own
  lockfile (e.g. `trident-tests/`, not a member of the root workspace). Fuzz targets, in order:
  `approve` (signature buffers), the execute paths with random approval bitmaps, `gate` /
  `budget_spend` sequences, and `write_letter` / `append_letter`.

## 3. Known issues and limits

Findings from this review are in `INVARIANTS.md` §9. In brief:

| ID | Severity | Summary |
|---|---|---|
| G-01 | High | `fee` is paid outside every rule (whitelist, instant limit, delay, lockdown, duress cap) |
| G-02 | High | `Migrate` ignores `instant_limit` restriction on vaults without a whitelist |
| G-03 | High | Session budgets ignore `instant_limit` restriction on vaults without a whitelist |
| G-04 | Medium | `Cancel` never clears `migrate_to`; a started migration cannot be stopped |
| G-06 | Medium | A duress-phrase holder can chain lockdowns and keep the vault "active" (spec-intended, abusable) |
| G-05 | Low | Duplicate roots across signer/recovery slots accepted (one-time key reuse across slots) |
| G-07 | Low | Instant limit and budgets use fixed windows (up to 2× per 24 h around a reset) |
| G-08 | Low | Unbounded i64 delays/intervals/periods can make instructions abort on overflow |
| G-09 | Info | Approvals never expire for execution |
| G-10 | Info | One message per leaf is a client rule until the leaf is approved |
| G-11 | Info | Tier checks are point-in-time balances; `PROTOCOL_ADMIN` hard-coded; single upgrade key |

Limits by design (documented in SPEC / `/risks`):

| ID | Limit |
|---|---|
| K-1 | Upgradeable program; the upgrade authority is the root of trust until `UPGRADE.md` is done |
| K-2 | Session keys, letter keys, Escape Hatch wallets and the protocol admin are ed25519 (not quantum-safe) |
| K-3 | The Escape Hatch is a race against an attacker who has broken a wallet key; the canary is an alarm, not a guarantee |
| K-4 | After `recovery_delay` of inactivity the recovery holder controls everything, unrestricted, also during a lockdown |
| K-5 | Running schedules, the testament, inbox sweeps and a started migration continue during a lockdown |
| K-6 | A lockdown is visible on chain; duress mode caps the loss, it does not hide it. SOL only |
| K-7 | Sealed letters open at their drand round even if the owner is alive but did not refresh |
| K-8 | Token-2022 extensions (transfer fees, hooks) are not specially handled; a fee-on-transfer mint pays heirs/destinations less than `amount` |
| K-9 | Some e2e tests depend on second-scale timing and can be flaky on a loaded machine |

## 4. Prior internal reviews

| Date | What | Outcome |
|---|---|---|
| 2026-10-09 | Security review of the signing flow (commit `9321733`) | **Critical, client side, fixed.** The web flow could publish a second signature for the same one-time key: time-out + discard, another payer, another device, or a cancelled buffer. Fix: `write_sigs` names the vault; `findSignedMessages` reads the vault's full history; preflight refuses any other message and refuses to sign when history cannot be read. Tested by `tests/noxvault.ts` "remembers a signed message for good…" |
| 2026-11 | Pre-audit review (this folder) | Threat model, invariants with enforcement and coverage, property tests (TS + Rust), gap proofs, upgrade-authority plan. Findings G-01..G-11; **program unchanged**. |

No external audit has taken place.

## 5. Questions for the auditors

1. Is the fee design (G-01) acceptable with a cap, or should fees be removed from approvals
   whose rules restrict the destination?
2. Lockdown semantics (G-06): should a running lockdown be extendable at all?
3. Any path that moves value from the vault on a signer approval without passing `gate` or an
   equivalent check, beyond the ones listed in S-5?
4. `Unlock` is zero-copy with `_pad`: is the layout sound across Rust versions
   (`#[account(zero_copy)]`, `bytemuck`)?
5. `write_letter`'s manual allocate / assign / realloc / lamport moves (lib.rs:468-515).
6. Token-2022: any extension that breaks `transfer_checked` assumptions (amount received,
   delegate semantics in `escape_token`)?
