# Noxvault

Vaults on Solana that only open with **hash-based one-time signatures** (WOTS+ in a Merkle tree).
No ed25519 key — not the depositor's wallet, not ours — can move what is inside. One fixed vault
address serves 256 actions; an optional recovery key, a whitelist with a delay, staking and a
gasless relayer are part of the protocol (`docs/SPEC.md`).

> Unaudited software, devnet only. Do not put in what you cannot afford to lose.

## Layout

| path | what |
|---|---|
| `docs/SPEC.md` | the protocol (v4): keys, tree, config, actions, duress mode, on-chain flow, relayer, client rules. Change this first. |
| `programs/noxvault` | Anchor program (Rust) |
| `sdk/wots.ts` | WOTS+ chains, Merkle tree, borsh encodings — pure, runs in a web worker |
| `sdk/client.ts` | configs, PDAs, `planAction`, `findSignedMessages`, `pickLeaf`, `preflightAction`, `findVaultsFor` |
| `sdk/relayer.ts` | relay request encoding, off-chain checks, `relay()` |
| `tests/` | end-to-end tests on a local validator (short epochs for the stake test) |
| `scripts/devnet-smoke.ts` | create, fund and use a vault on a live cluster, incl. via the relayer |
| `web/` | Next.js app + API routes (`/api/relay`, `/api/init`, `/api/relayer-info`) |
| `bot/` | Telegram alerts for watched vaults |

## Develop

```bash
pnpm install
anchor build && pnpm sync-idl   # copy the IDL into sdk/idl after program changes
anchor test                     # local validator, all tests (~2 min)
cd web && pnpm install && pnpm dev --port 3100
```

The Solana platform tools ship Rust 1.79, so dependencies are resolved for that version
(`rust-version = "1.79"` in the program's Cargo.toml; `blake3` pinned to 1.5.5). After adding a
crate, resolve with `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo update`.

## Deployments

| what | where |
|---|---|
| program (devnet) | `8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4` |
| site | https://www.nox-vault.com (also https://noxvault-vert.vercel.app; DNS at GoDaddy; Vercel project `noxvault`, root `web/`, deploy with `vercel deploy --prod` from the repo root) |
| relayer (devnet) | `HH6D7N6wwLg1Uahdk4xm8uj8kHsrVrMo7AFNf2ymEzH8` |

Web env: `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_NETWORK`, `RELAYER_SECRET_KEY` (JSON array, server
only), `RELAY_MIN_FEE_LAMPORTS`, optional `NOX_MINT` + `NOX_DISCOUNT_THRESHOLD`.

Keys that are never in git: the program keypair (`target/deploy/`) and the relayer keypair
(`~/.config/solana/noxvault-relayer-devnet.json`). Before mainnet: an independent review, then
deploy and move the upgrade authority to the team multisig (Squads); upgrades are announced 7 days ahead.

## Costs (measured)

- one on-chain hash ≈ 180 compute units; a signature check is 4–5k hashes on average
- a normal action is 2 transactions; worst case splits verification over more
- building the 256-key tree takes ~3 s in Node, longer in a browser (done once, public part cached)
- the action buffer's rent is returned; vault state (~0.003 SOL) is paid once at creation
