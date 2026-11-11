# Vault alerts: Web Push, Telegram and the 10-minute check

Goal: if someone gets your phrase and starts a withdrawal, you hear about it on your phone or
desktop and have 72 hours to cancel it with your recovery phrase.

The on-chain part already exists. A vault with a daily instant limit and a slow delay puts larger
payouts into a public pending state (`gate` in `programs/noxvault/src/lib.rs`), and the recovery
tree can always approve a Cancel (`authorize`). The **Anti-theft** preset in Create sets this up for
a personal vault. This document covers the part that tells you in time.

Devnet, unaudited. Alerts are a convenience on top of the on-chain delay, not a guarantee: a check
can be late or fail, so do not rely on them alone.

## Pieces

| piece | file |
|---|---|
| Anti-theft preset | `web/lib/presets.ts`, `applyPreset` in `web/app/create/SetupVault.tsx` |
| "Warn me on this device" button | `web/components/vault/PushAlerts.tsx` (on `/t/<vault>`, in the vault view, and after creating a vault) |
| subscribe / unsubscribe API | `web/app/api/push/route.ts` (`POST /api/push`) |
| push logic (pure): subscription checks, alert → notification | `web/lib/alerts/push.ts` (tests: `push.test.ts`) |
| sending (VAPID, `web-push`) | `web/lib/alerts/webpush.ts` |
| Redis storage (`PushStore`, next to the Telegram `AlertStore`) | `web/lib/alerts/store.ts` |
| alert pass for Telegram and push | `web/app/api/telegram/cron/route.ts` |
| notification display and click | `web/public/sw.js` (`push`, `notificationclick`, `pushsubscriptionchange`) |
| 10-minute schedule | `.github/workflows/alerts.yml` |
| Telegram bot | `docs/TELEGRAM_BOT.md` |

## How it works

1. On a vault page the user taps **Warn me on this device**. The browser asks for notification
   permission and makes a push subscription for this site with the VAPID public key.
2. The page posts `{ action: "subscribe", vault, subscription }` to `/api/push`. The server checks
   the endpoint belongs to a known push service (Google FCM, Mozilla, Apple, Microsoft), checks the
   vault is a Noxvault, stores it and sends a test notification. At most 5 vaults per device.
3. The alert pass reads every vault watched on Telegram or by push, runs the same `alertsFor` as the
   bot, and sends each alert to each chat and each device **once**: the dedupe key is the same alert
   key, claimed per recipient with `SET NX`.
4. Tapping a notification about a pending withdrawal opens `/recovery?vault=<vault>` with the address
   filled in, where the recovery phrase can cancel it. Other alerts open `/t/<vault>`.
5. A subscription the push service answers with 404 or 410 (expired, permission revoked) is deleted.
   When the browser replaces a subscription, the service worker reports it and the vaults move over.

Redis keys (prefix `nox:push:`): `sub:<id>` (subscription JSON), `subvaults:<id>` (vaults of a
device), `watchers:<vault>` (devices of a vault), `vaults` (all vaults with push watchers),
`sent:<id>:<vault>:<alert key>` (120-day TTL). `<id>` is a hash of the endpoint URL. The vault
snapshot `nox:tg:snap:<vault>` is shared with the Telegram bot.

iPhone and iPad only support web push for sites added to the home screen (iOS 16.4 and later). The
button shows that hint on iOS when the site is open in a normal Safari tab.

## Setup (owner)

Nothing below has been done yet. Redis (Upstash, `KV_REST_API_URL` / `KV_REST_API_TOKEN`) and
`CRON_SECRET` are the same as for the Telegram bot: see `docs/TELEGRAM_BOT.md` steps 2 and 3.
Push works without the Telegram bot and the other way round.

### 1. VAPID keys

```sh
cd web
npx web-push generate-vapid-keys
```

This prints a public and a private key. Never commit the private key and never put it in a
`NEXT_PUBLIC_` variable.

```sh
cd web
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY production   # the public key (build-time: redeploy after)
vercel env add VAPID_PRIVATE_KEY production              # the private key (sensitive)
vercel env add VAPID_SUBJECT production                  # e.g. mailto:alerts@<your domain> or https://www.nox-vault.com
```

`VAPID_SUBJECT` is optional (default `https://www.nox-vault.com`); push services use it to contact
the sender. Keep the same key pair for good: a new pair invalidates every existing subscription.

Then redeploy production. Until both keys are set, the button says push is not set up and
`/api/push` answers 503.

### 2. Run the alert pass every 10 minutes (GitHub Actions)

`web/vercel.json` keeps the daily Vercel cron (Hobby limit). A daily check is too slow for a 72 h
window, so `.github/workflows/alerts.yml` calls the same route every 10 minutes.

1. Push this repository to GitHub (the workflow only runs from the default branch).
2. Repository → Settings → Secrets and variables → Actions → **New repository secret**:
   - `ALERTS_CRON_URL`: `https://www.nox-vault.com/api/telegram/cron` (production domain; previews are
     behind Vercel Authentication)
   - `CRON_SECRET`: the same value as the `CRON_SECRET` env var on Vercel
3. Actions tab → **alerts** → **Run workflow** once, and check the log shows a line like
   `{"vaults":1,"read":1,"sent":0,"pushed":0,"failed":0,"errors":0}`.

Notes:
- The log prints counts only, because the full report lists watched vault addresses and Actions
  logs of a public repository are public.
- GitHub runs scheduled workflows on a best-effort basis: runs can start several minutes late or
  be skipped under load. That is still far inside 72 h.
- In a public repository GitHub disables scheduled workflows after 60 days without repository
  activity; it emails the owner first. Re-enable it in the Actions tab, or push a commit.
- The workflow exits quietly when the secrets are missing, so forks do not fail.
- Any other scheduler works too: `curl -fsS -H "Authorization: Bearer <CRON_SECRET>" https://www.nox-vault.com/api/telegram/cron`.

### 3. Test

1. Open `https://www.nox-vault.com/t/<vault>` on a phone (on iPhone: Share → Add to Home Screen,
   then open it from there), tap **Warn me on this device** and allow notifications. A test
   notification arrives within seconds.
2. On a devnet test vault made with the Anti-theft preset, start a withdrawal above the 0.05 SOL daily
   limit. Within about 10 minutes the device gets "Pending withdrawal"; tapping it opens the recovery
   page with the vault filled in.
3. A manual pass: `curl -sS -H "Authorization: Bearer <CRON_SECRET>" https://www.nox-vault.com/api/telegram/cron`
   returns `{"vaults":N,"read":N,"sent":N,"pushed":N,"failed":0,"errors":[]}`.

## Environment variables

| variable | where | needed for |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel (public, build time) | push |
| `VAPID_PRIVATE_KEY` | Vercel (secret) | push |
| `VAPID_SUBJECT` | Vercel, optional | push |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel (Upstash integration) | push and Telegram |
| `CRON_SECRET` | Vercel and GitHub secret | the alert pass |
| `ALERTS_CRON_URL` | GitHub secret | the 10-minute workflow |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Vercel | Telegram only |

## Privacy and limits

- The server stores the device's push endpoint and keys with the vault address. Nothing else: no
  phrase, no key, no wallet. Whoever has a device's endpoint can turn its alerts on or off.
- Google, Mozilla, Apple or Microsoft (whichever push service the browser uses) delivers the
  notification and sees that this site sent one to that device. The content is encrypted to the device.
- Vault state is public, so anyone can turn on alerts for any vault.
- Alerts never cancel anything. You still cancel with your recovery phrase.
- Each pass reads every watched vault (see the RPC note in `docs/TELEGRAM_BOT.md`); runs are capped
  at 60 s.
