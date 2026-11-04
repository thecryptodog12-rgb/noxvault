import type { Metadata } from "next";
import Link from "next/link";
import { PageHead, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "How it works — Noxvault" };

const TOC = [
  ["why", "Why hashes"],
  ["vault", "One address, many keys"],
  ["keys", "Your words"],
  ["actions", "What gets signed"],
  ["approvals", "Approvals & multisig"],
  ["rules", "Rules: whitelist, limit, delay"],
  ["recovery", "Recovery key"],
  ["testament", "Testament"],
  ["duress", "Duress phrase"],
  ["letters", "Sealed letters"],
  ["treasury", "Treasuries"],
  ["schedules", "Schedules"],
  ["budgets", "Session budgets"],
  ["migration", "Migration"],
  ["invoices", "Invoice addresses"],
  ["tokens", "Tokens"],
  ["escape", "Escape Hatch & registry"],
  ["canary", "Quantum canary"],
  ["keeper", "Relayer & keeper"],
  ["integrate", "Integrate"],
  ["flow", "On-chain flow"],
  ["once", "One key, one message"],
  ["offline", "Offline & backups"],
  ["params", "Parameters"],
];

export default function Docs() {
  return (
    <div>
      <PageHead
        kicker="05 // how it works"
        title={
          <>
            How it <span className="inv">works</span>
          </>
        }
        sub="A walk through the Noxvault v4 spec. The program, the SDK, the relayer, the keeper and this site all follow the same document."
      />
      <div className="grid [&>*]:min-w-0 gap-10 lg:grid-cols-[200px_1fr]">
        <nav className="hidden lg:block">
          <div className="sticky top-24 flex flex-col gap-1 text-[12px]">
            <div className="label mb-2">contents</div>
            {TOC.map(([id, t], i) => (
              <a key={id} href={`#${id}`} className="text-mute hover:text-teal">
                <span className="text-dim">{String(i + 1).padStart(2, "0")}</span> {t}
              </a>
            ))}
          </div>
        </nav>
        <article className="prose-nox max-w-[720px] text-[13.5px]">
          <h2 id="why">Why hashes</h2>
          <p>
            A normal Solana wallet is one ed25519 key. Its security rests on elliptic curves, and a large enough quantum computer
            running Shor&apos;s algorithm could work out the private key from the public one. Hash functions do not have that
            weakness: the best known quantum attack (Grover) only speeds up brute force, which 256-bit SHA-256 comfortably absorbs.
          </p>
          <p>
            Noxvault guards funds with <strong>WOTS+ one-time signatures</strong> built only from SHA-256. No ed25519 key, not even
            yours, can move what is inside a vault. Your ordinary wallet can still be protected around the edges: see the{" "}
            <a href="#escape">Escape Hatch</a>.
          </p>

          <h2 id="vault">One address, many keys</h2>
          <p>
            A one-time key may sign only one message. A vault therefore holds <strong>trees</strong> of them: each signer tree has
            256 one-time keys (&quot;leaves&quot;) under a Merkle root, the idea behind XMSS. A vault has up to{" "}
            <strong>3 signer trees</strong> and an optional <strong>recovery tree</strong> of 16 keys. One fixed vault address
            serves every action; the vault keeps a bitmap of used leaves, so each one works exactly once.
          </p>
          <p>
            The vault address is a program address derived from a hash of the <strong>full config</strong>: the tree roots, the
            approval threshold, the recovery delay, the whitelist, the delay and instant limit, the heirs and the testament delay.
            Nobody, you included, can change a vault&apos;s rules after the fact. Want different rules? Make a new vault and{" "}
            <a href="#migration">migrate</a>.
          </p>

          <h2 id="keys">Your words</h2>
          <p>
            Everything starts from 24 BIP39 words, a 32-byte secret <code>S</code>. Vault number <code>v</code> = 0, 1, 2… lets one
            phrase run several vaults. Each tree gets its own <code>sk_seed</code> and <code>pk_seed</code>, hashed from{" "}
            <code>S</code> and <code>v</code>; a recovery tree uses <code>v + 2³¹</code>, so one phrase never produces the same keys
            in two roles. Building a signer tree is about 2.2 million SHA-256 calls: a few seconds in a background worker of your
            browser. The words never leave the tab.
          </p>

          <h2 id="actions">What gets signed</h2>
          <p>
            Each leaf signs one <strong>action</strong>, bound to the program, the vault, the tree and the leaf number:
          </p>
          <ul>
            <li>
              <strong>Withdraw</strong> SOL or a token to a destination.
            </li>
            <li>
              <strong>Stake</strong>, <strong>Unstake</strong>, <strong>Collect stake</strong>: native staking from inside the vault.
            </li>
            <li>
              <strong>Cancel</strong> the pending withdrawal or migration; <strong>Ping</strong> to prove the owner is alive.
            </li>
            <li>
              <strong>Schedule</strong> / <strong>Cancel schedule</strong>, <strong>Budget</strong> / <strong>Cancel budget</strong>,{" "}
              <strong>Migrate</strong>.
            </li>
          </ul>
          <p>
            Every action also names a <code>fee</code> and a <code>fee_payee</code>: lamports the vault pays when the action
            executes. That is how a relayer gets paid, so you never need a wallet. With fee 0 you send it yourself.
          </p>

          <h2 id="approvals">Approvals &amp; multisig</h2>
          <p>
            A verified signature does not move funds by itself. It becomes an <strong>approval</strong> of the action&apos;s hash,
            recording which tree approved. An action executes (anyone may trigger it) once:
          </p>
          <ul>
            <li>
              signer approvals reach the vault&apos;s <strong>threshold</strong> (1, 2 or 3 of up to 3 signer trees), or
            </li>
            <li>the recovery tree approved a Cancel, Cancel schedule or Cancel budget, or</li>
            <li>the recovery tree approved anything and the owner has been inactive for the recovery delay.</li>
          </ul>
          <p>
            For a 2-of-3 vault, each co-signer keeps their own 24 words; the vault commits to all three roots. The first signer&apos;s
            approval waits on chain; the second signer approves <em>exactly the same action</em> and it executes. An approval that
            never completes can be discarded after 7 days. Signer approvals reset the vault&apos;s <code>last_active</code> clock.
          </p>

          <h2 id="rules">Rules: whitelist, instant limit, delay</h2>
          <p>
            Up to 4 addresses can be <strong>whitelisted</strong>. A destination is <strong>restricted</strong> when a whitelist
            exists and it is not on it, or when there is no whitelist but an instant limit is set.
          </p>
          <ul>
            <li>
              <strong>Instant limit</strong>: restricted SOL withdrawals execute at once while they stay within this many lamports per
              24 h.
            </li>
            <li>
              <strong>Delay</strong>: anything else restricted becomes the vault&apos;s single <strong>pending</strong> withdrawal,
              executable by anyone after the delay and cancellable by a signer or the recovery key before then. With delay 0,
              restricted withdrawals are refused outright.
            </li>
            <li>Tokens to a restricted destination always wait (or are refused).</li>
          </ul>
          <p>
            A thief with your words then cannot drain the vault quietly: they can take at most the instant limit, and everything else
            shows up as a pending withdrawal you can see and stop.
          </p>

          <h2 id="recovery">Recovery key</h2>
          <p>
            Optionally a vault has a recovery tree of 16 keys from a <strong>separate phrase</strong>, ideally held by someone else.
            It can <strong>cancel</strong> pending withdrawals, schedules and budgets at any time, and once the signers have been
            silent for the recovery delay (180 days by default) it can do <strong>everything</strong>, unrestricted. A{" "}
            <strong>Ping</strong> resets the clock. Manage it on <Link href="/recovery">/recovery</Link>.
          </p>

          <h2 id="testament">Testament</h2>
          <p>
            Name up to 4 <strong>heirs</strong> with shares in basis points (summing to 100%) and a testament delay (365 days by
            default). When the owner has been inactive that long, anyone may distribute all SOL and every token to the heirs by
            share, and deactivate and collect stakes first. Keepers do this automatically. Any signer action, including a Ping,
            postpones it.
          </p>

          <h2 id="duress">Duress phrase</h2>
          <p>
            An optional fifth tree from its <strong>own 24 words</strong>, to hand over if someone forces you. It can only withdraw SOL,
            pays at most the duress limit at once (0.5 SOL by default, fee included), ignoring whitelist and delay, and then puts the
            vault in <strong>lockdown</strong> for the duress lock (3 days by default, at least 1). During a lockdown only Ping and
            cancels execute; a Cancel from the recovery key ends it at once. Every vault stores a duress root, a decoy derived from the
            owner&apos;s seed when unused, so the chain does not show which vaults have one. Opening <Link href="/mine">My vaults</Link>{" "}
            with the duress phrase shows an ordinary vault holding only that amount. See <Link href="/duress">/duress</Link>.
          </p>

          <h2 id="letters">Sealed letters</h2>
          <p>
            The signers authorize a <strong>letter key</strong>, an ordinary ed25519 key that may write the vault&apos;s letters (
            <code>PDA[&quot;letter&quot;, vault, id]</code>, up to 8,192 bytes each) but never move funds. The browser encrypts each
            letter with timelock encryption to a future drand quicknet round: about the testament delay plus 7 days. While the owner is
            active the app re-seals letters to a later round; when the owner stops, they open around the time the testament runs.
            After that anyone can read them at <code>/letters/&lt;vault&gt;</code>, unless a passphrase was added. Duress and recovery
            keys cannot authorize a letter key. See <Link href="/letters">/letters</Link>.
          </p>

          <h2 id="treasury">Treasuries</h2>
          <p>
            A vault&apos;s rules are part of its address, so a token project can prove how its treasury works. <code>/t/&lt;vault&gt;</code>{" "}
            reads the rules from the chain and states them in plain words, with balances, vesting schedules, pending payouts and a
            0–5 protection score; <code>/api/treasury/&lt;vault&gt;</code> returns the same as JSON and <code>…/badge</code> as an
            embeddable SVG. Create offers presets: team multisig 2-of-3, slow treasury (72 h) and vesting. See{" "}
            <Link href="/treasury">/treasury</Link>.
          </p>

          <h2 id="schedules">Schedules</h2>
          <p>
            One signature sets up recurring payments: <code>amount</code> every <code>interval</code>, <code>count</code> times, from{" "}
            <code>start</code>. Anyone can run a payment once it is due; the keeper does. A schedule to a restricted destination
            starts no earlier than the delay (refused with delay 0). Cancel it with a signer or the recovery key.
          </p>

          <h2 id="budgets">Session budgets: the daily-use path</h2>
          <p>
            Hash signatures are heavy for buying a coffee. A <strong>budget</strong> lets an ordinary ed25519{" "}
            <strong>session key</strong> (for example your Phantom wallet) spend up to a <code>limit</code> per <code>period</code>{" "}
            from the vault until <code>expires</code>, and only to non-restricted destinations. That is the daily path: Phantom
            signs normal transactions, the vault caps what it can ever lose. Lose the session key and you lose at most what is left of
            the budget; cancel it with one hash signature.
          </p>

          <h2 id="migration">Migration</h2>
          <p>
            Keys running out, or rules to change? Sign <strong>Migrate</strong> to a new Noxvault vault. It is restricted unless the
            new vault is whitelisted (then it waits out the delay and can be cancelled). Once it executes, anyone moves all SOL and
            every token to the new vault; the keeper finishes it.
          </p>

          <h2 id="invoices">Invoice addresses</h2>
          <p>
            <code>inbox(vault, id)</code> is a separate address per id (<code>PDA[&quot;inbox&quot;, vault, id]</code>). Anyone can
            pay SOL or tokens into it and anyone can sweep it into the vault. Give one per customer or payer: per-payer accounting,
            without publishing the vault address.
          </p>

          <h2 id="tokens">Tokens</h2>
          <p>
            Everything above works for <strong>SOL, SPL tokens and Token-2022 tokens</strong>: withdrawals, rules, schedules,
            budgets, testament, migration, invoices and the Escape Hatch. Token-2022 mints with transfer fees, transfer hooks,
            permanent delegates, confidential transfers or non-transferable tokens are refused before signing. A token whose issuer
            holds a freeze authority can still be frozen by that issuer.
          </p>

          <h2 id="escape">Escape Hatch &amp; registry</h2>
          <p>
            The vault is safe, but your ordinary wallet is still one ed25519 key. The <Link href="/escape">Escape Hatch</Link>{" "}
            gives it a fire exit into your vault:
          </p>
          <ul>
            <li>
              <strong>Link</strong>: the wallet signs <code>register_link(vault)</code>. This is also a{" "}
              <strong>timestamped registry entry</strong>: proof, signed while ed25519 is still safe, that this wallet belongs to
              that vault. Changing the vault takes 30 days and is impossible after the canary trips.
            </li>
            <li>
              <strong>Tokens</strong>: the wallet approves <code>PDA[&quot;escape&quot;, wallet]</code> as delegate of its token
              accounts. <code>escape_token</code> moves a delegated balance into the linked vault, and only after panic or a tripped
              canary.
            </li>
            <li>
              <strong>SOL</strong>: the wallet pre-signs a durable-nonce transaction calling <code>escape_sol</code> and stores it in
              its link. Anyone may broadcast it, at any time; it can only move this wallet&apos;s SOL into this wallet&apos;s own
              vault. Using the nonce for anything else voids it; re-arm then.
            </li>
            <li>
              <strong>Panic</strong>: the wallet itself can trigger the hatch at any time if it thinks its key is compromised.
            </li>
          </ul>
          <p>
            <strong>Honest limits.</strong> It protects the moment it is triggered. It is a race: if an attacker breaks your key
            and moves first, the hatch is too late. Tokens received after approving need approving again. Keep most funds in the
            vault; the hatch is for what stays outside. Check any address with the <Link href="/scan">scanner</Link>.
          </p>

          <h2 id="canary">Quantum canary</h2>
          <p>
            <code>PDA[&quot;canary&quot;]</code> watches a fixed ed25519 address found by hashing to the curve:{" "}
            <code>SHA256(&quot;noxvault/canary/v1&quot; || u32le(i))</code> for the first <code>i</code> that is a valid point
            (i = 0). Nobody knows its private key. It holds a bounty; <code>trip_canary</code> (anyone) succeeds only once the
            balance falls below the recorded baseline, which needs ed25519 to be broken. Then keepers evacuate every linked wallet.
            It is a public alarm, not a guarantee: an attacker may break your key without touching the bounty. See{" "}
            <Link href="/canary">/canary</Link>.
          </p>

          <h2 id="keeper">Relayer &amp; keeper</h2>
          <p>
            A <strong>relayer</strong> sends your signed action as fee payer and is repaid through its <code>fee</code>. A{" "}
            <strong>keeper</strong> runs the permissionless instructions: due schedules, pending withdrawals after their delay,
            testaments, migrations, the canary check and Escape Hatch evacuations. This site runs one as a daily cron; a
            long-running keeper can pass every minute (see <code>bot/README.md</code>).
          </p>
          <p>
            Both are <strong>conveniences, not trust assumptions</strong>. Neither can change anything that was signed: one changed
            byte and the signature no longer verifies, and permissionless instructions only do what the rules already allow. The
            worst they can do is refuse or be slow; then anyone, you included, can send the same transactions.
          </p>

          <h2 id="integrate">Integrate</h2>
          <p>
            Funding a vault needs no signature from the vault: it is a plain transfer to the vault address, or to the vault&apos;s
            token account for SPL tokens. Wallets and apps can build that transfer with the TypeScript SDK, and any website can
            add a fund button with one script tag. Both run on <strong>devnet</strong>; the program is <strong>unaudited</strong>.
          </p>
          <p>
            <strong>SDK.</strong> <code>npm install @noxvault/sdk @solana/web3.js @coral-xyz/anchor @solana/spl-token</code>. It
            ships the program id and IDL, the vault/state addresses, account decoders, the fund instructions and{" "}
            <code>explainError</code>; everything this site and the relayer use.
          </p>
          <pre className="not-prose my-4 overflow-x-auto rounded border border-line bg-ink-2 p-3 text-[12px] text-bone">
            {`import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { readProgram, fetchState, fundVaultIx, buildFundTokenIxs } from "@noxvault/sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const vault = new PublicKey("<vault address>");
if (!(await fetchState(readProgram(connection), vault))) throw new Error("not a Noxvault");

// SOL: one SystemProgram transfer, signed by the payer's wallet
const tx = new Transaction().add(fundVaultIx({ vault, from: wallet.publicKey, lamports: 100_000_000n }));
// SPL / Token-2022: creates the vault's token account if needed, then transfer_checked
const ixs = await buildFundTokenIxs(connection, { vault, from: wallet.publicKey, mint, amount: 5_000_000n });`}
          </pre>
          <p>
            <strong>Fund button.</strong> Add the script once and mark any link with the vault address. It becomes a &quot;Fund this
            vault (quantum-safe)&quot; button that opens the fund Blink in a new tab; <code>data-open=&quot;site&quot;</code> opens
            the vault&apos;s public treasury page instead. No dependencies, under 5 KB.
          </p>
          <pre className="not-prose my-4 overflow-x-auto rounded border border-line bg-ink-2 p-3 text-[12px] text-bone">
            {`<script src="https://www.nox-vault.com/embed.js" async></script>
<a data-noxvault-fund="<vault address>" data-amount="0.1"></a>`}
          </pre>
          <p>
            The same data is available without code: <code>/api/treasury/&lt;vault&gt;</code> (JSON), <code>/t/&lt;vault&gt;</code>{" "}
            and the Solana Action at <code>/api/actions/fund/&lt;vault&gt;</code>. The SDK README has a React example.
          </p>

          <h2 id="flow">On-chain flow</h2>
          <p>A signature (1,376 bytes) does not fit one transaction, so it is assembled in a buffer:</p>
          <ul>
            <li>
              <strong>open_unlock</strong>: creates the buffer with the tree, leaf, <code>pk_seed</code>, auth path and action.
            </li>
            <li>
              <strong>write_sigs</strong>: fills in the 34 chain values. The vault is named, so every signature byte is in the
              vault&apos;s public history.
            </li>
            <li>
              <strong>verify</strong>: walks the chains to their ends, split over transactions to fit the compute limit.
            </li>
            <li>
              <strong>approve</strong>: rebuilds leaf and root, burns the leaf, records the approval.
            </li>
            <li>
              <strong>execute</strong>: runs the action once the approval rules are met. Anyone may call it.
            </li>
          </ul>
          <p>Every step can be retried, and none can redirect funds: the action is inside the signed message.</p>

          <h2 id="once">One key, one message</h2>
          <p>
            If one leaf ever signs two different messages, an attacker can combine them to forge a third. The program refuses a
            used leaf, but a signature that was only <em>partly</em> published is still out there. So before signing, this app reads
            the vault&apos;s <strong>entire history</strong>, failed transactions included, and recognises every value your keys
            ever published. A leaf with an unfinished message can only complete that same message. If the history cannot be read,
            the app refuses to sign.
          </p>

          <h2 id="offline">Offline &amp; backups</h2>
          <p>
            Your words never need to touch an online device: sign on <Link href="/offline">/offline</Link> and carry the result to{" "}
            <Link href="/submit">/submit</Link>. <Link href="/backup">/backup</Link> splits a phrase into Shamir shares or encrypts
            it into a file, locally. Back up every phrase (signers, recovery) separately.
          </p>

          <h2 id="params">Parameters</h2>
          <Panel className="not-prose my-4 overflow-x-auto">
            <table className="tbl min-w-[420px]">
              <tbody>
                {[
                  ["hash", "SHA-256, n = 32 bytes"],
                  ["Winternitz w", "256 (one digit = one byte)"],
                  ["chains", "32 message + 2 checksum = 34"],
                  ["signer trees", "up to 3, height 8 = 256 one-time keys each"],
                  ["threshold", "1 to the number of signer trees"],
                  ["recovery tree", "height 4 = 16 one-time keys (optional)"],
                  ["duress tree", "height 8; default 0.5 SOL, 3-day lockdown (min 1 day)"],
                  ["sealed letter", "≤ 8,192 bytes ciphertext + 64-byte label; drand quicknet"],
                  ["signature", "34 × 32 + 32 pk_seed + 8 × 32 path = 1,376 bytes"],
                  ["whitelist", "up to 4 addresses"],
                  ["heirs", "up to 4, shares in basis points"],
                  ["link change", "30 days"],
                  ["stale approval", "discardable after 7 days"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="text-dim">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <p>
            The program stays upgradeable during testing. See <Link href="/risks">risks</Link>.
          </p>
        </article>
      </div>
    </div>
  );
}
