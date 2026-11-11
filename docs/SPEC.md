# Noxvault — protocol spec v4.2

A vault on Solana whose funds move only with **hash-based one-time signatures** (WOTS+), arranged
in Merkle trees so one fixed vault address serves many actions. On top of that: multi-signer
vaults, a recovery key, a duress phrase, an on-chain testament, sealed letters, spending rules, schedules and session budgets,
migration, invoice addresses, and an **Escape Hatch** that also protects a user's ordinary
ed25519 wallet, triggered by an on-chain **quantum canary**. Everything works for SOL and for
SPL / Token-2022 tokens.

This file is the single source of truth for the program, the SDK, the web app and the keeper.
v3, v2 and v1 are in git history. v4 adds duress mode (§11) and sealed letters (§12) and changes the `Config` and
`VaultState` layouts, so v3 devnet vaults are not readable by the v4 program (domains unchanged).

### Changes in v4.2 (recovery cancel and freeze; layouts, domains and existing codes unchanged)

v4.2 closes a weakness of the anti-theft use case: a thief holding a signer phrase answered every
recovery `Cancel` with a new restricted payout (each cancel burns one recovery key, so the thief
won the war of attrition), and kept `last_active` fresh so recovery-after-inactivity never opened.
Every account layout and size is the same as v4/v4.1; v4 and v4.1 vaults keep working.

1. **`Kind::CancelLock { secs: i64 }`** (tag 12, appended; borsh `u8(12) || i64le(secs)`). Only an
   approval that includes the recovery tree executes it, at any time (in a lockdown or not,
   whatever the owner's activity). `MIN_CANCEL_LOCK = 86 400` (1 day) ≤ `secs` ≤
   `MAX_CANCEL_LOCK = 7 776 000` (90 days); `open_unlock` refuses other values before a key is
   burned. It clears `pending` and `migrate_to` like `Cancel`, then sets
   `lockdown_until = max(lockdown_until, now + secs)` (§4, §11).
2. **A lockdown binds only approvals without the recovery tree.** An approval with the signer
   threshold and the recovery tree executes like outside a lockdown (the vault's rules apply); its
   `Migrate` starts at once, whitelist or not (the escape to a new vault, §4 "Migrate"). During a
   lockdown a signer-only `Cancel` clears `pending` but not a started migration (`migrate_to`).
3. **No activity during a lockdown.** Signer and duress approvals made while the vault is locked
   no longer set `last_active` (§4 "Approvals").
4. Plain `Cancel` is unchanged; from the recovery tree it still ends any lockdown (§11).
5. New errors, appended: `CancelLockNeedsRecovery` (6045), `LockOutOfRange` (6046).
6. Trade-offs: §13 "v4.2".

### Changes in v4.1 (audit fixes; layouts, domains and existing error codes unchanged)

v4.1 closes the findings of the internal audit (`docs/audit/INVARIANTS.md` §9). Every account
layout and size is the same as v4, so v4 vaults keep working; only new checks and constants.

1. **Fee cap (G-01).** `MAX_ACTION_FEE = 10 000 000` lamports (0.01 SOL). Every execution path
   refuses a larger `fee` (`FeeTooHigh`), the duress path included; `open_unlock` refuses it
   before a key is burned (§4).
2. **No fee in a lockdown (G-01).** During a lockdown a `Ping` or cancel approved by the signers
   alone carries `fee = 0` (`FeeInLockdown`); if the recovery tree also approved, the capped fee
   is allowed (§11).
3. **Migrate obeys the instant limit (G-02).** A `Migrate` is restricted exactly like a withdrawal
   destination (§3), so it waits `slow_delay` (or is refused) unless `new_vault` is whitelisted
   or the vault has no rules (§4).
4. **Budgets obey the instant limit (G-03).** `spend_budget(_token)` refuses every restricted
   destination (`BudgetDestRestricted`), and a budget cannot be created on a vault where every
   destination is restricted (no whitelist and `instant_limit > 0`) (§4).
5. **Cancel stops a started migration (G-04).** `Cancel` clears `pending` and `migrate_to` (§4).
6. **Distinct roots (G-05).** `init_vault` refuses a used root in two slots, across the three
   signer slots, the recovery slot and the duress tree (`DuplicateRoot`) (§3).
7. **Bounded durations (G-08).** `slow_delay`, `recovery_delay`, `testament_delay` and
   `duress_lock` are at most `MAX_DURATION` = 10 years (`recovery_delay` also ≥ 0); a schedule's
   `interval` and a budget's `period` too (`DurationTooLong`). Time arithmetic saturates (§3).
8. New errors, appended after the v4 ones: `FeeTooHigh` (6040), `FeeInLockdown` (6041),
   `DuplicateRoot` (6042), `BudgetDestRestricted` (6043), `DurationTooLong` (6044).
9. Known limitations, unchanged by design: §13.

## 1. Parameters

| name | value |
|---|---|
| `N` | 32 bytes (SHA-256) |
| `W` | 256 (one digit = one byte), `LEN` = 34 chains (32 + 2 checksum) |
| tree height | 8 for signer trees (256 keys), 4 for the recovery tree (16 keys) |
| signer slots | 3 (`trees[0..3]`), recovery slot `trees[3]`, duress tree index 4 (`config.duress`) |

Little-endian integers, ASCII domain strings, `||` concatenation, borsh for structs.

## 2. Keys, chains, trees (unchanged from v2)

```
sk_seed = SHA256("nox2/sk" || S || u32le(i))       pk_seed = SHA256("nox2/pk" || S || u32le(i))
i = vault number v for a signer tree, v + 2^31 for a recovery tree, v + 2^30 for a duress tree
x(l, j)          = SHA256("nox2/chain" || sk_seed || u16le(l) || u8(j))
F(l, j, k, v)    = SHA256(pk_seed || u16le(l) || u8(j) || u8(k) || v)
leaf(l)          = SHA256("nox2/leaf" || pk_seed || u16le(l) || end(l,0..33))
node(h, i, a, b) = SHA256("nox2/node" || pk_seed || u8(h) || u16le(i) || a || b)
```

## 3. Config and address

```
Tree    { root: [u8; 32], height: u8 }                 // root all-zero = slot unused
Heir    { addr: Pubkey, bps: u16 }                     // addr default = unused
Config {
  trees:           [Tree; 4],     // 0..2 signers, 3 recovery
  threshold:       u8,            // signer approvals needed, 1..=number of signer trees
  recovery_delay:  i64,           // owner inactivity before recovery may act fully
  whitelist:       [Pubkey; 4],
  slow_delay:      i64,           // wait for restricted withdrawals; 0 = refuse them
  instant_limit:   u64,           // lamports per 24 h a restricted SOL withdrawal may skip the wait
  heirs:           [Heir; 4],     // bps sum to 10000 when any heir is set
  testament_delay: i64,           // owner inactivity before the testament may run; 0 = off
  duress:          Tree,          // tree 4 (§11); always used, height 1..=8
  duress_limit:    u64,           // lamports a duress withdrawal pays out at once
  duress_lock:     i64,           // lockdown after a duress withdrawal, >= 86400
}
// v4.1: slow_delay, recovery_delay, testament_delay >= 0; all four delays <= MAX_DURATION
// (10 years = 315 360 000 s); every used root (trees[0..4], duress) differs from every other.
config_hash = SHA256("nox3/config" || borsh(Config))
vault       = PDA(["vault", config_hash])     // system-owned: holds SOL, owns token & stake accounts
state       = PDA(["state", vault])           // created by `init_vault(config)`, permissionless
```

A destination is **restricted** if the whitelist is set and it is not on it, or if the whitelist
is empty but `instant_limit > 0`. Restricted SOL withdrawals within the 24 h `instant_limit`
execute at once; anything else restricted becomes the **pending** withdrawal after `slow_delay`
(refused when `slow_delay = 0`). Tokens to restricted destinations always wait (or are refused).
The same rule decides `Migrate` (which never uses the instant allowance) and which destinations a
session budget may pay (§4). The 24 h window is fixed, not sliding (§13).

## 4. Actions

```
Action { kind: Kind, fee: u64, fee_payee: Pubkey }        // fee: lamports from the vault on execution,
                                                          // at most MAX_ACTION_FEE = 10 000 000 (v4.1)

enum Kind {
  0  Withdraw       { mint, dest, amount }
  1  Stake          { seed: u8, vote, amount }
  2  Unstake        { seed: u8 }
  3  CollectStake   { seed: u8 }
  4  Cancel                                     // drop the pending withdrawal / migration, stop a started one
  5  Ping                                       // owner is alive
  6  Schedule       { id: u8, mint, dest, amount, interval: i64, count: u16, start: i64 }
  7  CancelSchedule { id: u8 }
  8  Budget         { id: u8, session: Pubkey, mint, limit, period: i64, expires: i64 }
  9  CancelBudget   { id: u8 }
  10 Migrate        { new_vault }
  11 LetterKey      { key: Pubkey }             // sealed letters (§12); all-zero key revokes
  12 CancelLock     { secs: i64 }               // v4.2: recovery only; Cancel, then freeze for secs
}
mint = all-zero key for SOL
d = SHA256("nox3/msg" || program_id || vault || u8(tree) || u16le(leaf) || borsh(Action))
```

Signing, digits and verification are as in v2 (WOTS+ over `d`, then leaf, then auth path).

### Approvals

Every verified signature becomes an **approval** of `action_hash = SHA256("nox3/action" ||
borsh(Action))` in `PDA(["approval", vault, action_hash])`, recording which tree approved.
An action executes (permissionless, `execute_*`) when:

- it is `CancelLock` and the recovery tree approved it (v4.2; nothing else ever executes a
  `CancelLock`: `CancelLockNeedsRecovery`), or
- signer approvals ≥ `threshold` (during a lockdown without the recovery tree only `Ping` and
  cancels, §11), or
- the recovery tree approved it and it is `Cancel`, `CancelSchedule` or `CancelBudget`, or
- the recovery tree approved it and `now ≥ last_active + recovery_delay`, or
- only the duress tree approved it (§11).

The duress approval never counts toward `threshold` and adds nothing to recovery powers.
Signer and duress approvals set `last_active = now`, except while the vault is in lockdown (v4.2:
a frozen signer phrase must not hold off recovery-after-inactivity). Executing closes the approval. Each leaf of each tree is
used once (bitmaps in `state`). An unexecuted approval can be discarded after 7 days.

### The fee (v4.1)

`fee` lamports go from the vault to `fee_payee` when the action executes (the relayer's repayment,
§8). It is not a destination under the rules of §3, so it is bounded instead:

- `fee ≤ MAX_ACTION_FEE` (0.01 SOL) on every path; `open_unlock` and every `execute_*` refuse more
  (`FeeTooHigh`). A duress withdrawal also takes its fee from the duress allowance (§11).
- During a lockdown, an approval without the recovery-tree bit pays `fee = 0` (`FeeInLockdown`).
- The fee is not counted in the instant-limit window: relayed actions would otherwise eat the
  owner's allowance, or be refused on whitelist vaults. The cost: a stolen signer phrase can move
  at most `MAX_ACTION_FEE` per one-time key through fees (≤ 2.56 SOL over the life of a height-8
  tree), never during a lockdown (§13).

Relayers never ask more than `MAX_ACTION_FEE`, and relay a signer `Ping` or cancel during a
lockdown for free.

### Rules per action

- **Withdraw**: restriction rules of §3; recovery withdrawals after inactivity are unrestricted.
- **Cancel**: clears `pending` (a waiting withdrawal or migration) and `migrate_to` (a started
  migration: whatever `migrate_sol` / `migrate_token` have not moved yet stays in the vault). From
  the recovery tree it also ends a lockdown (§11). During a lockdown, a `Cancel` without the
  recovery tree clears `pending` only, never a started migration (v4.2). It never touches
  schedules or budgets (`CancelSchedule`, `CancelBudget`) or funds already moved.
- **CancelLock** (v4.2, recovery tree only): clears `pending` and `migrate_to`, then
  `lockdown_until = max(lockdown_until, now + secs)`, 1 day ≤ `secs` ≤ 90 days. It extends a running
  lockdown (duress or an earlier freeze), never shortens it. It may pay the capped fee (the
  recovery tree approved it); relayers send it free. The anti-theft answer to a payout the owner
  did not start: the signer phrase alone then executes only `Ping` and cancels until the freeze
  ends, its approvals do not count as activity, and the owner escapes with signer + recovery.
- **Schedule**: pays `amount` every `interval`, `count` times from `start`; anyone runs due
  payments. A restricted destination's first payment is at least `slow_delay` away (refused if
  `slow_delay = 0`). `0 < interval ≤ MAX_DURATION`. `PDA(["schedule", vault, id])`.
- **Budget**: an ordinary (ed25519) **session key** may spend up to `limit` per `period` until
  `expires`, only to non-restricted destinations (§3, instant limit included: `spend_budget`
  refuses a restricted one with `BudgetDestRestricted`). A budget cannot be created on a vault
  whose every destination is restricted (no whitelist and `instant_limit > 0`).
  `0 < period ≤ MAX_DURATION`. `limit` is not bounded further: a budget only pays destinations a
  signer could pay at once anyway. Losing the session key loses at most the budget.
  `PDA(["budget", vault, id])`.
- **Migrate**: sets `migrate_to` (a Noxvault vault). Restricted like a withdrawal destination
  (§3): unless `new_vault` is whitelisted, or the vault has no rules, or recovery acts after
  inactivity, it becomes the pending migration after `slow_delay` (refused when `slow_delay = 0`).
  **Escape (v4.2):** during a lockdown, an approval with the signer threshold and the recovery
  tree starts it at once. Then anyone moves all SOL and any token to it, until a `Cancel` clears
  `migrate_to` (during a lockdown only a recovery `Cancel` or `CancelLock` does).
- **Testament**: when `testament_delay > 0` and `now ≥ last_active + testament_delay`, anyone
  can distribute all SOL / any token to the heirs by `bps`, and deactivate / collect stakes first.
- After any payout the vault holds 0 or ≥ rent-minimum lamports.

## 5. Flow

1. `open_unlock(tree, leaf, pk_seed, auth_path, action)` → buffer `["unlock", vault, payer]`
2. `write_sigs(start, sigs)` — names the vault so every signature byte is in the vault's history
3. `verify(from, to)` — permissionless, freezes on first call
4. `approve` — rebuilds leaf and root, burns the leaf, records the approval, closes the buffer
5. `execute_withdraw` · `execute_withdraw_token` · `execute_stake` · `execute_stake_authority`
   · `execute_admin` (Cancel, Ping, CancelSchedule, CancelBudget, Migrate) · `execute_create`
   (Schedule, Budget) · `execute_letter_key` (LetterKey) — permissionless once approved
6. Permissionless after that: `execute_pending(_token)`, `run_schedule(_token)`,
   `migrate_sol`, `migrate_token`, `testament_sol`, `testament_token`, `testament_unstake`,
   `testament_collect`, `sweep_inbox`, `sweep_inbox_token`
7. Session key: `spend_budget(_token)`
8. Letter key: `write_letter`, `append_letter`, `close_letter` (§12)

## 6. Invoice addresses

`inbox(vault, id) = PDA(["inbox", vault, u32le(id)])`, system-owned. Anyone may send SOL or
tokens to it; anyone may sweep it into the vault. One per payer gives per-payer accounting
without sharing the vault address.

## 7. Escape Hatch, registry and canary

For a user's ordinary wallet `w` (ed25519):

- `register_link(vault)`, signed by `w` → `PDA(["link", w])` {vault, created_at, panic, change,
  escape_tx}. It is also a **timestamped registry entry**: proof, signed while ed25519 is still
  safe, that `w` belongs to that vault. Changing the vault takes 30 days (`request_link_change`,
  `apply_link_change`) and is impossible after the canary trips.
- **Tokens**: `w` approves `PDA(["escape", w])` as delegate of its token accounts.
  `escape_token` (permissionless) moves a delegated token account's whole balance to the linked
  vault — only when the canary has tripped or `w` signed `panic`.
- **SOL**: `w` pre-signs a durable-nonce transaction calling `escape_sol` (moves all of `w`'s SOL
  to the linked vault) and stores it in its link (`set_escape_tx`). Anyone may broadcast it; it
  can only ever move `w`'s SOL into `w`'s own vault.
- **Canary**: `PDA(["canary"])` watches a fixed ed25519 address derived by hashing to the curve
  (nobody knows its private key) and funded with a bounty. `trip_canary` (permissionless) sets
  `tripped` once its balance falls below the recorded baseline — which can only happen if
  ed25519 is broken. Keepers then evacuate every linked wallet.

This is a race against an attacker who breaks a wallet's key; it gives honest users the first move.

## 8. Relayer and keeper

A relayer sends signed actions as fee payer and is repaid through `fee` (v2 §7 unchanged).
A keeper runs the permissionless instructions: due schedules, pending withdrawals, testaments,
inbox sweeps, canary checks and escape broadcasts. Neither can change anything that was signed.

## 9. Client rules

**One tree, one vault.** A tree must sit in exactly one vault: the message digest includes the
vault, so a tree placed in two vaults would let one leaf sign two different messages. Owners get a
fresh tree per vault number; co-signer and recovery codes are derived for a vault number whose
tree is in no vault yet (`findVaultsFor` returns nothing), and are never reused.

As v2: pick a leaf unused on chain and without published signature values in the vault's history
(`findSignedMessages`); refuse to sign when history cannot be read; preflight before signing;
resend the same message after a failure; `confirmed` commitment; every step is retry-safe.

## 10. Protocol parameters and $NOX tiers

```
Protocol = PDA(["protocol"]) { admin, params: { nox_mint, guardian, sentinel, create_fee, treasury }, frozen }
```

- `init_protocol` (only `PROTOCOL_ADMIN`), `update_protocol`, `set_protocol_admin`, `freeze_protocol`
  (admin). Frozen parameters never change again. Admin moves to a team multisig, then governance.
- A vault's **tier** = the $NOX (`nox_mint`) balance of a token account the vault owns, passed as
  the optional `nox_account`: ≥ `sentinel` → Sentinel, ≥ `guardian` → Guardian, else Free.
  `nox_mint` = default key → tiers off (everything open).
- Checked by the program:
  - `init_vault`: more than one signer tree → Sentinel; a testament → Guardian; a Free vault pays
    `create_fee` lamports from the payer to `treasury`.
  - `execute_create_schedule`, `execute_create_budget` → Guardian.
- Never gated: recovery, duress mode, whitelist, delays, instant limit, the Escape Hatch, withdrawals, staking,
  migration, and anything already created (heirs and co-signers are never locked out).
- Off-chain, by convention: relayers serve Sentinel vaults free; keepers evacuate linked wallets
  in order of their vault's tier, then $NOX held.

## 11. Duress mode

Against physical coercion: the owner gives an attacker a **duress phrase**, which works at once
for a small amount while the rest of the vault locks.

- **Tree 4** (`config.duress`), signed like any other tree, leaf bitmap `used[4]`. Clients fill it
  for *every* vault: with no duress phrase, a root derived from the owner's secret
  (`SHA256("nox4/decoy-duress" || sk_seed)`, no key exists for it) at the primary tree's height,
  `duress_limit` 0.5 SOL and `duress_lock` 3 days by default. No vault reveals whether it has one.
- A duress approval authorizes only `Withdraw` of SOL. Executing it pays
  `min(amount, duress_limit, vault lamports − rent minimum)` to `dest` at once (the fee, at most
  `MAX_ACTION_FEE`, is paid from the same allowance), ignoring whitelist, instant limit and slow delay, then sets
  `lockdown_until = max(lockdown_until, now + duress_lock)`. During a lockdown already running it
  pays nothing more (it still extends the lockdown). Every other `execute_*` refuses it.
- **Lockdown** (`now < lockdown_until`), started by a duress withdrawal or by a recovery
  `CancelLock` (v4.2, §4): signer approvals without the recovery tree execute only `Ping`,
  `Cancel`, `CancelSchedule`, `CancelBudget`, and only with `fee = 0` (v4.1);
  `execute_pending(_token)` and `spend_budget(_token)` are refused. An approval with the signer
  threshold and the recovery tree is not limited by the lockdown (v4.2: the vault's rules apply,
  and its `Migrate` starts at once). Running schedules, the testament, inbox sweeps and an
  already-started migration continue. Recovery after inactivity is unaffected; approvals made
  during a lockdown do not count as activity (v4.2).
- A **recovery-tree `Cancel`** also ends the lockdown: the recovery holder, not the coerced owner,
  decides when it is safe. A recovery `CancelLock` during a lockdown only ever extends it.
- Off-chain: the bot watches `lockdown_until` and alerts recovery contacts. The lockdown is
  visible on chain; the design caps the loss, it does not hide. The app in duress mode shows the
  duress limit as the balance. SOL only; tokens stay locked. Never needs a tier.

## 12. Sealed letters

Letters for heirs, encrypted client-side with **tlock** to a future **drand quicknet** round
(chain `52db9ba7…`, 3 s rounds). Nobody can read one before its round; after it, anyone holding
the ciphertext can (the reader fetches that round's beacon). Nothing on chain checks drand.

- **Letter key.** `Kind::LetterKey { key }` (tag 11, borsh `u8(11) || key`, digest and
  `action_hash` exactly as every other kind) authorizes an ordinary ed25519 key, like a budget
  session key. `execute_letter_key` stores it in `PDA(["letterkey", vault])` {vault, key,
  updated_at}, created on first use (the executor pays its rent); `VaultState` is unchanged.
  Only a **signer-threshold** approval sets it: duress approvals are refused (`DuressSolOnly`),
  recovery approvals too, also after the owner's inactivity (`LetterKeySignersOnly`); during a
  lockdown it is refused like any non-cancel. The approval counts as owner activity like any
  signer approval. Setting a new key replaces the old one; the all-zero key revokes.
- **Letters.** `PDA(["letter", vault, u32le(id)])` {vault, id, unlock_round: u64, updated_at,
  filled: u32, label: bytes ≤ 64 (plaintext hint), content: bytes ≤ 8192 (ciphertext)}. Only the
  current letter key signs; it also pays the rent:
  - `write_letter(id, unlock_round, label, len, data)` creates the letter or overwrites it, sized
    for `len` bytes (realloc; spare rent goes back to the key), with `data` as its first bytes;
  - `append_letter(id, offset, data)` writes the next chunk, `offset` = bytes filled so far;
  - `close_letter(id)` deletes it, rent to the key.
  A letter is complete when `filled = len(content)`. Letter instructions never touch the vault's
  funds or `last_active`: a leaked letter key can overwrite or delete letters, never move funds or
  keep the vault "active".
- **Rolling date (client).** The app seals each letter to round(now + testament_delay + 7 days),
  or to a chosen distance when the vault has no testament, and re-seals every letter to a later
  round whenever the owner opens the vault. Re-sealing needs the plaintext, so the app keeps it in
  the browser, AES-GCM encrypted under HKDF-SHA256(ikm = the signer tree's sk_seed, salt = vault,
  info = "nox4/letters/local"), together with the letter key. Ciphertext on chain is the binary
  age file tlock produces (no armor); its plaintext is JSON `{v: 1, t: text}` or, with an extra
  passphrase for the heir, `{v: 1, pw: {s, i, c}}` (PBKDF2-SHA256 210 000 rounds, AES-GCM).
- **Limits.** A letter opens at its round even if the owner is alive but did not refresh in time.
  After the round, anyone with the ciphertext can read it unless it also has a passphrase.

## 13. Known limitations

Design trade-offs the audit found (`docs/audit/INVARIANTS.md` §9) and v4.1 keeps on purpose.

- **G-06: the duress phrase can prolong the lockdown.** Every executed duress withdrawal extends
  the lockdown (even when it pays nothing). Before v4.2 every duress approval also set
  `last_active`; since v4.2 approvals made during a lockdown do not, so chained lockdowns no longer
  postpone recovery-after-inactivity or the testament. Whoever holds the duress phrase can therefore chain lockdowns, up to
  2^height × `duress_lock` (≥ 256 days at height 8), which blocks the owner's withdrawals and
  postpones recovery-after-inactivity and the testament. Kept because a duress signature must look
  like any other (indistinguishability) and the lockdown must hold while the coercer is present.
  Remedy: the recovery holder's `Cancel` ends each lockdown. Nothing beyond `duress_limit` per
  lockdown leaves the vault (the v4.1 fee rule included).
- **G-07: the instant limit and budget periods are fixed windows, not sliding ones.** The window
  restarts at `window_start + 24 h` (budgets: `+ period`), so up to 2 × `instant_limit` (or
  2 × `limit`) can leave within any 24 h (or `period`) around a restart. Kept because a sliding
  window needs more state than `VaultState` and `Budget` hold, and their layouts are fixed. Choose
  limits with the 2× worst case in mind.
- **Fees outside the instant limit.** See "The fee" in §4: at most `MAX_ACTION_FEE` per one-time
  key, never during a lockdown.
- **v4.2: signers + recovery during a lockdown migrate at once.** Whoever holds both the signer
  and the recovery phrase can start a freeze (`CancelLock`) and then move everything to a vault of
  his choice at once, instead of waiting `slow_delay`. Kept: both phrases together already decide
  the vault (the recovery phrase ends lockdowns at will and, since approvals during a lockdown are
  not activity, can take over after `recovery_delay`). Keep the two phrases apart.
- **v4.2: approvals during any lockdown are not activity.** This also holds for a duress lockdown:
  an owner cannot hold the testament or the recovery takeover off by pinging during one; the
  recovery holder's `Cancel` ends the lockdown, after which pings count again.
- **v4.2: schedules still run during a freeze** (§11, unchanged). A schedule a thief created
  before the freeze pays once due (its first restricted payment waits `slow_delay`). Stop it with
  the recovery `CancelSchedule`, or escape: an empty vault pays nothing.
- **v4.2: a freeze ends by itself** after at most 90 days; renewing it costs one recovery key.
