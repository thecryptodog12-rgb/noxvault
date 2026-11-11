# @noxvault/sdk

TypeScript SDK for [Noxvault](https://www.nox-vault.com): quantum-resistant vaults on Solana. A vault is
a program-derived address whose owner keys are WOTS+ hash-based one-time signatures in Merkle trees,
so spending from it does not rely on ed25519. The SDK holds everything a client needs: the program id
and IDL, vault and state addresses, account decoders, the signing and action planner, the relayer
checks, and simple deposit ("fund") instructions for wallets and apps.

> **Devnet only, unaudited.** The program (`8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4`) runs
> on Solana devnet and is still upgradeable. This SDK follows program v4.2; the recovery action
> `cancelLock` works only once devnet runs v4.2 (check with `supportsCancelLock`). It has had an internal review, not an external audit.
> Do not put funds you cannot afford to lose into a vault. See the [risks](https://www.nox-vault.com/risks)
> and the [docs](https://www.nox-vault.com/docs).

## Install

```sh
npm install @noxvault/sdk @solana/web3.js @coral-xyz/anchor @solana/spl-token
```

`@solana/web3.js` (1.x), `@coral-xyz/anchor` (0.31) and `@solana/spl-token` (0.4) are peer
dependencies, so your app and the SDK share one copy. The package ships ESM and CommonJS builds with
type declarations. In a browser bundle, provide a `Buffer` polyfill as you would for web3.js.

## Quick start

### Program, IDL and a read-only client

```ts
import { Connection } from "@solana/web3.js";
import { PROGRAM_ID, idl, readProgram, type Noxvault } from "@noxvault/sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const program = readProgram(connection); // Program<Noxvault>, no wallet needed
console.log(PROGRAM_ID.toBase58()); // 8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4
```

The raw IDL is also available as JSON: `import idlJson from "@noxvault/sdk/idl.json"`.

### Derive a vault address from its config

A vault's address is a pure function of its config (its key roots and rules): `vaultOf(config)`.

```ts
import { newMasterSecret, secretToWords, makeSigner, makeConfig, vaultOf, statePda, DAY } from "@noxvault/sdk";

const master = newMasterSecret(); // 32 random bytes
const words = secretToWords(master); // the 24-word phrase the owner writes down
const owner = makeSigner(master, 0, 0); // vault #0, signer slot 0 (builds 256 one-time keys)
const config = makeConfig(owner, { slowDelaySecs: 2 * DAY });
const vault = vaultOf(config); // the address to fund
const state = statePda(vault); // the account that holds the rules and the used-key bitmap
```

Creating the vault on chain is `initVaultIx(program, payer, config)`; the [web app](https://www.nox-vault.com/create)
does this for you.

### Read a vault

```ts
import { PublicKey } from "@solana/web3.js";
import { fetchState, inLockdown, keysLeft, TREE_PRIMARY } from "@noxvault/sdk";

const vault = new PublicKey("<vault address>");
const state = await fetchState(program, vault); // null if this is not a Noxvault
if (state) {
  console.log(state.config.threshold, state.config.whitelist.length, state.pending);
  console.log("one-time keys left:", keysLeft(state, TREE_PRIMARY), "lockdown:", inLockdown(state));
}
const lamports = await connection.getBalance(vault);
```

### Fund a vault (SOL)

Anyone can deposit; the vault does not sign. A SOL deposit is one `SystemProgram` transfer.

```ts
import { Transaction } from "@solana/web3.js";
import { fundVaultIx } from "@noxvault/sdk";

const tx = new Transaction().add(fundVaultIx({ vault, from: wallet.publicKey, lamports: 100_000_000n })); // 0.1 SOL
const sig = await wallet.sendTransaction(tx, connection);
```

Check `fetchState(program, vault)` first if the address comes from a user: funds sent to an address
that is not a Noxvault are not protected by its rules.

### Fund a vault (SPL or Token-2022)

```ts
import { buildFundTokenIxs, fundVaultTokenIxs, vaultTokenAccount } from "@noxvault/sdk";

// Reads the mint's token program and decimals, then: create the vault's ATA if needed + transfer_checked.
const ixs = await buildFundTokenIxs(connection, { vault, from: wallet.publicKey, mint, amount: 5_000_000n });
const tx = new Transaction().add(...ixs);

// Without RPC reads, when you know the mint:
const ixs2 = fundVaultTokenIxs({ vault, from: wallet.publicKey, mint, amount: 5_000_000n, decimals: 6 });
const vaultAta = vaultTokenAccount(vault, mint); // where the tokens end up
```

### Protocol and treasury info

```ts
import { fetchProtocol, vaultTier, fundLinks } from "@noxvault/sdk";

const protocol = await fetchProtocol(program); // { treasury, createFee, noxMint, guardian, sentinel, admin, frozen }
console.log(protocol?.treasury.toBase58(), protocol?.createFee); // fee receiver, lamports per new vault
const tier = await vaultTier(program, vault, protocol); // $NOX tier of a vault: { name, held, next, tiersOn }

const links = fundLinks(vault, { amountSol: 0.1 });
// links.page   https://www.nox-vault.com/t/<vault>            rules in plain words, balances, schedules
// links.json   https://www.nox-vault.com/api/treasury/<vault> the same as JSON (CORS open)
// links.action the Solana Action; links.blink a dial.to URL that opens the fund flow
```

### Friendly errors

```ts
import { explainError } from "@noxvault/sdk";

try {
  await wallet.sendTransaction(tx, connection);
} catch (e) {
  showToast(explainError(e)); // e.g. "The fee is above the protocol maximum of 0.01 SOL per action."
}
```

`explainError` understands Anchor errors, `custom program error: 0x…` codes and simulation logs;
unknown errors come back unchanged. The texts are in `PROGRAM_ERROR_TEXT`.

## React example

```tsx
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { explainError, fetchState, fundVaultIx, readProgram } from "@noxvault/sdk";
import { useState } from "react";

export function FundVaultButton({ vault, sol = 0.1 }: { vault: string; sol?: number }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState("");

  async function fund() {
    if (!publicKey) return setStatus("Connect a wallet first.");
    try {
      const key = new PublicKey(vault);
      if (!(await fetchState(readProgram(connection), key))) return setStatus("Not a Noxvault.");
      const tx = new Transaction().add(fundVaultIx({ vault: key, from: publicKey, lamports: BigInt(Math.round(sol * 1e9)) }));
      const sig = await sendTransaction(tx, connection);
      setStatus(`Sent: ${sig}`);
    } catch (e) {
      setStatus(explainError(e));
    }
  }

  return (
    <button onClick={fund}>
      Fund this vault (quantum-safe) · {sol} SOL {status && <small>{status}</small>}
    </button>
  );
}
```

## No-code: the embed button

Any website can add a fund button without the SDK:

```html
<script src="https://www.nox-vault.com/embed.js" async></script>
<a data-noxvault-fund="<vault address>" data-amount="0.1"></a>
```

It renders a "Fund this vault (quantum-safe)" button that opens the vault's fund Blink in a new tab.
Options: `data-label`, `data-open="site"` (the public treasury page instead of the Blink) and
`data-cluster`. After adding buttons dynamically, call `window.Noxvault.scan()`.

## What else is in the box

- **Keys:** `newMasterSecret`, `secretToWords`, `wordsToSecret`, `makeSigner`, `makeDuressSigner`, WOTS+ primitives (`sign`, `buildTree`, `authPath`, …).
- **Actions:** `planAction` builds every transaction to sign and execute an action (withdraw, stake, schedule, budget, migrate, …); `preflightAction` lists errors and warnings first; `findSignedMessages` / `pickLeaf` enforce one message per one-time key.
- **Relayers:** `encodeRelayRequest`, `decodeRelayRequest`, `checkRelay`, `relay`, `relayFee` (capped at `MAX_ACTION_FEE`).
- **Keepers:** `executePendingIx`, `runScheduleIx`, `testamentIxs`, `migrateIxs`, `sweepInboxIxs`, `spendBudgetIx`.
- **Addresses:** `vaultPda`, `statePda`, `approvalPda`, `schedulePda`, `budgetPda`, `inboxPda`, `linkPda`, `protocolPda`, …

The protocol is specified in `docs/SPEC.md` in the [repository](https://github.com/thecryptodog12/noxvault);
every rule a client must follow is implemented here.

## License

Apache-2.0
