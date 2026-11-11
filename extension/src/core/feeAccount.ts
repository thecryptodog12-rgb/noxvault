// The fee account: an ordinary Solana key derived from an account's phrase, used ONLY to pay network
// fees and rent for things nobody else pays for: initializing a Free-tier vault (the relayer will not),
// executing a due pending payout, or sending an action without the relayer. It never has any power over
// a vault: vault actions are signed with the one-time WOTS keys. Keep only a little SOL on it.
//
//   seed = SHA-256("nox-ext/fee-account/v1" || master)      → ed25519 keypair
//
// Domain-separated, so it is unrelated to every WOTS tree of the same phrase (those use "nox2/sk",
// "nox2/pk", see sdk/wots.ts). Restorable from the phrase alone.
import { Keypair, Transaction, type Connection } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import type { SendFn } from "../../../web/lib/unlock";

const DOMAIN = new TextEncoder().encode("nox-ext/fee-account/v1");

export function feeKeypair(master: Uint8Array): Keypair {
  if (master.length !== 32) throw new Error("master secret must be 32 bytes");
  const buf = new Uint8Array(DOMAIN.length + 32);
  buf.set(DOMAIN);
  buf.set(master, DOMAIN.length);
  const seed = sha256(buf);
  buf.fill(0);
  const kp = Keypair.fromSeed(seed);
  seed.fill(0);
  return kp;
}

/** A SendFn (web/lib/unlock.ts sendIxs) that signs with this keypair, like a wallet's sendTransaction. */
export function keypairSender(kp: Keypair): SendFn {
  return async (tx: Transaction, conn: Connection, opts) => {
    tx.sign(kp);
    return conn.sendRawTransaction(tx.serialize(), { preflightCommitment: opts?.preflightCommitment ?? "confirmed", maxRetries: opts?.maxRetries ?? 3 });
  };
}
