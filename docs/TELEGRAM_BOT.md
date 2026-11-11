# Telegram alerts bot

The bot runs inside the Next.js app on Vercel: a webhook (`/api/telegram`) answers commands, and a
cron route (`/api/telegram/cron`) reads every watched vault and sends alerts. It only reads public
on-chain data; it holds no Solana keys and sends no transactions.

The same cron pass also sends Web Push notifications to devices that turned on "Warn me on this
device"; see `docs/ALERTS.md`. The route needs `TELEGRAM_BOT_TOKEN` or the VAPID keys (or both).

| piece | file |
|---|---|
| webhook (commands) | `web/app/api/telegram/route.ts` |
| alert pass (cron) | `web/app/api/telegram/cron/route.ts` |
| pure logic: snapshot diff → messages, commands | `web/lib/alerts/logic.ts` (tests: `logic.test.ts`) |
| chain reads | `web/lib/alerts/chain.ts` |
| Redis storage | `web/lib/alerts/store.ts` |
| info page | `web/app/alerts/page.tsx` (`/alerts`) |

## Commands

- `/start`, `/help`: what the bot does. It never asks for a phrase; a message that looks like a
  12+ word phrase gets a warning to delete it.
- `/watch <vault>`: subscribe this chat (must be an initialized Noxvault; max 5 per chat).
- `/unwatch <vault>`, `/list`.
- `/status <vault>`: balance, pending payout, lockdown, recovery and testament clocks, letter dates.
  Works without storage.

## Alerts

Each alert has a dedupe key that includes the event's own timestamp, stored per chat with
`SET NX` (`nox:tg:sent:<chat>:<vault>:<key>`, 120-day TTL), so each chat gets each event once:

| alert | key |
|---|---|
| new pending withdrawal (or migration) | `pending:<executableAt>:<dest>:<amount>:<mint>` |
| lockdown started / extended (duress used) | `lockdown:<lockdownUntil>` |
| recovery / testament within 14, 3, 1 days | `recovery:<at>:<step>`, `testament:<at>:<step>` |
| inactivity period passed | `recovery:<at>:open`, `testament:<at>:open` |
| sealed letter opening within 7 days | `letter:<id>:<unlockRound>` |
| schedule ran (diff with previous snapshot) | `schedule:<id>:<remaining>`, `schedule:<id>:gone:<remaining>` |

A ping moves `lastActive`, so the deadline changes and the warnings start over. A chat that
starts watching later still gets current alerts (a pending withdrawal, a lockdown).

## Setup (owner)

Nothing below has been done yet. Run from the repo root unless noted.

### 1. Create the bot

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`
   (e.g. `NoxvaultAlertsBot`). BotFather replies with the **bot token**.
2. Optional, so the command menu shows in Telegram: send `/setcommands`, pick the bot, paste:
   ```
   start - What this bot does
   watch - Watch a vault: /watch <vault>
   unwatch - Stop watching: /unwatch <vault>
   list - Vaults this chat watches
   status - Vault status: /status <vault>
   ```
3. Optional: `/setdescription` with "Alerts for Noxvault vaults. Never send your phrase to anyone."

### 2. Storage: Upstash Redis from the Vercel Marketplace

In the Vercel dashboard, project **solplay/noxvault** → Storage → Create → **Upstash for Redis**
(free tier is enough), connect it to the project for Production and Preview. That sets
`KV_REST_API_URL` and `KV_REST_API_TOKEN` (and a few other `KV_*` vars) automatically.
Check with `cd web && vercel env ls`.

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work if you use your own Upstash database.

### 3. Environment variables

```sh
cd web
# the token from BotFather
vercel env add TELEGRAM_BOT_TOKEN production
# a random secret Telegram sends back on every webhook call (A-Z, a-z, 0-9, _ and -; up to 256 chars)
openssl rand -hex 32 | tee /dev/stderr | vercel env add TELEGRAM_WEBHOOK_SECRET production
# the bot's username without @, shown on /alerts (a public build-time var: redeploy after setting)
vercel env add NEXT_PUBLIC_TELEGRAM_BOT production
```

`CRON_SECRET` is already used by `/api/keeper`; the telegram cron uses the same one. If it is not
set yet: `openssl rand -hex 32 | vercel env add CRON_SECRET production`. Vercel sends it as
`Authorization: Bearer <CRON_SECRET>` to cron routes.

Optional: `NEXT_PUBLIC_SITE_URL` (default `https://www.nox-vault.com`) for links in messages.

Then redeploy production so the variables take effect.

### 4. Point Telegram at the webhook

After the deploy is live (replace the token, secret and domain):

```sh
curl -sS "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d url=https://www.nox-vault.com/api/telegram \
  -d secret_token=<TELEGRAM_WEBHOOK_SECRET> \
  -d 'allowed_updates=["message"]' \
  -d drop_pending_updates=true
# check:
curl -sS "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Use the production domain, not a preview URL: preview deployments are behind Vercel
Authentication and Telegram cannot reach them.

### 5. The cron schedule

`web/vercel.json` runs `/api/telegram/cron` **once a day** (`7 8 * * *`), because the Vercel
team is on the **Hobby** plan, where cron jobs may run at most once per day; a more frequent
expression makes the deployment fail. The intended schedule is every 15 minutes:

- **On Vercel Pro:** change the schedule to `*/15 * * * *` in `web/vercel.json`.
- **On Hobby:** keep the daily entry and call the route every 15 minutes from an external
  scheduler (cron-job.org, a GitHub Actions `schedule`, or any server's crontab):
  ```sh
  curl -fsS -H "Authorization: Bearer <CRON_SECRET>" https://www.nox-vault.com/api/telegram/cron
  ```

With only the daily run, an alert can arrive up to a day late. That is still in time for the
14/3/1-day warnings and for pending withdrawals with a delay above 24 h, but not for shorter delays.

The repository ships `.github/workflows/alerts.yml`, which calls the route every 10 minutes from
GitHub Actions. It needs two repository secrets, `ALERTS_CRON_URL` and `CRON_SECRET`: setup in
`docs/ALERTS.md`, step 2.

### 6. Test

```sh
# manual alert pass; returns {"vaults":N,"read":N,"sent":N,"failed":0,"errors":[]}
curl -sS -H "Authorization: Bearer <CRON_SECRET>" https://www.nox-vault.com/api/telegram/cron
```

Then in Telegram: `/start`, `/watch CGiG5w5aiiMSNq2bJfjQ1rJuxcHGrTGDXs3wrR4FLc2V`, `/status …`.

## Limits

- One `getProgramAccounts` per vault per run for schedules and one for letters, plus two account
  reads; on the public devnet RPC this is fine for dozens of vaults. Set `NEXT_PUBLIC_RPC_URL`
  to a paid RPC before it grows.
- Cron runs are capped at 60 s; vaults are read four at a time.
- Chats that block the bot are removed on the next failed send.
- Privacy: vault state is public, so anyone can watch any vault. Telegram and the Redis database
  see which chat watches which vault.
