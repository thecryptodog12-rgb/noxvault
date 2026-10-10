# Noxvault — protocol spec v3

A vault on Solana whose funds move only with **hash-based one-time signatures** (WOTS+), arranged
in Merkle trees so one fixed vault address serves many actions. On top of that: multi-signer
vaults, a recovery key, an on-chain testament, spending rules, schedules and session budgets,
migration, invoice addresses, and an **Escape Hatch** that also protects a user's ordinary
ed25519 wallet, triggered by an on-chain **quantum canary**. Everything works for SOL and for
SPL / Token-2022 tokens.

This file is the single source of truth for the program, the SDK, the web app and the keeper.
v2 and v1 are in git history; v3 is not compatible with them (new domains, new accounts).

## 1. Parameters

| name | value |
|---|---|
| `N` | 32 bytes (SHA-256) |
| `W` | 256 (one digit = one byte), `LEN` = 34 chains (32 + 2 checksum) |
| tree height | 8 for signer trees (256 keys), 4 for the recovery tree (16 keys) |
| signer slots | 3 (`trees[0..3]`), recovery slot `trees[3]` |

Little-endian integers, ASCII domain strings, `||` concatenation, borsh for structs.

## 2. Keys, chains, trees (unchanged from v2)

```
sk_seed = SHA256("nox2/sk" || S || u32le(i))       pk_seed = SHA256("nox2/pk" || S || u32le(i))
i = vault number v for a signer tree, v + 2^31 for a recovery tree
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
}
config_hash = SHA256("nox3/config" || borsh(Config))
vault       = PDA(["vault", config_hash])     // system-owned: holds SOL, owns token & stake accounts
state       = PDA(["state", vault])           // created by `init_vault(config)`, permissionless
```

A destination is **restricted** if the whitelist is set and it is not on it, or if the whitelist
is empty but `instant_limit > 0`. Restricted SOL withdrawals within the 24 h `instant_limit`
execute at once; anything else restricted becomes the **pending** withdrawal after `slow_delay`
(refused when `slow_delay = 0`). Tokens to restricted destinations always wait (or are refused).

## 4. Actions

```
Action { kind: Kind, fee: u64, fee_payee: Pubkey }        // fee: lamports from the vault on execution

enum Kind {
  0  Withdraw       { mint, dest, amount }
  1  Stake          { seed: u8, vote, amount }
  2  Unstake        { seed: u8 }
  3  CollectStake   { seed: u8 }
  4  Cancel                                     // drop the pending withdrawal / migration
  5  Ping                                       // owner is alive
  6  Schedule       { id: u8, mint, dest, amount, interval: i64, count: u16, start: i64 }
  7  CancelSchedule { id: u8 }
  8  Budget         { id: u8, session: Pubkey, mint, limit, period: i64, expires: i64 }
  9  CancelBudget   { id: u8 }
  10 Migrate        { new_vault }
}
mint = all-zero key for SOL
d = SHA256("nox3/msg" || program_id || vault || u8(tree) || u16le(leaf) || borsh(Action))
```

Signing, digits and verification are as in v2 (WOTS+ over `d`, then leaf, then auth path).

### Approvals

Every verified signature becomes an **approval** of `action_hash = SHA256("nox3/action" ||
borsh(Action))` in `PDA(["approval", vault, action_hash])`, recording which tree approved.
An action executes (permissionless, `execute_*`) when:

- signer approvals ≥ `threshold`, or
- the recovery tree approved it and it is `Cancel`, `CancelSchedule` or `CancelBudget`, or
- the recovery tree approved it and `now ≥ last_active + recovery_delay`.

Signer approvals set `last_active = now`. Executing closes the approval. Each leaf of each tree is
used once (bitmaps in `state`). An unexecuted approval can be discarded after 7 days.

### Rules per action

- **Withdraw**: restriction rules of §3; recovery withdrawals after inactivity are unrestricted.
- **Schedule**: pays `amount` every `interval`, `count` times from `start`; anyone runs due
  payments. A restricted destination's first payment is at least `slow_delay` away (refused if
  `slow_delay = 0`). `PDA(["schedule", vault, id])`.
- **Budget**: an ordinary (ed25519) **session key** may spend up to `limit` per `period` until
  `expires`, only to non-restricted destinations. Losing the session key loses at most the budget.
  `PDA(["budget", vault, id])`.
- **Migrate**: sets `migrate_to` (a Noxvault vault). Restricted unless `new_vault` is whitelisted.
  Then anyone moves all SOL and any token to it.
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
   (Schedule, Budget) — permissionless once approved
6. Permissionless after that: `execute_pending(_token)`, `run_schedule(_token)`,
   `migrate_sol`, `migrate_token`, `testament_sol`, `testament_token`, `testament_unstake`,
   `testament_collect`, `sweep_inbox`, `sweep_inbox_token`
7. Session key: `spend_budget(_token)`

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
- Never gated: recovery, whitelist, delays, instant limit, the Escape Hatch, withdrawals, staking,
  migration, and anything already created (heirs and co-signers are never locked out).
- Off-chain, by convention: relayers serve Sentinel vaults free; keepers evacuate linked wallets
  in order of their vault's tier, then $NOX held.
