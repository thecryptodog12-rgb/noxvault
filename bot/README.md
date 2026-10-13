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
| `/ca` | the $NOX contract address + pump.fun link (before launch: countdown to 20:00 CEST) |
| `/buy` | short how-to-buy steps + https://www.nox-vault.com/buy |
| `/links` | site, X, buy guide, whitepaper |
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
| `NOX_TOKEN` | empty | $NOX mainnet mint for `/ca` and `/buy`. Empty = pre-launch countdown. The bot refuses to start on an invalid address. Set it at launch and redeploy. |
| `NOX_LAUNCH_AT` | `2026-10-13T20:00:00+02:00` | launch time used for the `/ca` countdown |

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
   optionally `NOXVAULT_PROGRAM_ID` and `POLL_SECONDS`. At launch add `NOX_TOKEN` (the $NOX mint).
4. Keep replicas at 1 (set in `railway.json`). No port / domain is needed.

Without the volume, watches are lost on every redeploy.

---

# Keeper

`src/keeper.ts` is a long-running **keeper** (docs/SPEC.md §8). Every `KEEPER_INTERVAL_SECONDS`
(default 60) it runs one pass of `runKeeper` from `web/lib/keeper.ts`, the same code the web
app's `GET /api/keeper` cron runs:

1. **Canary**: trips it if the bounty is below its baseline.
2. **Escape Hatch**: for every linked wallet with panic on (or every linked wallet once the canary
   has tripped): broadcasts the stored, pre-signed SOL escape (if its nonce is still current) and
   runs `escape_token` for each token account that delegated to `PDA["escape", wallet]`.
3. **Vaults**: executes pending withdrawals / migrations whose delay is over, runs due schedules,
   pays out open testaments (SOL and every held token) and finishes approved migrations.

It holds nobody's secret and cannot change anything that was signed: it only pays network fees
(and the rent of a vault token account it sometimes has to create, ~0.002 SOL) to run what the
on-chain rules already allow. Failures (already done, not due) are reported and skipped. Each pass
sends at most `KEEPER_MAX_TX` transactions, sequentially, with 429 backoff.

The keeper is bundled with esbuild (`scripts/build-keeper.mjs` → `dist/keeper.cjs`), because it
imports `../web/lib/keeper.ts` and `../sdk`; npm packages load from `bot/node_modules`.

```bash
cd bot
pnpm install
pnpm build                         # bot + keeper typecheck + dist/keeper.cjs
KEEPER_SECRET_KEY='[12,34,…]' RPC_URL=https://api.devnet.solana.com pnpm keeper
pnpm keeper -- --once              # a single pass, then exit
```

| var | default | |
|---|---|---|
| `KEEPER_SECRET_KEY` | — (required) | fee payer: JSON array of 64 numbers (`solana-keygen` file) or base58. Use a dedicated key with a little SOL. |
| `RPC_URL` | devnet (mainnet on `NETWORK=mainnet-beta`) | needs `getProgramAccounts` (most private RPCs; the public one is rate-limited) |
| `KEEPER_INTERVAL_SECONDS` | `60` | seconds between passes (min 5) |
| `KEEPER_MAX_TX` | `40` | transactions per pass at most |
| `NOXVAULT_PROGRAM_ID` | from the IDL | only for a different deployment |

## Keeper on Railway

The keeper needs the whole repository (it builds from `sdk/` and `web/lib/`), so it is a
separate service from the notification bot:

1. New service → deploy from this repo, **Root Directory empty** (repository root).
2. Settings → Config-as-code file: `bot/railway.keeper.json` (builds `bot/Dockerfile.keeper`).
3. Variables: `KEEPER_SECRET_KEY`, `RPC_URL` (a private RPC), optionally
   `KEEPER_INTERVAL_SECONDS`. No volume, port or domain is needed.
4. Keep 1 replica. Watch the logs for `low balance` and top the key up.

## The Vercel cron instead

`web/vercel.json` calls `GET /api/keeper` once a day (Vercel Hobby only allows daily crons; on
Pro the schedule can be `* * * * *`, every minute). Set `CRON_SECRET` in the Vercel project:
Vercel sends it as `Authorization: Bearer …` and the route refuses anything else. It pays with
the site's relayer key (`RELAYER_SECRET_KEY`). Run the long-running keeper above when escapes,
schedules or testaments must not wait up to a day.
