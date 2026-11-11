// Ordinary Solana wallet keys, derived the standard way so a phrase shows the same addresses here as
// in Phantom / Solflare / Backpack:
//
//   seed  = BIP39 mnemonicToSeed(words, passphrase "")         PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic"
//   key_i = SLIP-0010 ed25519(seed, m/44'/501'/i'/0')           HMAC-SHA512 chain, key "ed25519 seed", hardened only
//
// Why this cannot collide with or weaken the Noxvault one-time keys (README "Wallet accounts"):
// the WOTS trees and the v0.2 fee account are derived from the 32-byte BIP39 *entropy* (the master)
// with SHA-256 and their own prefixes ("nox2/sk", "nox2/pk", "nox-ext/fee-account/v1"). The wallet keys
// go through PBKDF2-HMAC-SHA512 over the mnemonic *sentence* and then HMAC-SHA512 keyed "ed25519 seed":
// a different function family on a different input, so the outputs are independent; and every step is
// one-way, so a leaked wallet key (or an exported one) reveals nothing about the master or any other
// key. Adding our own extra domain prefix here would break Phantom compatibility, which is the point.
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Keypair } from "@solana/web3.js";
import { normalizeWords } from "../../../sdk/wots";
import { secretToWords } from "../../../sdk/client";
import { base58Decode, base58Encode } from "../lib/net";

const HARDENED = 0x80000000;
const ED25519_KEY = new TextEncoder().encode("ed25519 seed");

/** The Phantom / Solflare path of account `i`. */
export const solanaPath = (i: number) => `m/44'/501'/${i}'/0'`;

function parsePath(path: string): number[] {
  if (!/^m(\/\d+')*$/.test(path)) throw new Error("ed25519 (SLIP-0010) only supports hardened paths like m/44'/501'/0'/0'");
  return path
    .split("/")
    .slice(1)
    .map((p) => {
      const n = Number(p.slice(0, -1));
      if (!Number.isSafeInteger(n) || n >= HARDENED) throw new Error("bad path index");
      return n + HARDENED;
    });
}

/** SLIP-0010 ed25519: the 32-byte private key (an ed25519 seed) at `path`. */
export function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  let I = hmac(sha512, ED25519_KEY, seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  for (const index of parsePath(path)) {
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);
    const next = hmac(sha512, chain, data);
    data.fill(0);
    key.fill(0);
    chain.fill(0);
    I.fill(0);
    I = next;
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  chain.fill(0);
  I.fill(0);
  return key;
}

/** Normalized words (lowercase, single spaces) of a valid English BIP39 phrase of 12–24 words, or throws. */
export function cleanBip39(text: string): string {
  const words = normalizeWords(text);
  if (![12, 15, 18, 21, 24].includes(words.length)) throw new Error("A wallet phrase has 12, 15, 18, 21 or 24 words");
  const clean = words.join(" ");
  if (!validateMnemonic(clean, wordlist)) throw new Error("Those words are not a valid BIP39 phrase (check the spelling and the order)");
  return clean;
}

/** The ed25519 seed (32 bytes) of account `index` of a BIP39 phrase. Caller zeroes it. */
export function phraseAccountSeed(words: string, index: number, passphrase = ""): Uint8Array {
  const seed = mnemonicToSeedSync(cleanBip39(words), passphrase);
  try {
    return slip10Ed25519(seed, solanaPath(index));
  } finally {
    seed.fill(0);
  }
}

/** The wallet account `index` of a Noxvault phrase, given its master (the BIP39 entropy). */
export function masterAccountSeed(master: Uint8Array, index: number): Uint8Array {
  return phraseAccountSeed(secretToWords(master), index);
}

export const keypairFromSeed = (seed: Uint8Array) => Keypair.fromSeed(seed);
export const addressOfSeed = (seed: Uint8Array) => Keypair.fromSeed(seed).publicKey.toBase58();

export type ParsedImport = { kind: "phrase"; words: string } | { kind: "key"; seed: Uint8Array; address: string };

/**
 * What the user pasted to import a wallet: a BIP39 phrase (12–24 words), a base58 secret key (64 bytes,
 * Phantom's "export private key"), or a JSON byte array (solana-keygen id.json). The public half of a
 * 64-byte key must match its private half. A 32-byte base58 value is an address, never a key.
 */
export function parseImport(input: string): ParsedImport {
  const s = input.trim();
  if (!s) throw new Error("Paste a phrase or a private key");
  if (/^\[[\d,\s]+\]$/.test(s)) return fromSecret(Uint8Array.from(JSON.parse(s) as number[]));
  if (/\s/.test(s) || /^[a-z]+$/.test(s)) return { kind: "phrase", words: cleanBip39(s) };
  const raw = base58Decode(s);
  if (!raw) throw new Error("That is neither a phrase nor a base58 private key");
  if (raw.length === 32) throw new Error("That looks like an address (public key), not a private key");
  return fromSecret(raw);
}

function fromSecret(raw: Uint8Array): ParsedImport {
  try {
    if (raw.length !== 64 || raw.some((b) => b > 255)) throw new Error("A private key is 64 bytes (base58, or a JSON array of 64 numbers)");
    const seed = raw.slice(0, 32);
    const kp = Keypair.fromSeed(seed);
    if (base58Encode(kp.publicKey.toBytes()) !== base58Encode(raw.slice(32))) throw new Error("That key is damaged: its public half does not match its private half");
    return { kind: "key", seed, address: kp.publicKey.toBase58() };
  } finally {
    raw.fill(0);
  }
}

/** Phantom's export format: base58 of the 64-byte secret key (seed ‖ public key). */
export function exportSecretKey(seed: Uint8Array): string {
  const kp = Keypair.fromSeed(seed);
  const sk = kp.secretKey;
  const out = base58Encode(sk);
  sk.fill(0);
  return out;
}
