# Noxvault v4: invariants

Every property the program must keep, where it is enforced, and which test covers it.

- File references: `lib.rs`, `state.rs`, `wots.rs` are in `programs/noxvault/src/`.
- Test references:
  - `T:<line>` is a test in `tests/noxvault.ts`, by the line of its `it(`.
  - `P-xx` is in `tests/properties.sdk.ts` (pure, fast-check).
  - `P-21`..`P-25` and `GAP-xx` are in `tests/properties.chain.ts` (fast-check against the local validator).
  - `R-xx` is in `programs/noxvault/tests/props.rs` (Rust, host).
- Status:
  - **OK**: enforced and tested.
  - **Partial**: enforced, only partly tested.
  - **Untested**: enforced, no test.
  - **GAP**: not enforced as the spec or the purpose of the feature requires. See §9.

## 1. One-time signatures (WOTS+ and Merkle trees)

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| W-1 | A signature verifies only if it rebuilds the tree root of the claimed tree slot | `approve` lib.rs:171-175; `root_from_path` wots.rs:56 | T:191, T:274, P-01, P-04, R-04 | OK |
| W-2 | The two checksum digits stop forgery by raising message digits (any raise lowers a checksum digit) | `digits` wots.rs:23-30 | P-02, P-02b, P-05, R-02 | OK |
| W-3 | The digest binds program id, vault, tree slot, leaf and the exact action bytes | `message_digest` wots.rs:11-21, used at lib.rs:146 | P-07, P-08, R-05, P-22 (on chain: other vault, other slot → `BadSignature`) | OK |
| W-4 | A leaf, once approved, is burned and never opens or approves again | `open_unlock` lib.rs:98, `approve` lib.rs:176, 193; bitmap state.rs:200-205 | T:274, T:291, P-20, P-21, R-08 | OK |
| W-5 | One leaf signs one message only | on chain only from approval on (W-4); before that, client rule SPEC §9 | P-03 (cryptographic part), T:291 (client part) | Partial: G-10 |
| W-6 | Digits are fixed before any chain is verified, and the signature cannot change afterwards | `verify` freezes, lib.rs:143-149; `write_sigs` refuses when frozen lib.rs:130 | T:274 (`Frozen`) | OK |
| W-7 | Approval needs every chain written and verified | lib.rs:144, 170 | T:274 | Partial (no test for approve with missing chains) |
| W-8 | Tree index, leaf range and auth-path length are validated | `open_unlock` lib.rs:95-97; `tree_of` state.rs:92 | P-21, R-07 | OK |
| W-9 | Each hash has its own domain: tags `nox2/*`, `nox3/*`; untagged `F` has a unique input length | wots.rs, SPEC §2 | P-09, P-09b, R-01, R-05 | OK |
| W-10 | Rust and the TypeScript SDK compute the same digest, digits, chains, leaves, roots and hashes | wots.rs vs sdk/wots.ts | R-01 (fixed vectors); every on-chain test that executes | OK |
| W-11 | The action the program verifies is the action it executes (borsh bytes stored once) | `open_unlock` lib.rs:109-120; `approve` lib.rs:177-189; `Approval::action` state.rs:226 | T:291, P-09b, R-09 (`MAX_ACTION`) | OK |
| W-12 | Seed ranges of signer, recovery and duress trees never collide (client) | sdk/wots.ts `seedIndex` | P-06 | OK (client) |

## 2. Vault identity and configuration

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| C-1 | The vault address commits to the full config; rules never change | lib.rs:48-50 (`config_hash`, wots.rs:72) | T:213 | OK |
| C-2 | 1 ≤ threshold ≤ number of signer trees; unused slots have height 0 | lib.rs:31-35 | none | Untested |
| C-3 | Recovery tree implies `recovery_delay > 0` | lib.rs:36 | none | Untested |
| C-4 | The duress tree is always set (height 1..8) and its root differs from every other slot | lib.rs:39-40 | T:596 | Partial (no test for an equal root) |
| C-5 | `duress_lock ≥ 1 day`; `slow_delay`, `testament_delay ≥ 0` | lib.rs:41-42 | T:596 | Partial |
| C-6 | Heirs: bps sum to 10 000 when any heir is set; a testament needs heirs | lib.rs:43-46 | none | Untested |
| C-7 | Signer and recovery roots are pairwise distinct | **not enforced** | P-22 shows a duplicate root is accepted | GAP: G-05 |
| C-8 | Time parameters cannot make an instruction abort on overflow | **not enforced** (`slow_delay`, `interval`, `period` unbounded) | none | GAP: G-08 |
| C-9 | Tier rules at creation: >1 signer needs Sentinel, a testament needs Guardian, Free pays `create_fee` to `treasury` | lib.rs:52-71, `tier_of` lib.rs:856 | T:213, T:333, T:489 | OK |

## 3. Authorization

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| A-1 | Only signer approvals count toward the threshold | `authorize` lib.rs:895 (`SIGNER_BITS`) | T:333, T:674, P-16 | OK |
| A-2 | The recovery tree alone executes only cancels while the owner is active; everything (unrestricted) after `recovery_delay` | lib.rs:900-905 | T:381, T:398, P-16 | OK |
| A-3 | The duress tree alone authorizes only a SOL withdrawal; it never adds to signer or recovery power | lib.rs:907-911; `authorize_full` lib.rs:917-921 | T:640, T:674, P-16 | OK |
| A-4 | During a lockdown signer approvals execute only Ping and cancels | lib.rs:897; state.rs:154-160 | T:620, T:632, P-17, R-09 | OK |
| A-5 | Only a signer-threshold approval sets the letter key | `execute_letter_key` lib.rs:447-449 | T:792 | OK |
| A-6 | Executing an approval closes it (no double execution) | `close = creator` on every `Execute*` account struct (lib.rs:1215, 1237, 1264, 1297, 1324, 1349, 1375, 1400) | T:333 (`fetchApproval` → null) | OK |
| A-7 | Each execute instruction executes only its own kinds | `let Kind::… else WrongAction` in each handler | T:640 (indirect) | Partial |
| A-8 | Signer and duress approvals update `last_active`; recovery approvals do not | lib.rs:195-197 | T:603, T:718 | OK |
| A-9 | An unexecuted approval can be discarded by anyone after 7 days, rent to its creator | lib.rs:202-206, 1196 | none | Untested; G-09 |

## 4. Spending rules (SPEC §3, §4)

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| S-1 | Unrestricted destinations (whitelisted, or no rules) pay at once | `gate` lib.rs:930; `Config::restricted` state.rs:114 | T:374, P-10, P-23, R-06 | OK |
| S-2 | Restricted SOL paid at once stays within `instant_limit` per window | lib.rs:934-943 | T:374, P-11, P-23 | OK (fixed window: G-07) |
| S-3 | Restricted withdrawals over the limit wait `slow_delay` as the single pending one; refused when `slow_delay = 0` | lib.rs:944-948 | T:381, T:391, T:421, P-12, P-13, P-23 | OK |
| S-4 | Restricted tokens never pay at once | lib.rs:934 (SOL only) | P-11 | Partial (no on-chain token case) |
| S-5 | Every way value leaves the vault on a signer approval obeys S-1..S-3 | withdrawals: `gate`; schedules: lib.rs:397-400; migrate: lib.rs:364; budgets: none; **fees: none** | GAP-01, GAP-01b, GAP-02, GAP-03, P-19b | **GAP: G-01, G-02, G-03** |
| S-6 | A pending withdrawal pays only when due, not during a lockdown, and only to its destination | lib.rs:536-562, 952-957 | T:381, T:391, T:620 | OK |
| S-7 | Any `Cancel` (signers, or recovery at any time) stops everything still waiting: the pending withdrawal and a started migration | lib.rs:343-349 clears `pending` only | GAP-02 | **GAP: G-04** |
| S-8 | A schedule pays `amount` every `interval`, `count` times, never early; first restricted payment ≥ `slow_delay` | lib.rs:384-414, 959-965 | T:431 | Partial (no restricted-schedule test) |
| S-9 | A budget spends ≤ `limit` per period, before `expires`, only to non-restricted destinations, never during a lockdown | `budget_spend` lib.rs:967-981; lib.rs:595, 605 | T:452, P-19 | **GAP: G-03** (restricted part); fixed window G-07 |
| S-10 | After any payout the vault holds 0 or ≥ rent minimum lamports | `check_rent` lib.rs:1004, called on SOL-moving paths | T:316 (preflight), P-14 | Partial (`migrate_sol`, `testament_sol` empty the vault, so 0) |
| S-11 | Destination of a withdrawal / schedule / budget / migration is never the vault itself | lib.rs:102, 106, 394, 973 | none | Untested |

## 5. Duress mode (SPEC §11)

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| D-1 | A duress withdrawal pays at most `min(amount, duress_limit, lamports − rent)`, fee included | lib.rs:224-237 | T:603, P-14, P-24 | OK |
| D-2 | During a running lockdown a duress withdrawal pays nothing, and extends the lockdown | lib.rs:230, 238 | T:632, P-14, P-15, P-24 | OK |
| D-3 | After a duress withdrawal `lockdown_until ≥ now + duress_lock` and never decreases (except a recovery Cancel) | lib.rs:238, 346-348 | T:603, T:662, P-14 | OK |
| D-4 | Total value out of the vault during one lockdown ≤ `duress_limit` | duress branch only; **not for fees** of Ping/cancel approvals | P-15 (model), GAP-01 (counterexample on chain) | **GAP: G-01** |
| D-5 | A recovery-tree Cancel ends the lockdown; nothing else does before it expires | lib.rs:346-348 | T:662 | OK |
| D-6 | The duress phrase cannot keep the vault locked or "active" indefinitely | **not enforced**: each duress execution extends the lockdown (lib.rs:238) and each duress approval resets `last_active` (lib.rs:195) | none | GAP: G-06 (spec-intended, but abusable) |

## 6. Testament, recovery, migration

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| T-1 | The testament opens only when active and the owner has been inactive `testament_delay` | `testament_open` lib.rs:983-988 | T:489 | OK |
| T-2 | Heirs get exactly `bps/10000` of the total (rounded down), the last heir the remainder; sum = total | `split` lib.rs:995-1002 | T:489, P-18 | OK |
| T-3 | Heirs are paid only to their configured addresses / token accounts they own | lib.rs:649, 666-668 | T:489 | OK |
| T-4 | Migration moves funds only to `migrate_to`, which only an authorized `Migrate` sets | lib.rs:614, 622, 373, 541 | T:837, GAP-02 | OK (but see G-02, G-04) |
| T-5 | Recovery acts unrestricted only after the owner's inactivity, and that ignores a lockdown (spec) | lib.rs:900-905 | T:398 | OK |

## 7. Sealed letters and the letter key (SPEC §12)

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| L-1 | Letter instructions never move vault lamports | the vault account is never writable in `WriteLetter`/`AppendLetter`/`CloseLetter` (lib.rs:1419-1473) | T:736, P-25 | OK |
| L-2 | Letter instructions never change `VaultState` (incl. `last_active`) | `VaultState` is not an account of those instructions | T:736, P-25 (whole account data compared) | OK |
| L-3 | Only the current, non-default letter key writes, appends or closes | constraints lib.rs:1431, 1450, 1468 | T:781, P-25 | OK |
| L-4 | A letter is ≤ 8192 ciphertext bytes, label ≤ 64; chunks in order, never past the end | lib.rs:470-471, 520-521 | T:736 | OK |
| L-5 | The letter account size equals its serialization; rent is topped up or refunded to the key | `Letter::space` state.rs:337; lib.rs:476-506 | T:736, R-10 | OK |
| L-6 | A letter belongs to the vault it was created for | seeds + `has_one = vault`; overwrite checks `old.vault` lib.rs:500 | T:781 | OK |

## 8. Escape Hatch, canary, protocol

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| E-1 | Escaped tokens go only to the linked vault, only after panic or a tripped canary, only from the wallet's delegated accounts | lib.rs:781-804, 1733-1755 | T:533 | OK |
| E-2 | Escaped SOL goes only to the linked vault, signed by the wallet | lib.rs:808-821, 1761 | T:545 | OK |
| E-3 | A link points at a real vault; changing it takes 30 days and is impossible after the canary trips | lib.rs:743-766, 1710 | T:523 | Partial (tripped case untested) |
| E-4 | The canary trips only when its balance falls below the recorded baseline | lib.rs:841-849 | T:561 | OK |
| E-5 | Only the admin changes protocol parameters; frozen parameters never change | lib.rs:711-739, 1781 | none | Untested |
| E-6 | Protocol parameters never affect existing vaults' funds or rules | no vault instruction reads `create_fee`/`treasury`; tiers gate only creation of schedules/budgets | — | OK (by inspection) |

## 9. Gaps found (potential bugs), ranked

Severity assumes the attacker the feature is meant to stop. For the spending rules
that attacker is a **thief or coercer holding a signer phrase** (SPEC §3, §11; `/risks`: "limited
only by the whitelist, instant limit and delay, and by your recovery key").

| ID | Severity | Finding | Where | Proof |
|---|---|---|---|---|
| G-01 | **High** | **The action fee bypasses every rule.** `pay_fee` pays any `fee` to any `fee_payee` named in the action, with no cap, no whitelist, no instant limit, no delay. It runs on every execute path, including Ping and Cancel, which are allowed during a lockdown. A signer phrase therefore drains all SOL at once from a whitelist or delay vault (Ping with `fee = balance`). A coercer drains a locked vault after the duress payout, so D-4 ("the design caps the loss") does not hold. | lib.rs:1027-1040, called at 247, 266, 314, 331, 379, 411, 438, 458; lockdown allow-list state.rs:158 | GAP-01, GAP-01b |
| G-02 | **High** | **Migrate ignores `instant_limit`.** It is restricted only when the whitelist is active (`whitelist_active() && !whitelisted`). `Config::restricted` (§3) also treats every destination as restricted when the whitelist is empty and `instant_limit > 0`. SPEC §4 says "Restricted unless new_vault is whitelisted". On such a vault a stolen signer phrase migrates to its own vault at once, then `migrate_sol`/`migrate_token` (permissionless) move everything. | lib.rs:364 | GAP-02 |
| G-03 | **High** | **Session budgets ignore `instant_limit`.** `budget_spend` checks only the whitelist. SPEC §4 says budgets spend "only to non-restricted destinations". With an empty whitelist and `instant_limit > 0`, a stolen signer phrase creates a budget for its own session key (`limit` = everything) and spends it at once. Budget creation has no delay either. | lib.rs:972 (spend), 416-441 (create) | GAP-03, P-19b |
| G-04 | Medium | **A started migration cannot be cancelled.** `Cancel`, even from the recovery tree, clears `pending` but never `migrate_to`. `migrate_sol`/`migrate_token` run regardless of lockdown or cancel. Combined with G-02, the recovery holder cannot stop the drain. Even on whitelist vaults, a mistaken migration to a whitelisted vault is final. | lib.rs:343-349, 612-636 | GAP-02 |
| G-06 | Medium | **Duress phrase can keep the vault locked and "active" for months.** Every executed duress withdrawal extends the lockdown (even when it pays 0), and every duress approval resets `last_active`. A holder of the duress phrase can therefore chain lockdowns: up to 2^height leaves × `duress_lock` (≥ 256 days at height 8). That blocks the owner's withdrawals, and it postpones recovery-after-inactivity and the testament. A recovery Cancel ends one lockdown, but the next duress execution starts another. Spec-intended ("still extends the lockdown"; "duress approvals count as activity") but abusable. | lib.rs:195-197, 238 | — (design; P-15 shows the payout cap still holds) |
| G-05 | Low | **Duplicate roots across slots are accepted.** `init_vault` checks the duress root against the other slots but not signer/recovery roots against each other. One phrase in two signer slots meets a 2-of-2 alone. The same WOTS+ leaf can then sign two different digests (slot 0 and slot 1 burn separately), which breaks one-time use. Self-inflicted; the SDK never builds such configs. | lib.rs:30-40 | P-22 (init succeeds) |
| G-07 | Low | **Fixed windows, not sliding.** The instant limit and budgets reset at `window_start + DAY` / `+ period`, so up to 2× the limit can leave within any 24 h around a reset. SPEC says "per 24 h". | lib.rs:935, 974 | P-11b |
| G-08 | Low | **Unbounded i64 arithmetic aborts.** `now + slow_delay` (lib.rs:369, 399, 946), `s.next_at += s.interval` (963) and `b.window_start + b.period` (974) overflow and panic (`overflow-checks = true`) for huge values the config or the signed action allows. The vault rules then block restricted withdrawals or a schedule/budget for good. No funds move. Self-inflicted, but `init_vault` should bound delays. | lib.rs:42 (only `≥ 0`), 946, 963, 974 | — |
| G-09 | Info | **Approvals never expire for execution.** A partial approval (e.g. 1 of 2) stays executable until someone discards it (allowed after 7 days). An old, forgotten approval can be completed much later. | lib.rs:201-206, `authorize` 892 | — |
| G-10 | Info | **Signature bytes published before approval leave the leaf usable.** `write_sigs` + `cancel_unlock` publish a signature without burning the leaf. A second message on the same leaf then enables forgery. Prevention is the client rule (`findSignedMessages`, SPEC §9). | lib.rs:128-138, 208 | T:291 (client side) |
| G-11 | Info | Tier checks read a balance at one moment (borrowable). `PROTOCOL_ADMIN` is a hard-coded devnet key. The upgrade authority is one key today. | lib.rs:856-875; state.rs:22 | see `UPGRADE.md` |

Suggested fixes (for the team; not applied, the program is unchanged in this review):

- G-01: cap `fee` (e.g. a protocol-wide maximum, or ≤ the remaining instant allowance) and refuse
  fees above it on restricted paths. During a lockdown allow only `fee = 0`, or a fee counted
  against the duress allowance.
- G-02: use `Config::restricted(&new_vault)` in `execute_admin`.
- G-03: in `budget_spend`, refuse `restricted(dest)`. Alternatively, delay a budget's first spend
  by `slow_delay` the way schedules do.
- G-04: let `Cancel` clear `migrate_to`, and give a set `migrate_to` its own short delay.
- G-06: do not extend a running lockdown, or cap the extensions. Consider not resetting
  `last_active` from duress approvals (weigh this against indistinguishability).
- G-05: require distinct non-zero roots across all five slots.
- G-07: document it as a fixed window, or switch to a two-bucket sliding window.
- G-08: bound `slow_delay`, `recovery_delay`, `testament_delay`, `duress_lock`, schedule
  `interval` and budget `period` (e.g. ≤ 10 years), or use `saturating_add` everywhere.
