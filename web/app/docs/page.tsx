import type { Metadata } from "next";
import Link from "next/link";
import { PageHead, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "How it works — Noxvault" };

const TOC = [
  ["why", "Why hashes"],
  ["vault", "One address, 256 keys"],
  ["keys", "Your words"],
  ["actions", "What gets signed"],
  ["recovery", "Recovery key"],
  ["whitelist", "Whitelist & delay"],
  ["staking", "Staking"],
  ["flow", "On-chain flow"],
  ["relayer", "Gasless relayer"],
  ["offline", "Offline signing"],
  ["backups", "Backups"],
  ["once", "One key, one message"],
  ["nox", "$NOX"],
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
        sub="A walk through the Noxvault v2 spec. The program, the SDK, the relayer and this site all follow the same document."
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
            yours, can move what is inside a vault.
          </p>

          <h2 id="vault">One address, 256 keys</h2>
          <p>
            A one-time signature key may sign only one message. Instead of moving your funds to a new address after every
            withdrawal, v2 puts <strong>256 one-time keys</strong> (&quot;leaves&quot;) under a Merkle tree, the idea behind XMSS.
            The vault commits to the tree&apos;s <strong>root</strong>, so one fixed deposit address serves 256 actions.
          </p>
          <p>
            A signature carries the leaf number, the 34 chain values and the leaf&apos;s <em>auth path</em>: its sibling on each
            of the 8 levels of the tree. The program rebuilds the leaf from the signature, hashes up the path, and checks that it
            lands on the root. The vault keeps a bitmap of used leaves, so each one works exactly once.
          </p>
          <p>
            The vault address is a program address derived from a hash of the <strong>full config</strong>: the primary root,
            the optional recovery root and delay, the whitelist and its delay. Nobody, you included, can change a vault&apos;s
            rules after the fact. Want different rules? Make a new vault and move the funds.
          </p>

          <h2 id="keys">Your words</h2>
          <p>
            Everything starts from 24 BIP39 words, a 32-byte secret <code>S</code>. Vault number <code>v</code> = 0, 1, 2… lets one
            phrase run several vaults. Each tree gets its own <code>sk_seed</code> and <code>pk_seed</code>, hashed from{" "}
            <code>S</code> and <code>v</code>; a recovery tree uses <code>v + 2³¹</code>, so one phrase never produces the same keys
            in both roles.
          </p>
          <p>
            Building the primary tree means computing all 256 leaves: 256 × 34 chains × 255 hashes, about 2.2 million SHA-256
            calls. That takes a few seconds in your browser, in a background worker. The words never leave the tab.
          </p>

          <h2 id="actions">What gets signed</h2>
          <p>
            Each leaf signs one <strong>action</strong>, bound to the program, the vault, the tree and the leaf number:
          </p>
          <ul>
            <li>
              <strong>Withdraw</strong> SOL or an SPL / Token-2022 token to a destination wallet.
            </li>
            <li>
              <strong>Stake</strong>, <strong>Unstake</strong>, <strong>Collect stake</strong>: native staking from inside the vault.
            </li>
            <li>
              <strong>Cancel</strong> the pending withdrawal, or <strong>Ping</strong> to prove the owner is alive.
            </li>
          </ul>
          <p>
            Every action also names a <code>fee</code> and a <code>fee_payee</code>: lamports the vault pays when the action
            executes. That is how a relayer gets paid, so you never need a wallet. With fee 0 you send it yourself.
          </p>

          <h2 id="recovery">Recovery key</h2>
          <p>
            Optionally a vault has a second, smaller tree of 16 keys from a <strong>separate recovery phrase</strong>, ideally
            held by someone else or stored in a different place. It has two powers:
          </p>
          <ul>
            <li>
              <strong>Cancel, any time.</strong> If someone stole your primary words and starts a delayed withdrawal, the recovery
              key stops it.
            </li>
            <li>
              <strong>Full control after inactivity.</strong> Every primary action resets <code>last_active</code>. Once the primary
              has been silent for the recovery delay (180 days by default), the recovery key may do everything, immediately. This
              is inheritance and lost-words insurance. A <strong>Ping</strong> keeps the timer from running out.
            </li>
          </ul>

          <h2 id="whitelist">Whitelist &amp; delay</h2>
          <p>
            Up to 4 addresses can be whitelisted. Primary withdrawals to them are immediate. A primary withdrawal anywhere else
            is either refused (delay 0) or becomes the vault&apos;s single <strong>pending withdrawal</strong>: anyone can execute
            it after the delay, and either tree can cancel it before then. A thief with your words can then only start a
            withdrawal you can see and stop.
          </p>

          <h2 id="staking">Staking</h2>
          <p>
            The vault can delegate SOL to a validator. Stake accounts are program addresses <code>[&quot;stake&quot;, vault,
            seed]</code> with the vault itself as staker and withdrawer, so staked SOL is guarded by the same hash signatures.
            Unstake deactivates; the epoch after, Collect stake brings the SOL back into the vault.
          </p>

          <h2 id="flow">On-chain flow</h2>
          <p>A signature (1,376 bytes) does not fit one transaction, so it is assembled in a buffer:</p>
          <ul>
            <li>
              <strong>open_unlock</strong>: creates the buffer with the leaf, <code>pk_seed</code>, auth path and action.
            </li>
            <li>
              <strong>write_sigs</strong>: fills in the 34 chain values. The vault is passed along, so every byte of a signature
              shows up in the vault&apos;s public history.
            </li>
            <li>
              <strong>verify</strong>: walks the chains to their ends, split over transactions to fit the compute limit. Anyone
              may call it.
            </li>
            <li>
              <strong>finish</strong>: rebuilds leaf and root, checks the root, marks the leaf used, applies the recovery and
              whitelist rules and executes. The buffer rent goes back to whoever paid it.
            </li>
          </ul>
          <p>Every step can be retried, and none can redirect funds: the action is inside the signed message.</p>

          <h2 id="relayer">Gasless relayer</h2>
          <p>
            You do not need a wallet or SOL outside the vault. Sign the action with <code>fee &gt; 0</code> and{" "}
            <code>fee_payee</code> = the relayer. The relayer sends the transactions, pays network fees and buffer rent (it gets
            the rent back), and is repaid by the vault from that fee when the action executes. The fee is shown before you sign.
          </p>
          <p>
            The relayer is a <strong>convenience, not a trust assumption</strong>. It cannot change the destination, amount or
            anything else: one changed byte and the signature no longer verifies. The worst it can do is refuse or delay; then
            send the same signed action yourself, from <Link href="/submit">/submit</Link> with any wallet, or through another
            relayer.
          </p>

          <h2 id="offline">Offline signing</h2>
          <p>
            Your words never need to touch an online device. On an online device, <Link href="/submit">/submit</Link> looks up
            the next unused leaf of your vault. On an offline device, <Link href="/offline">/offline</Link> builds your keys, signs
            the action and shows the result as text and QR codes; it makes no network requests. Back online, scan or paste it
            into <Link href="/submit">/submit</Link>, which checks it against the chain and sends it through the relayer or your
            wallet. Installed as an app, the site keeps <code>/offline</code> cached so it loads without a network.
          </p>

          <h2 id="backups">Backups</h2>
          <p>
            <Link href="/backup">/backup</Link> offers two local tools: split a phrase into Shamir shares (any K of N restore it,
            fewer reveal nothing), or encrypt it into a file with a password (scrypt + AES-256-GCM). Both run in the tab and send
            nothing anywhere. Back up the primary and recovery phrases separately.
          </p>

          <h2 id="once">One key, one message</h2>
          <p>
            If one leaf ever signs two different messages, an attacker can combine them to forge a third. The program refuses a
            used leaf, but a signature that was only <em>partly</em> published (a failed or abandoned attempt) is still out
            there. So before signing, this app reads the vault&apos;s <strong>entire history</strong>, failed and cancelled
            transactions included, and recognises every signature value your keys ever published. A leaf with an unfinished
            message can only complete that same message; otherwise the lowest leaf that is unused and never published is picked.
            If the history cannot be read, the app refuses to sign.
          </p>
          <p>
            Offline signing cannot read the chain, which is why the prepare step and the checks on <code>/submit</code> exist:
            /submit derives the key&apos;s chain ends from the request itself and warns if the same leaf ever published values for
            a different message.
          </p>

          <h2 id="nox">$NOX</h2>
          <p>
            Planned: holders of at least a threshold amount of $NOX will relay for free (the relayer waives its fee when the
            withdrawal&apos;s destination holds enough). The contract address is not known yet; it will appear in the sidebar once
            it exists. Ignore anyone offering it before that.
          </p>

          <h2 id="params">Parameters</h2>
          <Panel className="not-prose my-4 overflow-x-auto">
            <table className="tbl min-w-[420px]">
              <tbody>
                {[
                  ["hash", "SHA-256, n = 32 bytes"],
                  ["Winternitz w", "256 (one digit = one byte)"],
                  ["chains", "32 message + 2 checksum = 34"],
                  ["primary tree", "height 8 = 256 one-time keys"],
                  ["recovery tree", "height 4 = 16 one-time keys (optional)"],
                  ["signature", "34 × 32 + 32 pk_seed + 8 × 32 path = 1,376 bytes"],
                  ["whitelist", "up to 4 addresses, optional delay for others"],
                  ["key use", "exactly once, bitmap in the vault state"],
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
            Upgrade authority: the program stays upgradeable during testing. See <Link href="/risks">risks</Link>.
          </p>
        </article>
      </div>
    </div>
  );
}
