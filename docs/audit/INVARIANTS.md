# Noxvault v4.2: invariants

Every property the program must keep, where it is enforced, and which test covers it.

- File references: `lib.rs`, `state.rs`, `wots.rs` are in `programs/noxvault/src/`.
- v4.1 fixed G-01..G-05 and G-08 (§9). Rows touched by those fixes cite v4.1 line numbers; the
  other rows still cite the v4 lines of the audit commit (`6e0213b`), which v4.1 shifted by up to
  ~30 lines (no logic there changed).
- v4.2 adds the recovery tree's `CancelLock` (anti-theft freeze, §10). Rows A-11..A-13 and D-7
  and every row marked "v4.2" cite v4.2 line numbers. v4.2 moved the rules of `authorize` into
  `state::approval_mode` (state.rs:231), so older `authorize` line references now point there.
- Test references:
  - `T:<line>` is a test in `tests/noxvault.ts`, by the line of its `it(`.
  - `P-xx` is in `tests/properties.sdk.ts` (pure, fast-check).
  - `P-21`..`P-25` and `FIX-xx` (formerly `GAP-xx`) are in `tests/properties.chain.ts` (fast-check against the local validator).
  - `R-xx` is in `programs/noxvault/tests/props.rs` (Rust, host).
- Status:
  - **OK**: enforced and tested.
  - **FIXED (v4.1)**: was a GAP; now enforced and tested.
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
| C-4 | The duress tree is always set (height 1..8) and its root differs from every other slot | lib.rs:39, 42 (`roots_distinct` state.rs:138) | T:596, P-22 (duress = signer root → `DuplicateRoot`), R-11 | OK |
| C-5 | `duress_lock ≥ 1 day`; `slow_delay`, `testament_delay`, `recovery_delay ≥ 0` | lib.rs:43-44 | T:596 | Partial |
| C-6 | Heirs: bps sum to 10 000 when any heir is set; a testament needs heirs | lib.rs:43-46 | none | Untested |
| C-7 | Signer, recovery and duress roots are pairwise distinct | `init_vault` lib.rs:42; `Config::roots_distinct` state.rs:138-141 | P-22 (three duplicate configs → `DuplicateRoot`), P-28, R-11 | **FIXED (v4.1)**: G-05 |
| C-8 | Time parameters cannot make an instruction abort on overflow | config ≤ `MAX_DURATION` lib.rs:46 (state.rs:51, 143-145); schedule `interval` lib.rs:115, 408; budget `period` lib.rs:115, 442 (state.rs:184-190); saturating time arithmetic lib.rs:214, 383, 414, 772, 962, 973, 990, 1001 | FIX-08, R-12 | **FIXED (v4.1)**: G-08 |
| C-9 | Tier rules at creation: >1 signer needs Sentinel, a testament needs Guardian, Free pays `create_fee` to `treasury` | lib.rs:52-71, `tier_of` lib.rs:856 | T:213, T:333, T:489 | OK |

## 3. Authorization

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| A-1 | Only signer approvals count toward the threshold | `authorize` lib.rs:895 (`SIGNER_BITS`) | T:333, T:674, P-16 | OK |
| A-2 | The recovery tree alone executes only cancels while the owner is active; everything (unrestricted) after `recovery_delay` | lib.rs:900-905 | T:381, T:398, P-16 | OK |
| A-3 | The duress tree alone authorizes only a SOL withdrawal; it never adds to signer or recovery power | lib.rs:907-911; `authorize_full` lib.rs:917-921 | T:640, T:674, P-16 | OK |
| A-4 | During a lockdown signer approvals without the recovery tree execute only Ping and cancels, with fee 0 (v4.2: with the recovery tree they are not limited by the lockdown, A-12) | `approval_mode` state.rs:231 (lockdown branch); `open_unlock` lib.rs:117-119; state.rs allowed_in_lockdown | T:620, T:632, T:925, P-17, P-26, R-09, R-14, R-16, FIX-01 | OK (fee part: v4.1) |
| A-10 | No action pays a fee above `MAX_ACTION_FEE` (0.01 SOL), on any path, duress included | `authorize` lib.rs:915; `pay_fee` lib.rs:1064; `open_unlock` lib.rs:114; state.rs:48 | FIX-01, FIX-01b, P-24, P-26, R-13 | OK (v4.1) |
| A-5 | Only a signer-threshold approval sets the letter key | `execute_letter_key` lib.rs:447-449 | T:792 | OK |
| A-6 | Executing an approval closes it (no double execution) | `close = creator` on every `Execute*` account struct (lib.rs:1215, 1237, 1264, 1297, 1324, 1349, 1375, 1400) | T:333 (`fetchApproval` → null) | OK |
| A-7 | Each execute instruction executes only its own kinds | `let Kind::… else WrongAction` in each handler | T:640 (indirect) | Partial |
| A-8 | Signer and duress approvals update `last_active`, except during a lockdown (v4.2, A-13); recovery approvals never do | `approve` lib.rs:205-211 | T:603, T:718, T:958, T:989 | OK |
| A-11 | `CancelLock` executes only with the recovery tree's approval (any time: lockdown, inactivity or not), only for `secs` in [1 day, 90 days]; it clears `pending` and `migrate_to` and sets `lockdown_until = max(lockdown_until, now + secs)` | `approval_mode` state.rs:231 (`needs_recovery`, `lock_bounded` state.rs:193-202); `open_unlock` lib.rs:116 (bounds before a key burns); `execute_admin` lib.rs:374-380; `extend_lockdown` state.rs:322 | T:904, T:940, T:980, T:1039, P-29, R-09, R-14, R-15, R-17 | OK (v4.2) |
| A-12 | During a lockdown an approval with the signer threshold **and** the recovery tree is not limited by the lockdown (normal rules apply); a `Migrate` it approves starts at once, whitelist or not (the escape); a signer-only `Cancel` during a lockdown cannot clear that started migration | `approval_mode` state.rs:231; `execute_admin` lib.rs:366 (Cancel), lib.rs:400 (escape) | T:1004, P-31, P-32, R-14, R-16 | OK (v4.2) |
| A-13 | A thief holding only signer phrases cannot keep the vault "active" through a freeze: approvals during a lockdown never move `last_active`, so recovery-after-inactivity opens `recovery_delay` after the last activity before the freeze | `approve` lib.rs:209 | T:958, T:968, P-30 | OK (v4.2) |
| A-9 | An unexecuted approval can be discarded by anyone after 7 days, rent to its creator | lib.rs:202-206, 1196 | none | Untested; G-09 |

## 4. Spending rules (SPEC §3, §4)

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| S-1 | Unrestricted destinations (whitelisted, or no rules) pay at once | `gate` lib.rs:930; `Config::restricted` state.rs:114 | T:374, P-10, P-23, R-06 | OK |
| S-2 | Restricted SOL paid at once stays within `instant_limit` per window | lib.rs:934-943 | T:374, P-11, P-23 | OK (fixed window: G-07) |
| S-3 | Restricted withdrawals over the limit wait `slow_delay` as the single pending one; refused when `slow_delay = 0` | lib.rs:944-948 | T:381, T:391, T:421, P-12, P-13, P-23 | OK |
| S-4 | Restricted tokens never pay at once | lib.rs:934 (SOL only) | P-11 | Partial (no on-chain token case) |
| S-5 | Every way value leaves the vault on a signer approval obeys S-1..S-3 — fees excepted, which are capped instead | withdrawals: `gate` lib.rs:956; schedules: lib.rs:412-415; migrate: lib.rs:379 (`Config::restricted`); budgets: lib.rs:445, 999; fees: ≤ `MAX_ACTION_FEE` lib.rs:915, none during a lockdown lib.rs:923 | FIX-01, FIX-01b, FIX-02, FIX-03, P-19, P-19b, P-26, P-27 | **FIXED (v4.1)**: G-01, G-02, G-03 (fees: bounded residual, SPEC §4 "The fee") |
| S-6 | A pending withdrawal pays only when due, not during a lockdown, and only to its destination | lib.rs:536-562, 952-957 | T:381, T:391, T:620 | OK |
| S-7 | Any `Cancel` (signers, or recovery at any time) stops everything still waiting: the pending withdrawal or migration and a started migration. v4.2: during a lockdown only a recovery `Cancel` (or `CancelLock`) clears a started migration | lib.rs:362-371 clears `pending` and `migrate_to`; `migrate_sol`/`migrate_token` then refuse (`WrongDest`) | FIX-02, FIX-04, P-27, P-31, T:1004 | **FIXED (v4.1)**: G-04 |
| S-8 | A schedule pays `amount` every `interval`, `count` times, never early; first restricted payment ≥ `slow_delay` | lib.rs:384-414, 959-965 | T:431 | Partial (no restricted-schedule test) |
| S-9 | A budget spends ≤ `limit` per period, before `expires`, only to non-restricted destinations, never during a lockdown | `budget_spend` lib.rs:994-1008 (restricted: 999); creation refused when every destination is restricted lib.rs:445 | T:452, P-19, P-19b, FIX-03, R-13 | **FIXED (v4.1)**: G-03; fixed window G-07 (known limitation, SPEC §13) |
| S-10 | After any payout the vault holds 0 or ≥ rent minimum lamports | `check_rent` lib.rs:1004, called on SOL-moving paths | T:316 (preflight), P-14 | Partial (`migrate_sol`, `testament_sol` empty the vault, so 0) |
| S-11 | Destination of a withdrawal / schedule / budget / migration is never the vault itself | lib.rs:102, 106, 394, 973 | none | Untested |

## 5. Duress mode (SPEC §11)

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| D-1 | A duress withdrawal pays at most `min(amount, duress_limit, lamports − rent)`, fee included | lib.rs:224-237 | T:603, P-14, P-24 | OK |
| D-2 | During a running lockdown a duress withdrawal pays nothing, and extends the lockdown | lib.rs:230, 238 | T:632, P-14, P-15, P-24 | OK |
| D-3 | After a duress withdrawal `lockdown_until ≥ now + duress_lock` and never decreases (except a recovery Cancel) | lib.rs:252 (`extend_lockdown` state.rs:322), 368-370 | T:603, T:662, P-14, R-17 | OK |
| D-4 | Total value out of the vault during one lockdown ≤ `duress_limit` (unless the recovery holder co-signs a fee) | duress branch lib.rs:234-251; signer fees refused in lockdown lib.rs:923, 117 | P-15, P-15b, FIX-01 | **FIXED (v4.1)**: G-01 |
| D-5 | A recovery-tree Cancel ends the lockdown (a duress lockdown or a `CancelLock` freeze); nothing else does before it expires | lib.rs:368-370 | T:662, T:727, T:989 | OK |
| D-7 | A `CancelLock` during a running lockdown (duress or freeze) only ever extends it | `extend_lockdown` state.rs:322 | T:717, T:980, P-29, R-17 | OK (v4.2) |
| D-6 | The duress phrase cannot keep the vault locked or "active" indefinitely | **partly**: each duress execution still extends the lockdown (lib.rs:252); since v4.2 a duress approval made during a lockdown no longer resets `last_active` (lib.rs:209), so chained lockdowns no longer postpone recovery-after-inactivity or the testament | P-30 (same rule for signer approvals) | Known limitation G-06 (SPEC §13), narrowed in v4.2 |

## 6. Testament, recovery, migration

| ID | Invariant | Enforced | Tests | Status |
|---|---|---|---|---|
| T-1 | The testament opens only when active and the owner has been inactive `testament_delay` | `testament_open` lib.rs:983-988 | T:489 | OK |
| T-2 | Heirs get exactly `bps/10000` of the total (rounded down), the last heir the remainder; sum = total | `split` lib.rs:995-1002 | T:489, P-18 | OK |
| T-3 | Heirs are paid only to their configured addresses / token accounts they own | lib.rs:649, 666-668 | T:489 | OK |
| T-4 | Migration moves funds only to `migrate_to`, which only an authorized, rule-abiding `Migrate` sets (v4.2: or the escape, A-12) and a `Cancel` clears (v4.2: during a lockdown only a recovery Cancel) | lib.rs:396-412, 362-371; `migrate_sol`/`migrate_token` check `migrate_to` | T:837, T:1004, FIX-02, FIX-04 | OK (v4.1: G-02, G-04 fixed) |
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
| G-01 | **High** — **FIXED v4.1** | **The action fee bypasses every rule.** `pay_fee` pays any `fee` to any `fee_payee` named in the action, with no cap, no whitelist, no instant limit, no delay. It runs on every execute path, including Ping and Cancel, which are allowed during a lockdown. A signer phrase therefore drains all SOL at once from a whitelist or delay vault (Ping with `fee = balance`). A coercer drains a locked vault after the duress payout, so D-4 ("the design caps the loss") does not hold. | v4 lib.rs:1027-1040 | GAP-01, GAP-01b → FIX-01, FIX-01b |
| G-02 | **High** — **FIXED v4.1** | **Migrate ignores `instant_limit`.** It is restricted only when the whitelist is active (`whitelist_active() && !whitelisted`). `Config::restricted` (§3) also treats every destination as restricted when the whitelist is empty and `instant_limit > 0`. SPEC §4 says "Restricted unless new_vault is whitelisted". On such a vault a stolen signer phrase migrates to its own vault at once, then `migrate_sol`/`migrate_token` (permissionless) move everything. | v4 lib.rs:364 | GAP-02 → FIX-02 |
| G-03 | **High** — **FIXED v4.1** | **Session budgets ignore `instant_limit`.** `budget_spend` checks only the whitelist. SPEC §4 says budgets spend "only to non-restricted destinations". With an empty whitelist and `instant_limit > 0`, a stolen signer phrase creates a budget for its own session key (`limit` = everything) and spends it at once. Budget creation has no delay either. | v4 lib.rs:972, 416-441 | GAP-03 → FIX-03, P-19b |
| G-04 | Medium — **FIXED v4.1** | **A started migration cannot be cancelled.** `Cancel`, even from the recovery tree, clears `pending` but never `migrate_to`. `migrate_sol`/`migrate_token` run regardless of lockdown or cancel. Combined with G-02, the recovery holder cannot stop the drain. Even on whitelist vaults, a mistaken migration to a whitelisted vault is final. | v4 lib.rs:343-349 | FIX-04 |
| G-06 | Medium — known limitation (SPEC §13) | **Duress phrase can keep the vault locked and "active" for months.** Every executed duress withdrawal extends the lockdown (even when it pays 0), and every duress approval resets `last_active`. A holder of the duress phrase can therefore chain lockdowns: up to 2^height leaves × `duress_lock` (≥ 256 days at height 8). That blocks the owner's withdrawals, and it postpones recovery-after-inactivity and the testament. A recovery Cancel ends one lockdown, but the next duress execution starts another. Spec-intended ("still extends the lockdown"; "duress approvals count as activity") but abusable. | lib.rs:195-197, 238 | — (design; P-15 shows the payout cap still holds) |
| G-05 | Low — **FIXED v4.1** | **Duplicate roots across slots are accepted.** `init_vault` checks the duress root against the other slots but not signer/recovery roots against each other. One phrase in two signer slots meets a 2-of-2 alone. The same WOTS+ leaf can then sign two different digests (slot 0 and slot 1 burn separately), which breaks one-time use. Self-inflicted; the SDK never builds such configs. | v4 lib.rs:30-40 | P-22 (now `DuplicateRoot`), P-28, R-11 |
| G-07 | Low — known limitation (SPEC §13) | **Fixed windows, not sliding.** The instant limit and budgets reset at `window_start + DAY` / `+ period`, so up to 2× the limit can leave within any 24 h around a reset. SPEC says "per 24 h". | lib.rs:935, 974 | P-11b |
| G-08 | Low — **FIXED v4.1** | **Unbounded i64 arithmetic aborts.** `now + slow_delay` (lib.rs:369, 399, 946), `s.next_at += s.interval` (963) and `b.window_start + b.period` (974) overflow and panic (`overflow-checks = true`) for huge values the config or the signed action allows. The vault rules then block restricted withdrawals or a schedule/budget for good. No funds move. Self-inflicted, but `init_vault` should bound delays. | v4 lib.rs:42, 946, 963, 974 | FIX-08, R-12 |
| G-09 | Info | **Approvals never expire for execution.** A partial approval (e.g. 1 of 2) stays executable until someone discards it (allowed after 7 days). An old, forgotten approval can be completed much later. | lib.rs:201-206, `authorize` 892 | — |
| G-10 | Info | **Signature bytes published before approval leave the leaf usable.** `write_sigs` + `cancel_unlock` publish a signature without burning the leaf. A second message on the same leaf then enables forgery. Prevention is the client rule (`findSignedMessages`, SPEC §9). | lib.rs:128-138, 208 | T:291 (client side) |
| G-11 | Info | Tier checks read a balance at one moment (borrowable). `PROTOCOL_ADMIN` is a hard-coded devnet key. The upgrade authority is one key today. | lib.rs:856-875; state.rs:22 | see `UPGRADE.md` |

### Fixes applied in v4.1

Constants: `MAX_ACTION_FEE = 10_000_000` lamports (state.rs:48), `MAX_DURATION = 10 years`
(state.rs:51). New errors, appended to `NoxError`: `FeeTooHigh` 6040, `FeeInLockdown` 6041,
`DuplicateRoot` 6042, `BudgetDestRestricted` 6043, `DurationTooLong` 6044. No account layout or
size changed.

- **G-01** — `authorize` refuses `fee > MAX_ACTION_FEE` for every execute path, the duress path
  included (lib.rs:915), and during a lockdown refuses any fee on a signer-threshold approval that
  the recovery tree did not also sign (lib.rs:920-924). `pay_fee` repeats the cap
  (lib.rs:1064). `open_unlock` refuses both before a key is burned (lib.rs:114, 116-118). The fee
  does not count toward the instant window (SPEC §4 "The fee"): a stolen signer phrase can still
  move at most 0.01 SOL per one-time key through fees, never during a lockdown.
  Tests: FIX-01, FIX-01b, P-24 (duress fees within the cap), P-26, P-15b.
- **G-02** — `Migrate` uses `Config::restricted(&new_vault)` (lib.rs:379), so it queues for
  `slow_delay` (or is refused in strict mode) like a restricted withdrawal. Tests: FIX-02, P-27.
- **G-03** — `budget_spend` refuses `restricted(dest)` (lib.rs:999); `execute_create_budget`
  refuses a budget when every destination is restricted (`Config::has_unrestricted`,
  lib.rs:445, state.rs:131). `limit` needs no bound: a budget pays only destinations a signer
  could pay at once anyway. Tests: FIX-03, P-19, P-19b, R-13.
- **G-04** — `Cancel` clears `migrate_to` as well as `pending` (lib.rs:353-362). Defined in SPEC §4
  "Cancel". Tests: FIX-02, FIX-04, P-27.
- **G-05** — `init_vault` requires `Config::roots_distinct` across the five slots (lib.rs:42,
  state.rs:138-141). Tests: P-22, P-28, R-11.
- **G-08** — `init_vault` bounds all four delays to `MAX_DURATION` (lib.rs:46) and refuses a
  negative `recovery_delay` (lib.rs:44); schedule `interval` and budget `period` are bounded at
  `open_unlock` (lib.rs:115) and at creation (lib.rs:408, 442). Time additions saturate
  (lib.rs:214, 383, 414, 772, 962, 973, 990, 1001). Tests: FIX-08, R-12.
- **G-06, G-07** — unchanged by design; documented in SPEC §13 "Known limitations".
- **G-09..G-11** — unchanged (informational).

## 10. v4.2: the recovery tree's cancel and freeze (`CancelLock`)

**Weakness closed.** A thief holding the owner's signer phrase answers every recovery `Cancel` with
a new restricted payout. Each cancel burns one recovery key (a recovery tree has at most 2^8,
the apps make 16), so the thief wins the war of attrition; meanwhile his Pings keep `last_active`
fresh, so recovery-after-inactivity never opens.

**Rules** (SPEC §4 "CancelLock", §11):

- `Kind::CancelLock { secs }` (tag 12, appended: every earlier encoding is unchanged). Only an
  approval that includes the recovery tree executes it (`CancelLockNeedsRecovery`, 6045), at any
  time; `secs` ∈ [`MIN_CANCEL_LOCK` = 1 day, `MAX_CANCEL_LOCK` = 90 days] (`LockOutOfRange`,
  6046; `open_unlock` refuses it before a key burns). It clears `pending` and `migrate_to` and
  sets `lockdown_until = max(lockdown_until, now + secs)` (A-11, D-7). It may pay the capped fee:
  the recovery tree approved it (G-01 rule unchanged). Relayers send it free.
- A lockdown binds only approvals **without** the recovery tree (A-4, A-12). Signers + recovery
  together act under the normal rules; during a lockdown their `Migrate` starts at once (the
  escape), because a queued migration could not run before the lockdown ends and the frozen
  signer phrase could cancel it. During a lockdown a signer-only `Cancel` clears `pending` but
  not a started migration (S-7).
- Approvals made during a lockdown never move `last_active` (A-8, A-13).
- Plain `Cancel` is unchanged: from the recovery tree it still ends any lockdown (D-5).

**Trade-offs, kept on purpose.**

- *Signers + recovery during a lockdown migrate instantly.* That is new power for someone holding
  **both** phrases: the recovery phrase can always start a freeze, so whoever holds both can now
  move everything at once instead of waiting `slow_delay`. Accepted because both phrases together
  already decide the vault: the recovery phrase ends lockdowns at will and, since approvals in a
  lockdown no longer count as activity, can freeze the owner out and take over after
  `recovery_delay`. Keep the two phrases apart (the anti-theft preset says so).
- *Approvals during a lockdown are not activity* also applies to duress lockdowns. An owner whose
  duress lockdown outlasts `testament_delay` (or `recovery_delay`) past the last activity can no
  longer hold the testament (or the recovery takeover) off by pinging during that lockdown; the
  recovery holder's `Cancel` ends the lockdown, after which pings count again. It also narrows
  G-06: chained duress lockdowns no longer postpone recovery-after-inactivity or the testament.
- *Running schedules continue during a lockdown* (SPEC §11, unchanged). A schedule the thief
  created before the freeze still pays once due; its first restricted payment waits `slow_delay`.
  Answer: the recovery `CancelSchedule` (any time), or the owner's escape (an empty vault pays
  nothing). Not changed in v4.2: pausing schedules would change duress mode for every vault.
- *A freeze ends by itself* after `secs` (at most 90 days); the recovery holder renews it with
  another `CancelLock` (one key per renewal) or ends it with `Cancel`.
