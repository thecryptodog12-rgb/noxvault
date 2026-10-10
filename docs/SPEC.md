# Noxvault — protocol spec v2

A vault on Solana whose funds move only with **hash-based one-time signatures** (WOTS+), arranged
in a **Merkle tree** so one fixed vault address serves many withdrawals (the XMSS idea). No
ed25519 key can move what is inside. A second, optional **recovery tree** can cancel suspicious
withdrawals at any time and take over after a long period of inactivity.

This file is the single source of truth for the program (`programs/noxvault`), the TypeScript
SDK (`sdk/`), the web app (`web/`) and the relayer. Change it first, then the code.

v1 (one key per vault address, rest moved to a new vault) is replaced; see git history.

## 1. Parameters

| name | value | note |
|---|---|---|
| `N` | 32 | bytes per hash (SHA-256) |
| `W` | 256 | Winternitz parameter, one digit = one byte |
| `LEN` | 34 | 32 message digits + 2 checksum digits |
| primary tree height | 8 | 256 one-time keys = 256 actions per vault |
| recovery tree height | 4 | 16 one-time keys |
| signature | 34 × 32 B + `pk_seed` 32 B + auth path height × 32 B | 1,376 B for the primary tree |

All hashes are SHA-256; `||` concatenates; integers are little-endian (`u8`, `u16le`, `u32le`,
`u64le`, `i64le`); domain strings are ASCII.

## 2. Keys (client side only)

A **phrase** is 24 BIP39 words = a 32-byte master secret `S`. A user has a primary phrase and,
optionally, a separate recovery phrase (ideally held by someone else or stored elsewhere).
Vault number `v` = 0, 1, 2… lets one phrase run several vaults. The primary tree of vault `v`
uses `v`; a recovery tree uses `v + 2^31`, so one phrase never yields the same keys in both roles.

```
sk_seed(S, v) = SHA256("nox2/sk"    || S || u32le(v))
pk_seed(S, v) = SHA256("nox2/pk"    || S || u32le(v))
x(l, j)       = SHA256("nox2/chain" || sk_seed || u16le(l) || u8(j))      leaf l, chain j = 0..33
```

## 3. Chains, leaves, tree

```
F(l, j, k, v)    = SHA256(pk_seed || u16le(l) || u8(j) || u8(k) || v)     step k → k+1, k = 0..254
end(l, j)        = F applied 255 times to x(l, j)
leaf(l)          = SHA256("nox2/leaf" || pk_seed || u16le(l) || end(l,0) || … || end(l,33))
node(h, i, a, b) = SHA256("nox2/node" || pk_seed || u8(h) || u16le(i) || a || b)
```

Level 0 holds the leaves. Node `i` on level `h ≥ 1` is `node(h, i, left, right)` of children
`2i` and `2i+1` on level `h−1`. The tree root is node 0 on the top level. Every hash call is
keyed by `pk_seed` plus its exact position, so attacks on many keys at once gain nothing.

The **auth path** of leaf `l` is its sibling on each level, bottom to top.

## 4. Vault config and address

```
Config {
  primary_root:    [u8; 32],
  primary_height:  u8,             // 8
  recovery_root:   [u8; 32],       // all zero = no recovery tree
  recovery_height: u8,             // 4, or 0 when there is none
  recovery_delay:  i64,            // seconds of primary inactivity before recovery may act fully
  whitelist:       [Pubkey; 4],    // default key = empty slot
  slow_delay:      i64,            // seconds a withdrawal outside the whitelist waits; 0 = forbidden
}
config_hash = SHA256("nox2/config" || borsh(Config))
vault       = PDA(["vault", config_hash])       // system-owned: holds SOL, owns token & stake accounts
state       = PDA(["state", vault])             // program account created by `init_vault`
```

The deposit address commits to the full config, so nobody can change the rules of a vault
after the fact. `init_vault(config)` is permissionless and must run before the first action.
The whitelist only matters if at least one slot is set.

## 5. Actions and messages

Every one-time key signs exactly one message:

```
d = SHA256("nox2/msg" || program_id || vault || u8(tree) || u16le(leaf) || borsh(Action))
tree: 0 = primary, 1 = recovery
```

```
enum Action {                                         // borsh: u8 tag, then fields
  0 Withdraw     { mint, dest, amount: u64, fee: u64, fee_payee }
  1 Stake        { seed: u8, vote: Pubkey, amount: u64, fee: u64, fee_payee }
  2 Unstake      { seed: u8, fee: u64, fee_payee }
  3 CollectStake { seed: u8, fee: u64, fee_payee }
  4 Cancel       { fee: u64, fee_payee }               // drop the pending withdrawal
  5 Ping         { fee: u64, fee_payee }               // prove the owner is alive
}
```

- `mint` = all-zero key for SOL. `dest` is a wallet; tokens go to its associated token account.
- `fee` lamports go from the vault to `fee_payee` when the action executes. This is how a
  relayer is paid, so a user never needs a wallet of their own. 0 when the user pays fees.
- Stake accounts are PDAs `["stake", vault, seed]` with the vault as staker and withdrawer.

Digits: `a[0..32] = d`, `csum = Σ(255 − a[t])`, `a[32] = csum >> 8`, `a[33] = csum & 0xff`.
Sign: `sig[j] = F applied a[j] times to x(l, j)`. Verify walks each chain the remaining
`255 − a[j]` steps, rebuilds `leaf(l)`, then the root via the auth path.

### Rules enforced on chain

- Each leaf of each tree can be used once (bitmaps in `state`).
- **Primary tree:** may do every action; each use sets `last_active = now`.
- **Recovery tree:** may always `Cancel`. Everything else only if
  `now ≥ last_active + recovery_delay`.
- **Withdraw** to a `dest` outside a non-empty whitelist, signed by the primary tree:
  `slow_delay = 0` → refused; otherwise it becomes the vault's single **pending withdrawal**,
  executable by anyone after `slow_delay` seconds (`execute_pending`), cancellable before that
  by either tree. Recovery withdrawals after inactivity are immediate (they are the heir).
- A vault's SOL balance after any payout must be 0 or at least the rent-exempt minimum.

## 6. On-chain flow

A signature does not fit one transaction, so an action is assembled in a buffer
`["unlock", vault, payer]`:

1. `open_unlock(tree, leaf, pk_seed, auth_path, action)` — payer creates the buffer.
2. `write_sigs(start, sigs[])` — payer fills chains; the vault is passed as an account so every
   transaction carrying signature bytes appears in the vault's history.
3. `verify(from, to)` — permissionless; freezes the buffer on first call (no more writes) and
   walks chains `from..to` to their ends.
4. `finish_*` — permissionless once all chains are walked: rebuilds leaf and root, checks the
   root against `state.config`, marks the leaf used, applies the permission rules and executes
   the action. Buffer rent returns to the payer.
   `finish_withdraw` (SOL), `finish_withdraw_token`, `finish_stake`, `finish_unstake`,
   `finish_collect_stake`, `finish_admin` (Cancel, Ping).
5. `execute_pending` / `execute_pending_token` — permissionless after the delay.
6. `cancel_unlock` — the payer closes its buffer.

## 7. Relayer

A relayer is any service that sends these transactions as fee payer. The user signs an action
with `fee > 0` and `fee_payee = relayer`; the relayer pays network fees and buffer rent (which
it gets back) and is repaid by the vault at execution. The relayer cannot change anything: the
action is in the signed message. A relayer must verify the signature and Merkle path off-chain,
check the leaf is unused and the vault can pay the fee, before spending anything.

## 8. Client rules

A one-time key signs exactly one message, ever. Clients therefore:

- pick the lowest leaf that is unused in `state` **and** has no published signature values in
  the vault's history (`findSignedMessages`): if a leaf ever published part of a signature — in
  any buffer, from any payer, in a failed or cancelled attempt — only that message may be
  completed with it. If the history cannot be read, do not sign;
- run `preflightAction` before signing and refuse actions that could never execute;
- remember a signed action and, after a failure, resend the **same** message;
- use `confirmed` commitment and retry steps on an expired blockhash; every step is retry-safe.
