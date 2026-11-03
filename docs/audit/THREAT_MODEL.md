# Noxvault v4: threat model

Scope: the on-chain program `programs/noxvault` (Anchor 0.31.1, program id
`8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4`), as specified in `docs/SPEC.md` v4. The SDK
(`sdk/`), relayer, keeper bot and web app appear here only where the program relies on them.
Line references are to `programs/noxvault/src/lib.rs` unless another file is named.

Status: **not audited**. Devnet only. The program is upgradeable (see `UPGRADE.md`).

v4.1 fixed the gaps G-01..G-05 and G-08 (`INVARIANTS.md` §9, SPEC "Changes in v4.1"); G-06 and
G-07 are documented known limitations (SPEC §13). The risk notes below are from the v4 review:
those naming G-01..G-05 or G-08 are closed, and the line numbers are v4 lines.

## 1. Assets

| # | Asset | Where it lives | What protects it |
|---|---|---|---|
| A1 | SOL held by a vault | `vault = PDA(["vault", config_hash])`, system-owned | WOTS+ approvals + vault rules; program signs with the vault seeds |
| A2 | SPL / Token-2022 balances | ATAs owned by the vault PDA | same as A1 (`token_out`, lib.rs:1062) |
| A3 | Native stake | `PDA(["stake", vault, seed])`, staker and withdrawer = vault | same as A1; testament after inactivity |
| A4 | The vault's rules | `Config`, hashed into the vault address (`config_hash`, wots.rs:72) | immutable by construction: a different config is a different vault |
| A5 | One-time keys | Merkle roots in `Config.trees` / `Config.duress`; leaf bitmap `VaultState.used` | hash pre-images; the bitmap burns each leaf once |
| A6 | Pending state | `VaultState.pending`, `migrate_to`, `lockdown_until`, `window_*`, `last_active` | only reachable through authorized actions or time |
| A7 | Funds of an ordinary linked wallet | the wallet's SOL and delegated token accounts | Escape Hatch: wallet signature, `panic`, or a tripped canary |
| A8 | Sealed letters | `PDA(["letter", vault, id])`: tlock ciphertext + plaintext label | the letter key; confidentiality is drand/tlock's, not the program's |
| A9 | Protocol parameters and fees | `PDA(["protocol"])`, treasury | `admin` signer, `frozen` flag |
| A10 | The program itself | upgradeable loader, upgrade authority | today a single devnet key; plan in `UPGRADE.md` |
| A11 | Privacy of the duress setup | `Config.duress` is always filled | decoy roots indistinguishable from real ones (client-side) |

## 2. Actors

| Actor | Holds | Intended power | Must never be able to |
|---|---|---|---|
| Owner / signers (trees 0..2) | 24-word phrase(s), WOTS+ trees | any action once `threshold` signer trees approve, within the vault rules | exceed the rules (whitelist, instant limit, delay); act during a lockdown except Ping/cancels |
| Recovery holder (tree 3) | recovery phrase | cancel at any time; everything, unrestricted, after `recovery_delay` of owner inactivity; end a lockdown with `Cancel` | set the letter key; act unrestricted while the owner is active |
| Duress attacker (tree 4) | duress phrase (given under coercion) | one SOL withdrawal of at most `duress_limit` (fee included), then a lockdown | move tokens, stake, schedule, budget, migrate, set the letter key; count toward the threshold |
| Coercer with the real phrase during a lockdown | signer phrase | Ping and cancels only | move funds until the lockdown ends |
| Thief of a signer phrase (no coercion) | signer phrase | what the rules allow a restricted destination: within `instant_limit`, else wait `slow_delay` (recovery can cancel) | drain faster than the rules allow |
| Heirs | addresses in `Config.heirs` | receive all SOL / tokens / stake after `testament_delay` of inactivity | receive more than their `bps` share, or early |
| Session key | ed25519 key in a `Budget` | spend up to `limit` per `period` until `expires`, only to non-restricted destinations | spend past the budget or after expiry; anything else |
| Letter key | ed25519 key in `LetterKey` | write, overwrite, close the vault's letters | move vault funds, touch `VaultState`, keep the vault "active" |
| Relayer | ed25519 fee payer | send transactions, be repaid the signed `fee` | change anything that was signed |
| Keeper / anyone | nothing | run permissionless instructions (execute approved actions, pending, schedules, testament, sweeps, migrations, canary, escapes) | change destinations or amounts, run anything early |
| Linked wallet `w` | ed25519 key | register / change link (30 days), set panic, store the escape tx, delegate tokens | — |
| Quantum adversary | can forge ed25519 | forge any ed25519 signature: linked wallets, session keys, letter keys, the protocol admin, the upgrade authority | forge WOTS+ (SHA-256 pre-images); move vault funds through hash-signed paths |
| Protocol admin | `PROTOCOL_ADMIN` (state.rs:22), later a multisig | set $NOX mint, tier thresholds, create fee, treasury; freeze | touch any vault's funds or rules |
| Upgrade authority | today one devnet key | replace the program | — (this is the root of trust; see §5) |

## 3. Trust boundaries

1. **Hash-signed vs ed25519-signed.** Vault funds move only after `approve` has rebuilt a tree
   root from a WOTS+ signature (lib.rs:165-199) — except through ed25519 keys the vault itself
   authorized: session budgets (`spend_budget*`) and, for letters only, the letter key. A quantum
   adversary therefore gets at most the open budgets and the letters.
2. **Signed action vs execution.** Everything that moves funds is fixed in the signed `Action`
   bytes (`action_hash`, wots.rs:76) and checked against accounts at execution
   (`require_keys_eq!(dest, a.dest.key())`, etc.). Execution itself is permissionless.
3. **Program vs client.** Some properties are client rules the program cannot enforce
   (SPEC §9): a tree sits in one vault only; a leaf signs one message only *before* it is burned
   (a published but unapproved signature leaves the leaf usable on chain); preflight checks.
4. **Program vs clock.** Delays, lockdowns, inactivity, testament and budgets use
   `Clock::unix_timestamp` (validator-voted, can drift by seconds to minutes).
5. **Program vs other programs.** System, SPL Token / Token-2022 (`token_interface`), Associated
   Token, Stake programs via CPI; the program trusts their semantics.
6. **Program vs upgrade authority.** The upgrade authority can replace every rule above.

## 4. Attack surface per instruction

S = needs a WOTS+ approval, E = needs an ed25519 signer, P = permissionless.
"Main checks" lists what stands between the caller and the asset; "Risks" lists what an auditor
should look at first (G-xx are the gaps in `INVARIANTS.md`).

### One-time signatures

| Instruction | Who | Main checks | Risks |
|---|---|---|---|
| `init_vault` (29) | P (payer signs) | config sanity (31-46), address = PDA(config_hash) (48-50), tiers (55-71) | duplicate roots across slots accepted (G-05); unbounded i64 delays (G-08); front-running is harmless (same address, same state) |
| `open_unlock` (86) | E (payer) | tree in range, auth path length, leaf < 2^height, leaf unused, withdraw/stake/migrate sanity, action ≤ 160 bytes (95-110) | one buffer per (vault, payer) |
| `write_sigs` (128) | E (buffer payer) | not frozen, chain range (130-132) | publishes signature bytes in the vault's history (intended, SPEC §9) |
| `verify` (141) | P | digits fixed at first call; all chains written (143-149); range (150) | compute: ≤ 6 500 hashes per tx |
| `approve` (165) | P (payer) | rent receiver = buffer payer, vault match, all chains verified, root rebuild, leaf unused, action hash (168-178) | approval PDA keyed by (vault, action_hash): identical actions share an approval; burns the leaf; sets `last_active` for non-recovery trees (195) |
| `discard_approval` (202) | P | 7 days after creation; rent to creator | approvals do not expire for execution (G-09) |
| `cancel_unlock` (208) | E (buffer payer) | has_one payer | leaves the leaf unburned although signature bytes are public (G-10) |

### Executing approved actions (all P; the approval is closed on success)

| Instruction | Kinds | Main checks | Risks |
|---|---|---|---|
| `execute_withdraw` (214) | Withdraw SOL | `authorize` (892), dest match; duress branch caps payout (224-241); else `gate` (929), funds, `pay_fee`, `check_rent` | **fee is ungated** (G-01) |
| `execute_withdraw_token` (252) | Withdraw token | `authorize_full`, mint/dest match, `gate`, funds | fee ungated (G-01) |
| `execute_stake` (271) | Stake | vote and stake PDA match, funds | not gated (stake stays vault-owned) |
| `execute_stake_authority` (320) | Unstake, CollectStake | stake PDA match in `stake_authority` (1103) | — |
| `execute_admin` (337) | Cancel, Ping, CancelSchedule, CancelBudget, Migrate | schedule/budget ownership (353, 358); migrate target is a real vault (363) | Migrate restricted only by the whitelist (G-02); Cancel never clears `migrate_to` (G-04); Ping/Cancel with a fee during lockdown (G-01) |
| `execute_create_schedule` (384) | Schedule | tier, id, amounts, dest ≠ vault, first payment ≥ slow_delay when restricted (397-400) | later payments are not gated (by design: recovery must cancel within the delay) |
| `execute_create_budget` (416) | Budget | tier, id, session/limit/period/expiry (426) | no restriction check at creation or spend (G-03) |
| `execute_letter_key` (445) | LetterKey | signer threshold only (449) | — |

### Permissionless follow-ups and keys

| Instruction | Who | Main checks | Risks |
|---|---|---|---|
| `execute_pending(_token)` (536, 552) | P | not locked, due, kind/mint/dest match, funds | — |
| `run_schedule(_token)` (564, 578) | P | due, mint/dest match, funds; closes when done | runs during lockdown (by spec); `next_at += interval` can overflow (G-08) |
| `spend_budget(_token)` (593, 603) | E (session) | not locked, `budget_spend` (967), funds | G-03; fixed window (G-07); `window_start + period` overflow (G-08) |
| `migrate_sol` / `migrate_token` (612, 620) | P | `migrate_to == new_vault` | not blocked by lockdown or by any cancel once `migrate_to` is set (G-04) |
| `testament_sol/_token/_stake` (639, 657, 674) | P | testament active and owner inactive (983); heirs in config order, owner/mint match | heirs must pre-create token accounts |
| `sweep_inbox(_token)` (683, 692) | P | inbox PDA seeds | moves funds into the vault only |
| `write_letter` / `append_letter` / `close_letter` (468, 518, 529) | E (letter key) | letter-key PDA + `key == signer` and non-default (1431, 1450, 1468); sizes; order | vault account is never writable in these instructions |

### Protocol, Escape Hatch, canary

| Instruction | Who | Main checks | Risks |
|---|---|---|---|
| `init_protocol` (711) | E (`PROTOCOL_ADMIN`) | hard-coded admin | admin constant must be right before mainnet (`UPGRADE.md`) |
| `update_protocol` / `set_protocol_admin` / `freeze_protocol` (720-739) | E (admin) | has_one admin, not frozen | admin key is ed25519 (quantum); can raise `create_fee` for new free vaults only |
| `register_link` (743) | E (wallet) | target is a real vault | — |
| `request_link_change` / `apply_link_change` (751, 758) | E / P | canary not tripped; 30 days | a stolen wallet key can redirect the link after 30 days if nobody notices |
| `set_escape_tx` / `set_panic` (768, 774) | E (wallet) | has_one wallet | — |
| `escape_token` (781) | P | panic or tripped canary; owner = link wallet; delegate = escape PDA | moves to the linked vault only |
| `escape_sol` (808) | E (wallet) | link wallet and vault | public pre-signed tx: anyone can broadcast it (by design) |
| `init_canary` / `raise_baseline` / `trip_canary` (823-849) | P | fixed address; trip only when balance < baseline | relies on no rent collection from the canary address |

## 5. Root-of-trust assumptions

- SHA-256 pre-image and second-pre-image resistance (WOTS+ security, Merkle binding).
- The Solana runtime: PDA derivation, account ownership, writable/signer flags, CPI rules,
  `Clock` within reasonable drift.
- SPL Token, Token-2022, Associated Token and Stake programs behave as documented. Token-2022
  extensions (transfer hooks, fees, confidential transfers) are not specially handled.
- The upgrade authority is honest. Until it moves to a multisig with a timelock
  (`UPGRADE.md`), one key can replace the program and take every vault.
- `PROTOCOL_ADMIN` is honest for the fee/tier parameters (it cannot touch vault funds).

## 6. Out of scope

- Off-chain components: web app (`web/`), SDK correctness beyond the encodings the program
  checks, relayer (`sdk/relayer.ts`), keeper and Telegram bot (`bot/`), RPC providers, hosting.
- Client-side key handling: phrase generation and storage, browser storage of letter plaintext
  (SPEC §12), decoy duress root generation, `findSignedMessages` history scanning.
- Confidentiality of sealed letters (tlock / drand quicknet); the program stores opaque bytes.
- Economic design of $NOX and tiers (a tier is a balance check at one moment; tokens can be
  moved in just for that moment).
- Physical-world duress outcomes (the design caps loss; it does not hide the lockdown).
- Denial of service through Solana fees, compute or account-size limits.
- Front-running of permissionless follow-ups (their outcome does not depend on the caller).
