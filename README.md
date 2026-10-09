# Noxvault

Vaults on Solana that only open with a **WOTS+ hash-based one-time signature**. No ed25519 key
— not the depositor's wallet, not ours — can move what is inside. Every unlock uses the key once;
whatever is not withdrawn moves to the next fresh vault.

> Unaudited software, devnet only. Do not put in what you cannot afford to lose.

## Layout

| path | what |
|---|---|
| `docs/SPEC.md` | the protocol: keys, chains, message, on-chain flow, client rules. Change this first. |
| `programs/noxvault` | Anchor program (Rust) |
| `sdk/` | TypeScript: `wots.ts` (sign/verify, pure) and `client.ts` (PDAs, 24-word secret, `preflightUnlock`, `planUnlock`, `scanVaults`) |
| `tests/` | end-to-end tests on a local validator |
| `scripts/devnet-smoke.ts` | fund, register and unlock a fresh vault on a live cluster |
| `web/` | Next.js app |

## Develop

```bash
pnpm install
anchor build && pnpm sync-idl   # copy the IDL into sdk/idl after program changes
anchor test                     # local validator, all tests
cd web && pnpm install && pnpm dev --port 3100
```

The Solana platform tools ship Rust 1.79, so dependencies are resolved for that version
(`rust-version = "1.79"` in the program's Cargo.toml; `blake3` pinned to 1.5.5). After adding a
crate, resolve with `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo update`.

## Deployments

| cluster | program |
|---|---|
| devnet | `8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4` |

The program keypair lives in `target/deploy/` and is not in git. Before mainnet: an independent
review, then deploy and burn the upgrade authority (`solana program set-upgrade-authority --final`).

## Costs (measured)

- one on-chain hash ≈ 180 compute units; a signature check is 4–5k hashes on average
- a normal unlock is 2 transactions; worst case splits verification over more
- the unlock buffer's rent is returned; the `Spent` marker (~0.0017 SOL) stays as proof the key is used
