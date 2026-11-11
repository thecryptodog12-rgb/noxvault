# Noxvault browser extension (v0.3, everyday wallet + vaults)

A Chrome / Brave extension (Manifest V3): an everyday Solana wallet like Phantom (holdings, prices, send,
receive) **plus** Noxvault vaults, which you can create straight from a wallet. Unaudited software.
Wallet accounts work on mainnet; vaults run on **devnet only** ("not live on mainnet yet").

## v0.3: wallet accounts

- **Home like Phantom**: account switcher at the top, total value (USD on mainnet, with the 24 h change),
  big Receive / Send / Protect buttons, tabs **Wallet** (holdings, activity) and **Vaults** (the v0.2 vault
  list, marked "devnet · unaudited"). Network switch mainnet / devnet for the wallet view.
- **Wallet accounts** are ordinary ed25519 Solana keys, derived from your 24-word phrase the standard way
  (BIP39 seed → SLIP-0010 ed25519, path `m/44'/501'/i'/0'`), so the same phrase shows the same addresses
  in Phantom / Solflare (unit-tested against the published "abandon … about" vector and against
  `ed25519-hd-key`). Add more accounts (next index), rename, switch, address + QR.
- **Import** an existing wallet: a 12–24 word BIP39 phrase from Phantom etc. (+ account index), or a
  private key (Phantom's base58 export or a solana-keygen JSON array). Stored encrypted like the phrase.
  **Watch** any address read-only.
- **Holdings**: SOL + every SPL and Token-2022 balance, names / symbols / logos (bundled list of well-known
  tokens, Jupiter token data on mainnet, Metaplex metadata and the Token-2022 metadata extension on chain,
  cached), USD prices and 24 h change from Jupiter's price API v3 (mainnet only), "hide zero & spam"
  toggle (on mainnet a token Jupiter cannot price counts as spam). Activity: the last transactions, read
  as sent / received SOL or a token, or "interaction".
- **Send** SOL and SPL / Token-2022: creates the recipient's token account when needed, priority fee from
  recent fees, compute limit from a simulation, **simulated before signing**, a confirmation screen with
  amount, USD value, fee, rent and total SOL out, address validation (refuses token accounts, your own
  address, a phrase pasted as address; warns for program addresses, someone else's vault, a never-used
  address; says "this is your vault: a deposit"). Max sends everything minus the exact fee. Signed once,
  sent once, never re-sent automatically. No swaps yet.
- **Quantum exposure on every wallet**: "This wallet is exposed: its address is its public key", with the
  level from the site's scanner logic (`web/lib/exposure.ts` `riskOf`) and a **Protect it** button.
- **Protect it** → pick a preset (the same presets) → the vault is built (the v0.2 create flow) → **the
  wallet pays the creation fee and rent and initializes it in one transaction, no relayer** → "move funds
  in" (pre-filled with the wallet's balances, keeps 0.005 SOL for fees, creates the vault's token
  accounts). Every vault page has **Deposit from wallet**. The selected wallet is now the **default payer**
  for vault actions when it holds ≥ 0.005 devnet SOL; the relayer is the fallback.
- **Settings**: wallet network, own mainnet RPC, wallet accounts; per account: export the private key
  behind the password (blurred until clicked, strong warning; never a vault phrase beyond the existing
  reveal); "Connected sites" placeholder (no dApp connection yet).

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
| Wallet accounts (v0.3) | derived, never stored; seeds in `chrome.storage.session` while unlocked | Ordinary ed25519 keys: BIP39 `mnemonicToSeed(words)` → SLIP-0010 `m/44'/501'/i'/0'`. Public facts (name, address, index) in `chrome.storage.local` `wallets`. **Not quantum-safe** (see below). |
| Imported wallets (v0.3) | inside the encrypted `keyring` (`imports[]`) | The imported phrase + index, or the 32-byte key seed, encrypted with the same AES-256-GCM / PBKDF2 600k blob as your phrase. Never in plaintext on disk (tested). Export of a wallet's private key needs the password every time. |
| v0.2 fee account | derived, never stored | `seed = SHA-256("nox-ext/fee-account/v1" ‖ master)`. A phrase from a v0.2 install keeps it, listed as the wallet account "Fee account (v0.2)", so its SOL is never stranded (select it, send its SOL elsewhere, or keep using it as payer). New phrases do not get one. |
| Vault configs | `chrome.storage.local` `watched[].config` | Public: the rules fixed in the vault address (the site keeps the same JSON as `nox3.config.<vault>`). |

### Wallet accounts: hot-wallet caveat and key separation

- **Wallet accounts are ordinary hot-wallet keys and NOT quantum-safe.** Their address is their ed25519
  public key; a future quantum computer could derive the private key from it, and malware in this browser
  could take them like any browser wallet. Only **vaults** are quantum-safe (hash-based WOTS+ one-time
  keys, checked on chain) and only vaults have delays, whitelists and recovery. That is what Protect is
  for. This extension is unaudited; wallet accounts can hold real mainnet funds: keep amounts small.
- **Is the 24-word Noxvault phrase valid BIP39?** Yes: it is `entropyToMnemonic` of the 32-byte master
  (sdk `secretToWords`), with the BIP39 checksum. So Phantom accepts it and derives the same addresses.
- **Why the wallet keys cannot collide with or weaken the WOTS keys.** The WOTS trees use the 32-byte
  *entropy* with SHA-256 and their own prefixes (`nox2/sk`, `nox2/pk` + vault number; recovery / duress in
  separate index ranges); the v0.2 fee account uses `SHA-256("nox-ext/fee-account/v1" ‖ entropy)`. The
  wallet keys use PBKDF2-HMAC-SHA512 over the mnemonic *sentence* (salt `"mnemonic"`, 2048 rounds) and
  then the HMAC-SHA512 chain keyed `"ed25519 seed"` (SLIP-0010, hardened only). Different functions on
  different inputs: the outputs are independent (a unit test checks they never coincide), and every step is
  one-way, so a leaked or exported wallet key reveals nothing about the master, the WOTS keys or the other
  accounts. An extra domain prefix of our own would have broken Phantom compatibility, so none is added;
  the separation comes from BIP39/SLIP-0010 already being a different derivation family.
- **Caveat: the same phrase in Phantom.** Typing your Noxvault phrase into another wallet gives that
  wallet your vault master too (it is the same 24 words). Prefer: keep the Noxvault phrase only here, and
  import your *other* wallets into this extension instead (Accounts → Import wallet).
- A 12-word wallet phrase cannot hold vault keys (a vault master is 32 bytes); it can only be imported as
  a wallet account. No BIP39 passphrase ("25th word") support yet.

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
| `src/core/hd.ts` (v0.3) | BIP39 + SLIP-0010 ed25519 derivation (`m/44'/501'/i'/0'`), import parsing, key export format |
| `src/core/holdings.ts`, `activity.ts`, `transfer.ts` (v0.3) | balances + token metadata + Jupiter prices; activity parsing; send / deposit transactions, recipient checks, simulation |
| `src/ui/wallet.ts` (v0.3) | home, wallet accounts, receive, send, Protect, deposit from wallet |
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
| host `lite-api.jup.ag/*` (v0.3) | token prices (price API v3) and token names / logos (token search) for the wallet view, mainnet only. The list of mints you hold is sent; never an address or key |
| `declarativeNetRequestWithHostAccess` (v0.3) | one rule: drop the `Origin: chrome-extension://…` header on this extension's own requests to `api.mainnet-beta.solana.com`, which otherwise answers 403 to extensions. Affects no other site and no request of any web page |
| optional host (asked at runtime, one host) | your custom devnet RPC or your own mainnet RPC, if you set one |
| optional `scripting` + `nox-vault.com` (asked on Import) | read the names of the `nox3.config.<vault>` keys the site saved; never any value |

No remote code: everything is bundled, CSP `script-src 'self'`. Single purpose: "A Solana wallet
with Noxvault vaults: hold, send and receive tokens, move them into quantum-safe vaults, sign vault actions
with one-time keys, and get alerts about pending payouts."

## Develop

```sh
cd extension
pnpm install
pnpm run build       # → dist/
pnpm test            # unit tests
pnpm exec tsc --noEmit
pnpm run zip         # build + noxvault-extension-<version>.zip
FUNDER=~/.config/solana/id.json node scripts/e2e-v03.mjs   # v0.3 wallet run, screenshots → docs/v0.3/
FUNDER=~/.config/solana/id.json node scripts/e2e.mjs       # v0.2 vault run (anti-theft, cancel), → docs/v0.2/
```

`scripts/e2e-v03.mjs`: onboard → wallet #1 checked to be `m/44'/501'/0'/0'` of the phrase (independent
implementation) and nothing secret on disk → fund it with 0.12 devnet SOL → holdings → Send 0.01 SOL →
activity → Protect it: Personal vault, initialized by the wallet (the script checks the wallet is the fee
payer) → move 0.03 SOL in → the vault shows it → withdraw it with one-time keys, the wallet paying (default
payer) → import the public "abandon … about" test phrase (→ `HAgk14Jp…Kpqk`) → export-key screen →
settings → Send Max back to FUNDER → read-only mainnet holdings of a large public wallet, with prices. On a
failure it sweeps the test wallet back to FUNDER. `STOP=home` stops before any SOL moves. Report with every
signature: `docs/v0.3/e2e-report.json`. (`scripts/e2e.mjs` was adapted to v0.3, where the wallet account
pays instead of the v0.2 fee account, but was not re-run for v0.3.)

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
> each vault; which alerts were shown; your wallet accounts' public addresses and names; imported wallet
> keys, inside the same encrypted blob; cached token names. While unlocked, the decrypted secrets are kept in
> memory only. Recovery and duress phrases are never stored.
>
> Sent: JSON-RPC requests and signed transactions to the Solana RPC you choose (default
> `api.devnet.solana.com`), and, when you use them, finished signatures and public vault settings to the
> Noxvault relayer on www.nox-vault.com. For the wallet view on mainnet: the list of token mints you hold
> is sent to Jupiter (lite-api.jup.ag) for prices and token names; your address is not. Token logos are
> loaded from the image hosts Jupiter and the bundled token list name (no referrer is sent); off-chain
> metadata URIs of tokens are never fetched. Those services see your IP address. Your phrases, keys and
> password are never sent anywhere. Uninstalling the extension deletes everything it stored.

## Next (not in v0.3)

- dApp connection provider (`window.solana` injection / Wallet Standard), so sites can connect and request
  signatures (the "Connected sites" settings panel is a placeholder until then).
- Swaps (e.g. Jupiter), NFTs / collectibles, native staking, hardware wallets (Ledger).
- BIP39 passphrase for imported phrases; address book; token-account cleanup (close empty accounts).
- Staking, schedules, budgets, sealed letters, migrate and the Escape Hatch in the extension: deep-link to
  nox-vault.com for now ("Schedules, staking ↗").
- Vaults on mainnet (the program is on devnet only), Firefox packaging.
- Co-signer code generation (nox-vault.com/cosign) and showing approvals for slots other than your own.

## Known gaps and caveats

- Unaudited. Vaults are devnet only. The extension inherits every limit of the program and the SDK.
- v0.3 wallet accounts are hot-wallet keys (see the security model): not quantum-safe, and as exposed to
  this browser as any browser wallet. Token-2022 tokens with transfer hooks or transfer fees are not
  handled specially (the simulation refuses what would fail).
- Holdings and activity use the public mainnet RPC unless you set your own; it rate-limits busy IPs and
  does not serve very large wallets well. Prices exist only for tokens Jupiter can price; on mainnet an
  unpriced token is treated as spam and hidden by default (switch the toggle to see it).
- Activity parsing is simple (one asset in or out = sent / received; everything else "interaction").
- JavaScript strings (the typed phrase, the password) cannot be wiped from memory; byte arrays are.
- A recovery phrase typed into this browser is exposed to this browser for that moment. If you suspect
  the computer, cancel from another device.
- Signing runs in the open page: closing the popup mid-send is safe (the frozen action and the
  "attempted" marker make the next try complete the same message), but use the tab for long flows.
- Reading a vault's full history uses public RPC requests; heavy vaults may hit rate limits (then signing
  is blocked, never guessed). Use a custom devnet RPC.
- Alerts only arrive while the browser runs (MV3 service worker + `chrome.alarms`).
