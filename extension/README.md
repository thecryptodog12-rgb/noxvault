# Noxvault browser extension (v0.1, watch-only)

A Chrome / Brave extension (Manifest V3) that keeps an eye on your Noxvault vaults from the toolbar:

- **Watch vaults**: add vault addresses by hand, or import the vaults you created on nox-vault.com in
  this browser. Network: devnet (default), mainnet-beta, or a custom RPC.
- **Per vault**: SOL balance, token balances, rules (signers/threshold, withdrawal delay, instant
  limit, whitelist, recovery key, testament, one-time keys left) and status: pending withdrawal or
  migration (amount, destination, live countdown), lockdown, recovery and testament clocks, sealed letters.
- **Background alerts**: a service worker polls the chain every 1, 2 or 5 minutes (`chrome.alarms`).
  A new pending withdrawal, migration, lockdown, an inactivity clock under 14/3/1 days or a letter
  opening within a week fires one desktop notification, e.g.
  `⚠️ 42 SOL wants to leave vault 8Hk2…: executes in 2 days 23 h. Not you? Cancel with your recovery phrase.`
  The red badge counts what still needs attention. Each event notifies once. Clicking opens the
  right page on nox-vault.com (`/recovery?vault=…` for cancel / lockdown, `/mine` for the owner).
- **Deposit**: the vault address with copy button and a QR code generated locally.

Signing, withdrawing and cancelling stay on [nox-vault.com](https://www.nox-vault.com): the WOTS+
signing UI lives there and the extension only deep-links to it. **The extension never asks for, reads
or stores a phrase or key.** Noxvault runs on Solana devnet and is unaudited.

## How it is built

| Path | What |
| --- | --- |
| `src/background.ts` | service worker: alarm → poll → notifications + badge; site import |
| `src/popup.ts`, `public/popup.html`, `public/popup.css` | popup UI (plain DOM), 380×600 |
| `src/lib/chain.ts` | reads one vault with the SDK (`../sdk/client`: `fetchState`, `vaultSchedules`, `vaultLetters`, …) |
| `src/lib/alerts.ts` | wraps the site's alert rules (`../web/lib/alerts/logic.ts` `alertsFor`) for desktop notifications, dedupe, badge |
| `src/lib/rules.ts`, `status.ts`, `net.ts`, `qr.ts` | pure display logic, address checks, deep links, local QR |
| `test/` | vitest unit tests for all pure logic |
| `scripts/` | esbuild build, zip, icon render, devnet smoke test, Playwright screenshots |

The SDK and the alert logic are imported from the repo (`../sdk`, `../web/lib/alerts/logic.ts`), not
copied. Their bare imports resolve against `extension/node_modules`, so the bundle has one pinned copy
of web3.js / Anchor. Fonts (JetBrains Mono, OFL) are bundled; MV3 forbids remote code and the CSP is
`script-src 'self'`.

### Permissions

| Permission | Why |
| --- | --- |
| `storage` | watched addresses, labels, settings, last snapshot per vault, which alerts were shown |
| `alarms` | the background poll |
| `notifications` | the alerts |
| host `api.devnet.solana.com`, `api.mainnet-beta.solana.com` | read-only JSON-RPC |
| optional host (asked at runtime, one host at a time) | your custom RPC, if you set one |
| optional `scripting` + `nox-vault.com` (asked when you click Import) | read the names of the `nox3.config.<vault>` keys the site saved; never any value |

## Develop

```sh
cd extension
pnpm install
pnpm run build      # → dist/
pnpm test           # unit tests
pnpm run typecheck
node scripts/smoke.mjs            # read every devnet vault through the extension's chain code
pnpm run screenshot               # full Chromium + dist/ → docs/*.png (needs `npx playwright install chromium`)
pnpm run zip                      # build + noxvault-extension-<version>.zip for the Web Store
```

## Load it in Chrome or Brave ("Load unpacked")

1. `cd extension && pnpm install && pnpm run build`
2. Open `chrome://extensions` (Brave: `brave://extensions`).
3. Switch on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `extension/dist` folder.
5. Pin it: puzzle-piece icon in the toolbar → pin **Noxvault**.
6. Click the icon → **+ Add vault address** (or **Import from site** if you created vaults on
   nox-vault.com in this browser). macOS: allow Chrome notifications in System Settings →
   Notifications, or the alerts stay silent.

After a rebuild, press the reload arrow on the extension's card in `chrome://extensions`.

## Publish on the Chrome Web Store

The owner does this once, under the project's pseudonymous Google account (thecryptodog12 / Noxvault),
not a personal one.

1. Register as a Chrome Web Store developer: <https://chrome.google.com/webstore/devconsole>. One-time
   **US$5** registration fee. Use the pseudonymous account; set the publisher display name to
   "Noxvault". Google may ask to verify an email address and, for some regions, a physical address that
   is not shown publicly for non-trader accounts; declare **non-trader** (no sales).
2. `cd extension && pnpm run zip` → `noxvault-extension-<version>.zip`.
3. Dev console → **New item** → upload the zip.
4. **Store listing**: name "Noxvault", short description (from the manifest), category "Tools" (or
   "Productivity"), language English. Upload the 128×128 icon (`public/icons/icon-128.png`) and at
   least one 1280×800 or 640×400 screenshot (frame the popup shots in `docs/` on an ink background).
   Homepage: https://www.nox-vault.com.
5. **Privacy practices** tab:
   - Single purpose: "Watch Noxvault vault addresses on Solana and alert the user to pending
     withdrawals, lockdowns and inactivity clocks."
   - Justify each permission with the table above.
   - Remote code: **No**.
   - Data usage: tick nothing (no data collected); certify the three disclosures.
   - Privacy policy URL: publish the statement below on the site (e.g. `/extension-privacy`) and link it.
6. **Distribution**: Public (or Unlisted for a first round), all regions.
7. Submit for review. First reviews usually take a few days; `optional_host_permissions: https://*/*`
   (only for a custom RPC) can draw extra questions; answer with the custom-RPC justification.

Updates: bump `version` in `package.json`, `pnpm run zip`, upload the new zip on the same item.

### Privacy statement (for the store listing and the site)

> **Noxvault extension privacy statement**
>
> The Noxvault extension is watch-only. It does not collect, sell or share any personal data, and it
> has no analytics, accounts or servers of its own.
>
> What it stores, only in your browser (`chrome.storage.local`): the vault addresses and labels you
> add, your settings (network, custom RPC URL, check interval, notifications on/off), the last public
> on-chain state of each watched vault, and which alerts it has already shown you.
>
> What it sends: read-only JSON-RPC requests for your watched vault addresses to the Solana RPC
> endpoint you choose (by default `api.devnet.solana.com`, or `api.mainnet-beta.solana.com`, or a
> custom RPC you enter). That RPC provider sees those requests and your IP address, as with any
> Solana wallet or explorer.
>
> If you use "Import from nox-vault.com", the extension reads only the names of the vault entries that
> nox-vault.com saved in this browser, to learn their addresses. It never reads, asks for or stores a
> recovery phrase, owner phrase or any private key. Noxvault never asks for your phrase in the
> extension; if anything does, it is not us.
>
> Links in the extension open pages on www.nox-vault.com, which has its own privacy terms.
> Uninstalling the extension deletes everything it stored.

## Known gaps (v0.1)

- Watch-only: no signing in the extension by design. Cancel / withdraw happen on nox-vault.com.
- `/recovery?vault=` is passed but the current recovery page does not prefill the address from it yet.
- The program is on devnet only; mainnet-beta shows "not a vault" for every address until a mainnet launch.
- Token balances show the mint address, not a token name or price.
- Public RPCs rate-limit (each vault costs about six reads per check). With many vaults, use a custom RPC
  or a 5-minute interval.
- Alerts only arrive while the browser is running (MV3 service worker + `chrome.alarms`).
- Firefox is not packaged yet (MV3 there uses `background.scripts`).
