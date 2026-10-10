# Noxvault notification bot

A small, **read-only** Telegram bot that tells you when a Noxvault vault address moves.
It only reads public Solana chain data: it never holds keys and never asks users for anything secret.
`/start` and `/help` tell users that nobody from Noxvault will ever ask for their 24 words.

It deliberately does **not** decode Noxvault accounts or use the IDL (the protocol is moving to v2).
It only looks at generic transaction data: balance deltas and which programs were invoked.

## What it sends

For every new transaction touching a watched address, one message:

- incoming / outgoing SOL (vault's `preBalances` → `postBalances`)
- token balance changes for token accounts owned by the vault (mint short + amount)
- `Noxvault action — succeeded/failed` when the tx (or a CPI) invoked the Noxvault program
- a Solscan link (`?cluster=devnet` on devnet)

The first poll after `/watch` only records the latest signature — no backfill.

## Commands

| command | |
|---|---|
| `/watch <address>` | watch a vault address (base58, max 10 per chat) |
| `/unwatch <address>` | stop watching |
| `/list` | addresses this chat watches |
| `/start`, `/help` | explanation + safety note |

If someone pastes what looks like a 12/24-word phrase, the bot tells them to delete it.

## Environment

| var | default | |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — (required) | from @BotFather |
| `RPC_URL` | `https://api.devnet.solana.com` (mainnet default on `mainnet-beta`) | any Solana RPC |
| `NETWORK` | `devnet` | `devnet` or `mainnet-beta` (affects Solscan links) |
| `NOXVAULT_PROGRAM_ID` | `8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4` | used for the "Noxvault action" label |
| `POLL_SECONDS` | `20` | seconds between poll cycles (min 5) |
| `STATE_PATH` | `./data/state.json` | watches + cursors, written atomically (tmp + rename) |
| `RPC_DELAY_MS` | `250` | minimum gap between RPC calls |

Polling is sequential over all watched addresses with `RPC_DELAY_MS` between calls; 429s and
transient errors are retried with exponential backoff (1s → 30s). Per cycle, at most 25 new
transactions per address are handled; anything older in a bigger burst is skipped.

## Run locally

```bash
cd bot
pnpm install
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN
pnpm build
set -a; source .env; set +a
pnpm start
```

Uses Telegram long polling — no webhook, no public URL needed. Run **one** instance per token
(two long-pollers on the same token conflict).

Without a token you can still see what it would send:

```bash
pnpm dry-run 4VmyMBXEB9pXwVTssUEjJgy8EqfaooNurAEVybWtwkSV      # last 5 txs
pnpm dry-run <address> 10                                       # last 10
```

Tests: `pnpm test` (summarizer on a recorded devnet tx + fakes, state store, poller cursor logic).

## Deploy on Railway

1. New service → deploy from this repo, set **Root Directory** to `bot`. Railway picks up
   `railway.json` and builds the `Dockerfile`.
2. Add a **Volume** to the service, mount path `/data`.
3. Variables: `TELEGRAM_BOT_TOKEN`, `STATE_PATH=/data/state.json`, `NETWORK`, `RPC_URL`
   (a private RPC is recommended once there are more than a handful of watches),
   optionally `NOXVAULT_PROGRAM_ID` and `POLL_SECONDS`.
4. Keep replicas at 1 (set in `railway.json`). No port / domain is needed.

Without the volume, watches are lost on every redeploy.
