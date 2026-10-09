# Noxvault — protocol spec v1

A vault on Solana whose funds move only with a **WOTS+ hash-based one-time signature**.
No ed25519 key can open a vault. Every unlock spends the key; leftovers move to a fresh vault.

This file is the single source of truth for the program (`programs/noxvault`), the
TypeScript SDK (`sdk/`) and the web app (`web/`). Change it first, then the code.

## Parameters

| name | value | note |
|---|---|---|
| `N` | 32 | bytes per hash / chain value (full SHA-256) |
| `W` | 256 | Winternitz parameter, one digit = one byte |
| `LEN1` | 32 | message digits (32-byte digest) |
| `LEN2` | 2 | checksum digits (max checksum 32·255 = 8160 < 65536) |
| `LEN` | 34 | chains per key |
| signature | 34 × 32 = 1088 bytes | + 32-byte `pk_seed` |

All hashes are SHA-256. `||` is concatenation, `u8/u32le/u64le` are integer encodings.
Domain strings are ASCII bytes.

## Keys (client side only)

```
S                      32-byte master secret (shown to the user as 24 BIP39 words)
sk_seed(i) = SHA256("nox/sk"    || S || u32le(i))
pk_seed(i) = SHA256("nox/pk"    || S || u32le(i))
x(i, j)    = SHA256("nox/chain" || sk_seed(i) || u8(j))        j = 0..33
```

Vault `i` is the i-th key derived from `S`. Clients scan i = 0,1,2,… to find a user's vaults.

## Chain function (tweakable, WOTS+ style)

```
F(pk_seed, j, k, v) = SHA256(pk_seed || u8(j) || u8(k) || v)     k = 0..254
chain(v, j, start, steps):  for k in start .. start+steps-1:  v = F(pk_seed, j, k, v)
end(j) = chain(x(i,j), j, 0, 255)
root   = SHA256("nox/root" || pk_seed || end(0) || … || end(33))
vault  = PDA(["vault", root], program_id)        # system-owned, holds SOL & token ATAs
```

The `pk_seed` + chain index + step index tweak means every hash call in every chain of
every vault is a different function, so attacks that target many vaults at once gain nothing.

## Message

```
d = SHA256("nox/msg/v1" || program_id || vault || mint || dest || next_vault || u64le(amount))
```

- `mint` = the asset withdrawn; SOL is the all-zero key (`11111111111111111111111111111111`).
- `dest` = destination wallet (for tokens: the owner; the program pays into its ATA).
- `next_vault` = the vault that receives everything not withdrawn.

Digits: `a[0..32] = d` bytes. `csum = Σ (255 − a[t])`. `a[32] = csum >> 8`, `a[33] = csum & 0xff`.

Sign: `sig[j] = chain(x(i,j), j, 0, a[j])`.
Verify: `end'[j] = chain(sig[j], j, a[j], 255 − a[j])`, then rebuild `root` and the vault PDA.

## On-chain flow

A signature (1088 B) plus accounts does not fit one 1232-byte transaction, and a worst-case
verify is ~8,700 hashes, so an unlock is split over a few transactions. Every step is safe to
retry and none of them can redirect funds: the parameters are fixed in the signed message.

1. `open_unlock(vault, pk_seed, mint, dest, next_vault, amount)` — payer creates an
   `Unlock` buffer PDA `["unlock", vault, payer]`.
2. `write_sigs(start, sigs[])` — payer fills chains `start..start+len`. Only the payer can write.
3. `verify(from, to)` — permissionless. On the first call the buffer freezes (no more writes),
   computes the digits once and then walks chains `from..to` to their ends.
4. `finish_unlock` — permissionless once all 34 chains are verified. Rebuilds `root`, checks
   `PDA(["vault", root]) == vault`, creates the `Spent` marker `["spent", vault]` (fails if the
   key was ever used), pays `amount` of `mint` to `dest`, moves the rest of that asset to
   `next_vault`, and closes the buffer (rent back to payer).
5. `sweep` / `sweep_token(mint)` — permissionless. For a spent vault, moves all remaining SOL
   or all of one token to `Spent.successor`. Anything sent to an old vault address later is
   forwarded the same way; it is never guarded by a used key again.

### Rent rule
A system account must hold 0 or ≥ rent-minimum lamports. If the SOL remainder is non-zero but
too small to open an empty `next_vault`, it is added to the payment to `dest` (dust).

### Other accounts
- `Record` `["record", vault]` — optional, created by `register(root)`; lists a vault in the
  public explorer. Holds `root`, `vault`, `created_at`.
- `Spent` `["spent", vault]` — `{ vault, root, successor, mint, dest, amount, slot }`.

## What this deliberately fixes compared to plain-WOTS vaults

- full 32-byte chains with per-call tweaks (WOTS+), instead of truncated, untweaked chains;
- a failed unlock never forces a second signature: the signed message is frozen in the buffer
  and anyone can complete it, and WOTS signing is deterministic, so retrying reveals nothing new;
- used keys are marked on-chain, so nothing can ever be unlocked twice with the same key;
- SPL / Token-2022 tokens, not only SOL;
- the program is upgradeable only until mainnet launch, then the authority is burned.

## Client rules

A one-time key signs exactly one message, ever. Clients therefore:

- run `preflightUnlock` before signing and refuse messages that could never be paid out
  (amount above balance, empty destination below rent, frozen or fee-on-transfer tokens,
  a used next vault);
- remember the parameters of a pending unlock and, after a failure, resend the **same**
  message (WOTS signing is deterministic, so this reveals nothing new);
- always pick `next_vault` after every index ever used (`scanVaults().nextFresh`);
- use `confirmed` commitment and retry a step on an expired blockhash; every step is retry-safe.
