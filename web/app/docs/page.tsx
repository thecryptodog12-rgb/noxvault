import type { Metadata } from "next";
import Link from "next/link";
import { PageHead, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "How it works — Noxvault" };

const TOC = [
  ["why", "Why hashes"],
  ["keys", "Your keys"],
  ["chains", "Chains"],
  ["message", "What gets signed"],
  ["flow", "On-chain flow"],
  ["after", "After an unlock"],
  ["params", "Parameters"],
];

export default function Docs() {
  return (
    <div>
      <PageHead
        kicker="05 // how it works"
        title={
          <>
            The protocol, <span className="inv">plainly</span>
          </>
        }
        sub="A walk through the Noxvault v1 spec. The program, the SDK and this site all follow the same document."
      />
      <div className="grid [&>*]:min-w-0 gap-10 lg:grid-cols-[200px_1fr]">
        <nav className="hidden lg:block">
          <div className="sticky top-24 flex flex-col gap-1 text-[12px]">
            <div className="label mb-2">contents</div>
            {TOC.map(([id, t], i) => (
              <a key={id} href={`#${id}`} className="text-mute hover:text-moon">
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
            weakness: the best known quantum attack (Grover) only makes brute force somewhat faster, which full 256-bit SHA-256
            comfortably absorbs.
          </p>
          <p>
            Noxvault guards funds with a <strong>WOTS+ one-time signature</strong>, built only from SHA-256. No ed25519 key, not
            even yours, can move money out of a vault.
          </p>

          <h2 id="keys">Your keys</h2>
          <p>
            Everything starts from a 32-byte master secret <code>S</code>, shown to you as 24 BIP39 words. From it, vault number{" "}
            <code>i</code> gets its own key:
          </p>
          <ul>
            <li>
              <code>sk_seed(i)</code> and <code>pk_seed(i)</code> are hashes of <code>S</code> and <code>i</code> with different labels.
            </li>
            <li>34 secret chain starts are hashed from <code>sk_seed(i)</code>.</li>
            <li>The site finds your vaults by trying i = 0, 1, 2, … and asking the chain which addresses were funded or used.</li>
          </ul>
          <p>
            All of this happens in your browser. The words never leave the tab, and nothing about them is sent to an RPC.
          </p>

          <h2 id="chains">Chains</h2>
          <p>
            Each of the 34 secret values is hashed 255 times in a row. The last value of each chain is its public end. The 34
            ends, together with <code>pk_seed</code>, are hashed into a <strong>root</strong>, and the vault address is the
            program-derived address of <code>[&quot;vault&quot;, root]</code>.
          </p>
          <p>
            Every single hash step is &quot;tweaked&quot;: it also mixes in <code>pk_seed</code>, the chain number and the step
            number. So every hash call in every chain of every vault is effectively a different function, and an attacker gains
            nothing by attacking many vaults at once. That is what makes it WOTS+ rather than plain Winternitz.
          </p>

          <h2 id="message">What gets signed</h2>
          <p>A withdrawal is one exact sentence, hashed into a 32-byte digest:</p>
          <ul>
            <li>this program, this vault,</li>
            <li>the asset (SOL, or a token mint),</li>
            <li>the destination wallet and the amount,</li>
            <li>the next vault, which receives everything that is not withdrawn.</li>
          </ul>
          <p>
            Each of the 32 digest bytes (0–255) says how far to walk along one chain; the signature is the value at that point.
            Two more checksum chains encode Σ(255 − byte). Raising any byte lowers the checksum, so nobody can turn your
            signature into one for a different message. Verifying means walking each revealed value the remaining steps to the
            end and checking that the rebuilt root matches the vault. Try it in the <Link href="/keylab">key lab</Link>.
          </p>

          <h2 id="flow">On-chain flow</h2>
          <p>
            A signature is 1,088 bytes, and checking one can take up to ~8,700 hashes. That is too much for one Solana
            transaction, so an unlock is split into steps, packed into as few transactions as fit (usually two):
          </p>
          <ul>
            <li>
              <strong>open_unlock</strong>: your wallet opens a buffer with the message parameters.
            </li>
            <li>
              <strong>write_sigs</strong>: the 34 signature values are written in two parts. Only the payer can write.
            </li>
            <li>
              <strong>verify</strong>: anyone can call it. The first call freezes the buffer; then chains are walked to their ends,
              split over as many transactions as needed.
            </li>
            <li>
              <strong>finish_unlock</strong>: rebuilds the root, checks it matches the vault, creates a <code>Spent</code> marker
              (which fails if this key was ever used), pays the destination, moves the rest to the next vault and refunds the
              buffer rent.
            </li>
          </ul>
          <p>
            Every step can be retried safely and none can redirect funds: the destination and amounts are fixed inside the signed
            message. Your wallet only pays the fees.
          </p>

          <h2 id="after">After an unlock</h2>
          <p>
            The old vault&apos;s key is spent forever. Anything left in it later (another token, a late deposit) can be swept by
            anyone to its successor with <code>sweep</code> or <code>sweep_token</code>. It is never protected by a used key again.
          </p>
          <p>
            Solana accounts must hold either zero SOL or at least the rent minimum. If the SOL left after a withdrawal is too
            small to open the next vault, it is added to your payout instead.
          </p>
          <p>
            Optionally, <code>register(root)</code> lists a vault in the public <Link href="/vaults">explorer</Link>.
          </p>

          <h2 id="params">Parameters</h2>
          <Panel className="not-prose my-4 overflow-x-auto">
            <table className="tbl min-w-[420px]">
              <tbody>
                {[
                  ["hash", "SHA-256, n = 32 bytes"],
                  ["Winternitz w", "256 (one digit = one byte)"],
                  ["chains", "32 message + 2 checksum = 34"],
                  ["steps per chain", "255"],
                  ["signature", "34 × 32 = 1,088 bytes + 32-byte pk_seed"],
                  ["worst-case verify", "~8,700 hashes"],
                  ["key use", "exactly once, enforced by Spent"],
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
            Upgrade authority: the program stays upgradeable during testing, and the authority is to be burned at mainnet launch.
            See <Link href="/risks">risks</Link>.
          </p>
        </article>
      </div>
    </div>
  );
}
