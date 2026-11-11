# Noxvault browser extension (v0.2, wallet)

A Chrome / Brave extension (Manifest V3) that is a full wallet for Noxvault vaults, on **Solana devnet**.
Unaudited software: use test SOL only.

- **Onboarding like MetaMask**: create a 24-word phrase (shown blurred, revealed on click, three words
  confirmed) or import one; set a password. Several phrases ("accounts") under one password.
- **Create a vault** in the extension with the site's presets (Personal, Anti-theft, Team multisig, Slow
  treasury, Vesting, DAO) and settings (recovery key, whitelist, instant limit, delay, co-signer codes,
  testament, duress phrase). The one-time-key tree is built by the site's own worker
  (`web/lib/tree.worker.ts`). A recovery or duress phrase is **shown once, confirmed, and never stored**.
  Then fund + initialize: through the site's relayer (free, Guardian tier and ≥ 0.02 SOL), or paid by the
  account's fee account. Devnet: "Get test $NOX" calls the site's faucet (Sentinel tier).
- **Vault home**: SOL and token balances, rules, status, clocks, one-time keys left (warning under 20),
  open co-signer approvals, recent activity. The v0.1 alerts, badge and notifications keep running, also
  while locked.
- **Send** SOL or SPL tokens: form → review → sign → send. The review is the SDK's `preflightAction` plus
  a plain summary: destination, amount, fee, which one-time key, and whether it is **instant** or becomes
  a **pending payout** (and when it executes), with a red warning for a destination that is not on the
  whitelist. Fees: the relayer (the vault repays it, 0.0001 SOL; free for Sentinel vaults and lockdown
  cancels) or the fee account.
- **Pending payouts**: cancel with the recovery phrase, typed in for that one action and wiped afterwards,
  or with your own owner phrase. Execute a due payout (the fee account pays the network fee; the site's
  keeper also does this on its own). Lockdown shown with a countdown; the recovery cancel ends it.
- **Deposit**: address, copy, local QR. **Multiple vaults and accounts**: rename, remove, export the
  vault config (JSON), find a phrase's existing vaults on chain.
- **Settings**: network (devnet default; mainnet shown as "not live yet", signing off), custom RPC,
  auto-lock timer (5/15/30/60 min), alert interval, notifications, accounts, reveal phrase (password),
  lock now, reset.

Popup 380×600; long flows can be opened in a tab (⤢ button, `popup.html?tab=1`).

## Security model

| What | Where | How |
| --- | --- | --- |
| Account phrases (24 words) | `chrome.storage.local` key `keyring` | **Encrypted only**: AES-256-GCM with a 256-bit key from PBKDF2-HMAC-SHA256, **600 000 iterations**, a random 16-byte salt and a random 12-byte IV for every save, fixed AAD. WebCrypto. A blob with fewer iterations is refused. (`src/core/keyring.ts`) |
| Your password | nowhere | Typed, used to derive the key, dropped. Wrong passwords are counted; from the 5th in a row unlocking pauses 30 s, doubling to 15 min. |
| Master secrets while unlocked | `chrome.storage.session` key `unlocked` | In memory only (never on disk), cleared when the browser closes (and again on startup), readable only by the extension's own pages and service worker. (`src/core/session.ts`) |
| Auto-lock | service worker alarm, every minute | Removes the session after N minutes idle (setting, default 15). Pages close any screen that holds a secret when it locks. |
| Recovery and duress phrases | **never stored** | Generated in the page, shown once, confirmed, then dropped. Their trees are built without the tree cache. A recovery phrase typed in to cancel is read from the field once (the field is cleared), used for that cancel, and its secret seed is zeroed when the screen closes. |
| One-time key trees | IndexedDB `noxvault/trees` (extension origin) | **Public data only** (the site's own cache, `web/lib/trees.ts`): only the account phrases' signer trees. |
| Signing state | `chrome.storage.local` `pendingActions`, `attempted` | Public: which action is frozen for which one-time key, and whether something was sent for it. Written **before** signing / sending (port of `web/lib/unlock.ts`). |
| Fee account | derived, never stored | An ordinary Solana key: `seed = SHA-256("nox-ext/fee-account/v1" ‖ master)`. It only pays network fees and rent; it has no power over any vault. Keep a little SOL on it. |
| Vault configs | `chrome.storage.local` `watched[].config` | Public: the rules fixed in the vault address (the site keeps the same JSON as `nox3.config.<vault>`). |

Signing never leaves the page you are looking at: the tree, the WOTS signature and the transactions are
built in the extension page (popup or tab). The relayer on nox-vault.com receives only the finished,
public signature (exactly like the site) and the service worker never decrypts anything. JS strings
cannot be zeroed; byte arrays (masters, secret seeds) are zeroed after use where the code holds them.

One-time keys: the extension does not reinvent the WOTS logic. It imports the SDK (`../sdk`) and the
site's pure modules (`../web/lib/{unlock,configJson,presets,format,alerts/logic}.ts`, the tree worker) and
ports, line by line, the non-React parts of the site's `ActionPanel.tsx` (`src/core/signing.ts`) and
`SetupVault.tsx` (`src/core/create.ts`). Before every signature it reads the vault's whole history
(`findSignedMessages`) and the on-chain used bitmap (`pickLeaf`): a key that already published part of a
signature can only complete that same message; preflight runs before signing and the history is read
again right before the action is frozen.

## How it is built

| Path | What |
| --- | --- |
| `src/background.ts` | service worker: alarm → poll → notifications + badge; auto-lock; site import |
| `src/popup.ts`, `src/ui/*` | the app page (popup and tab): onboarding/lock, vaults, send/cancel, create/fund, settings |
| `src/core/keyring.ts`, `session.ts`, `wallet.ts` | encryption, the unlocked session, accounts |
| `src/core/signing.ts` | port of `web/components/vault/ActionPanel.tsx` (history → leaf → preflight → freeze → send) |
| `src/core/create.ts` | port of `web/app/create/SetupVault.tsx` (presets, validation, config, free vault number) |
| `src/core/trees.ts` | copy of `web/lib/trees.ts` (only the worker URL differs; a test guards the rest) |
| `src/core/pendingStore.ts` | the storage half of `web/lib/unlock.ts` on `chrome.storage.local` |
| `src/core/relayer.ts` | the site's `/api/relayer-info`, `/api/relay`, `/api/init`, `/api/faucet` |
| `src/core/feeAccount.ts`, `vaults.ts`, `timing.ts` | fee account, discovery / init / execute / activity, instant-vs-pending |
| `src/lib/*` | v0.1: chain snapshot, alerts, rules, status, QR, storage |
| `test/` | vitest: crypto storage, one-time-key tracking, parity with site/SDK, v0.1 logic |
| `scripts/` | esbuild build, zip, icons, smoke, screenshots, **e2e on devnet**, `run-ts.mjs` |

### Permissions (store-listing justifications)

| Permission | Why |
| --- | --- |
| `storage` | the encrypted keyring, vault list, settings, last snapshot per vault, alerts shown; `storage.session` holds the unlocked secret in memory |
| `alarms` | the background poll and the auto-lock check |
| `notifications` | alerts about pending payouts, lockdowns and inactivity clocks |
| host `api.devnet.solana.com`, `api.mainnet-beta.solana.com` | JSON-RPC: read vaults, send signed transactions |
| host `www.nox-vault.com/api/*` | the Noxvault relayer (gasless sending, vault initialization) and the devnet test-token faucet. Only public data is sent: finished signatures and public vault configs |
| optional host (asked at runtime, one host) | your custom RPC, if you set one |
| optional `scripting` + `nox-vault.com` (asked on Import) | read the names of the `nox3.config.<vault>` keys the site saved; never any value |

No remote code: everything is bundled, CSP `script-src 'self'`. Single purpose: "A wallet for Noxvault
vaults on Solana: create vaults, sign actions with one-time keys, and get alerts about pending payouts."

## Develop

```sh
cd extension
pnpm install
pnpm run build       # → dist/
pnpm test            # unit tests
pnpm exec tsc --noEmit
pnpm run zip         # build + noxvault-extension-<version>.zip
FUNDER=~/.config/solana/id.json node scripts/e2e.mjs   # full devnet run, screenshots → docs/v0.2/
```

`scripts/e2e.mjs` drives the real extension in Playwright's full Chromium (`--load-extension`): onboard →
create an Anti-theft vault → fund it and the fee account → initialize → send 0.06 SOL to a new address
(pending, 72 h) → cancel with the recovery phrase → send the rest home (instant) → return the fee
account's SOL. It writes `docs/v0.2/e2e-report.json` with every signature. `STOP=create` stops before
any SOL moves. Needs `npx playwright install chromium` once.

## Load it in Chrome or Brave

1. `pnpm install && pnpm run build`, then `chrome://extensions` → Developer mode → **Load unpacked** →
   `extension/dist`. Pin it.
2. Click the icon → create or import a phrase, set a password.
3. After a rebuild press the reload arrow on the extension's card.

## Publish on the Chrome Web Store

Same as v0.1 (pseudonymous developer account, US$5 one-time, non-trader): `pnpm run zip`, upload, fill in
the listing with the permission table above, "Remote code: No", data usage: nothing collected.
A wallet that holds keys gets a closer review; say "devnet, unaudited" in the description.

### Privacy statement

> **Noxvault extension privacy statement**
>
> The Noxvault extension has no accounts, analytics or servers of its own and collects no personal data.
>
> Stored only in your browser: your phrases, encrypted with your password (AES-256-GCM, PBKDF2-SHA256
> 600 000 iterations); vault addresses, labels and their public rules; settings; the last public state of
> each vault; which alerts were shown. While unlocked, the decrypted secret is kept in memory only.
> Recovery and duress phrases are never stored.
>
> Sent: JSON-RPC requests and signed transactions to the Solana RPC you choose (default
> `api.devnet.solana.com`), and, when you use them, finished signatures and public vault settings to the
> Noxvault relayer on www.nox-vault.com. Those services see your IP address. Your phrase and password are
> never sent anywhere. Uninstalling the extension deletes everything it stored.

## Next (not in v0.2)

- dApp connection provider (`window.solana` injection / Wallet Standard), so sites can request signatures.
- Hardware wallets.
- Staking, schedules, budgets, sealed letters, migrate and the Escape Hatch in the extension: deep-link to
  nox-vault.com for now ("Schedules, staking ↗").
- Mainnet (the program is on devnet only), Firefox packaging, token names / prices.
- Co-signer code generation (nox-vault.com/cosign) and showing approvals for slots other than your own.

## Known gaps and caveats (v0.2)

- Unaudited, devnet only. The extension inherits every limit of the program and the SDK.
- JavaScript strings (the typed phrase, the password) cannot be wiped from memory; byte arrays are.
- A recovery phrase typed into this browser is exposed to this browser for that moment. If you suspect
  the computer, cancel from another device.
- Signing runs in the open page: closing the popup mid-send is safe (the frozen action and the
  "attempted" marker make the next try complete the same message), but use the tab for long flows.
- Reading a vault's full history uses public RPC requests; heavy vaults may hit rate limits (then signing
  is blocked, never guessed). Use a custom devnet RPC.
- Alerts only arrive while the browser runs (MV3 service worker + `chrome.alarms`).
