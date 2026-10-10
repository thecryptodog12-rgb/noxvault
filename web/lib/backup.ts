import { normalizeWords } from "@nox/sdk/wots";
// Phrase backups, entirely local: Shamir shares and password-encrypted files.
// Nothing in this file touches the network.
import { split, combine } from "shamir-secret-sharing";
import { sha256 } from "@noble/hashes/sha256";
import { scryptAsync } from "@noble/hashes/scrypt";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- phrase ----------

export function normalizePhrase(words: string): string {
  return normalizeWords(words).join(" ");
}

/** Same rules as sdk/client wordsToSecret: 24 valid BIP39 words = 32-byte master secret. */
export function phraseToSecret(words: string): Uint8Array {
  const clean = normalizePhrase(words);
  if (!validateMnemonic(clean, wordlist)) throw new Error("Those words are not a valid Noxvault phrase");
  const master = mnemonicToEntropy(clean, wordlist);
  if (master.length !== 32) throw new Error("A Noxvault phrase is 24 words");
  return master;
}

export function secretToPhrase(master: Uint8Array): string {
  return entropyToMnemonic(master, wordlist);
}

/** Short public fingerprint of a phrase (24 bits of a domain-separated hash), to tell backups apart. */
export function phraseFingerprint(master: Uint8Array): Uint8Array {
  return sha256(concat(enc.encode("nox2/backup-fp"), master)).slice(0, 3);
}

export const fingerprintHex = (master: Uint8Array) => toHex(phraseFingerprint(master));

// ---------- Shamir shares ----------
//
// A share is 42 bytes:  version(1) | k(1) | n(1) | i(1) | fingerprint(3) | shamir share(33) | checksum(2)
// checksum = first 2 bytes of sha256 over the 40 bytes before it. Shown as 31 words (11 bits each,
// BIP39 English list, padded with zero bits) or as 84 hex characters.

const SHARE_VERSION = 1;
const SHARE_BODY = 40;
const SHARE_LEN = 42;
export const SHARE_WORDS = Math.ceil((SHARE_LEN * 8) / 11); // 31

export interface Share {
  k: number;
  n: number;
  index: number; // 1-based
  fingerprint: string; // hex
  raw: Uint8Array; // the 42 encoded bytes
  words: string;
  hex: string;
}

function encodeShare(k: number, n: number, index: number, fp: Uint8Array, data: Uint8Array): Share {
  if (data.length !== 33) throw new Error("unexpected share length");
  const body = concat(Uint8Array.of(SHARE_VERSION, k, n, index), fp, data);
  const raw = concat(body, sha256(body).slice(0, 2));
  return { k, n, index, fingerprint: toHex(fp), raw, words: bytesToWords(raw), hex: toHex(raw) };
}

/** Parses one share from its words or its hex form. Throws on a typo (checksum). */
export function parseShare(text: string): Share {
  const t = text.trim().toLowerCase();
  let raw: Uint8Array;
  const compact = t.replace(/[\s-]/g, "");
  if (/^[0-9a-f]+$/.test(compact) && compact.length === SHARE_LEN * 2) raw = fromHex(compact);
  else raw = wordsToBytes(t, SHARE_LEN);
  if (raw.length !== SHARE_LEN) throw new Error("A share is 31 words or 84 hex characters");
  const body = raw.slice(0, SHARE_BODY);
  const sum = raw.slice(SHARE_BODY);
  if (!equalBytes(sha256(body).slice(0, 2), sum)) throw new Error("This share has a typo (checksum does not match)");
  const [v, k, n, index] = body;
  if (v !== SHARE_VERSION) throw new Error(`Unknown share version ${v}`);
  if (k < 2 || n < k || index < 1 || index > n) throw new Error("This share has an invalid header");
  return { k, n, index, fingerprint: toHex(body.slice(4, 7)), raw, words: bytesToWords(raw), hex: toHex(raw) };
}

/** Splits a 24-word phrase into n shares, any k of which restore it. */
export async function splitPhrase(words: string, n: number, k: number): Promise<Share[]> {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 2 || n < k || n > 16)
    throw new Error("Pick 2 ≤ K ≤ N ≤ 16");
  const master = phraseToSecret(words);
  const fp = phraseFingerprint(master);
  const parts = await split(master, n, k);
  return parts.map((p, i) => encodeShare(k, n, i + 1, fp, p));
}

/** Restores the phrase from at least k shares and checks it against the shares' fingerprint. */
export async function restorePhrase(texts: string[]): Promise<{ words: string; fingerprint: string; used: number }> {
  const shares = texts.map((t) => t.trim()).filter(Boolean).map(parseShare);
  if (!shares.length) throw new Error("Enter at least two shares");
  const { k, n, fingerprint } = shares[0];
  for (const s of shares) {
    if (s.k !== k || s.n !== n || s.fingerprint !== fingerprint)
      throw new Error("These shares come from different backups (their headers differ)");
  }
  const unique = new Map(shares.map((s) => [s.index, s]));
  if (unique.size < k) throw new Error(`Need ${k} different shares, have ${unique.size}`);
  const chosen = [...unique.values()].slice(0, k);
  const master = await combine(chosen.map((s) => s.raw.slice(7, 40)));
  if (master.length !== 32 || fingerprintHex(master) !== fingerprint)
    throw new Error("The shares did not combine into the original phrase");
  const phrase = secretToPhrase(master);
  // Re-derive: the phrase must turn back into the same secret.
  if (!equalBytes(phraseToSecret(phrase), master)) throw new Error("Restored phrase does not re-derive");
  return { words: phrase, fingerprint, used: chosen.length };
}

// ---------- encrypted file ----------

export const KDF_DEFAULT = { name: "scrypt" as const, N: 1 << 17, r: 8, p: 1 };

export interface BackupFile {
  v: 1;
  app: "noxvault";
  kdf: { name: "scrypt"; N: number; r: number; p: number };
  cipher: "aes-256-gcm";
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64 (ciphertext || 16-byte tag)
  fingerprint: string; // public, hex: tells which phrase this file holds without the password
  created: string; // ISO date
}

interface Plain {
  words: string;
  label?: string;
}

const AAD = enc.encode("noxvault-backup-v1");

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("This browser has no WebCrypto (needs https or localhost)");
  return c.subtle;
}

async function deriveKey(password: string, salt: Uint8Array, kdf: BackupFile["kdf"]): Promise<CryptoKey> {
  if (kdf.name !== "scrypt") throw new Error("Unknown key derivation");
  if (kdf.N > 1 << 20 || kdf.r > 16 || kdf.p > 4) throw new Error("Key derivation parameters too large");
  const raw = await scryptAsync(enc.encode(password.normalize("NFKC")), salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32 });
  return subtle().importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptBackup(words: string, password: string, label?: string, kdf = KDF_DEFAULT): Promise<BackupFile> {
  if (!password) throw new Error("Choose a password");
  const master = phraseToSecret(words);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, kdf);
  const plain: Plain = { words: normalizePhrase(words), ...(label ? { label } : {}) };
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: AAD }, key, enc.encode(JSON.stringify(plain)))
  );
  return {
    v: 1,
    app: "noxvault",
    kdf: { ...kdf },
    cipher: "aes-256-gcm",
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
    fingerprint: fingerprintHex(master),
    created: new Date().toISOString(),
  };
}

export function parseBackupFile(text: string): BackupFile {
  let f: BackupFile;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error("That is not a Noxvault backup file (not JSON)");
  }
  if (!f || f.v !== 1 || !f.kdf || typeof f.salt !== "string" || typeof f.iv !== "string" || typeof f.ct !== "string")
    throw new Error("That is not a Noxvault backup file");
  return f;
}

export async function decryptBackup(file: BackupFile, password: string): Promise<Plain & { fingerprint: string }> {
  const key = await deriveKey(password, fromB64(file.salt), file.kdf);
  let pt: ArrayBuffer;
  try {
    pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(file.iv) as BufferSource, additionalData: AAD },
      key,
      fromB64(file.ct) as BufferSource
    );
  } catch {
    throw new Error("Wrong password, or the file was changed");
  }
  const plain = JSON.parse(dec.decode(pt)) as Plain;
  const master = phraseToSecret(plain.words);
  return { ...plain, fingerprint: fingerprintHex(master) };
}

// ---------- password strength ----------

export interface Strength {
  bits: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hints: string[];
}

const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "admin", "iloveyou", "monkey", "dragon", "solana", "noxvault", "bitcoin", "abc123"];

/** Rough entropy estimate. Rewards length and passphrases, punishes repeats and common words. */
export function passwordStrength(pw: string): Strength {
  const hints: string[] = [];
  if (!pw) return { bits: 0, score: 0, label: "empty", hints: ["Use 4 or more random words, or 14+ mixed characters."] };
  const words = pw.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3);
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const unique = new Set(pw).size;
  let bits = Math.min(pw.length, unique * 2) * Math.log2(Math.max(pool, 2));
  // A passphrase of dictionary-ish words: ~11 bits per random word is the honest estimate.
  if (words.length >= 3) bits = Math.max(Math.min(bits, words.length * 13), words.length * 11);
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) {
    bits = Math.min(bits, 20);
    hints.push("Contains a very common password.");
  }
  if (/(.)\1{2,}/.test(pw)) {
    bits *= 0.75;
    hints.push("Avoid repeated characters.");
  }
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/i.test(pw)) {
    bits *= 0.7;
    hints.push("Avoid sequences.");
  }
  if (pw.length < 12) hints.push("Make it longer: length beats complexity.");
  const score = (bits < 35 ? 0 : bits < 50 ? 1 : bits < 65 ? 2 : bits < 85 ? 3 : 4) as Strength["score"];
  const label = ["very weak", "weak", "fair", "strong", "very strong"][score];
  return { bits: Math.round(bits), score, label, hints };
}

// ---------- bytes ----------

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function fromHex(h: string): Uint8Array {
  if (h.length % 2 || !/^[0-9a-f]*$/i.test(h)) throw new Error("bad hex");
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
}

function toB64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Packs bytes into 11-bit groups, one BIP39 word each (no BIP39 checksum; ours is inside the bytes). */
export function bytesToWords(b: Uint8Array): string {
  let acc = 0;
  let nbits = 0;
  const out: string[] = [];
  for (const x of b) {
    acc = (acc << 8) | x;
    nbits += 8;
    while (nbits >= 11) {
      nbits -= 11;
      out.push(wordlist[(acc >> nbits) & 0x7ff]);
    }
    acc &= (1 << nbits) - 1;
  }
  if (nbits > 0) out.push(wordlist[(acc << (11 - nbits)) & 0x7ff]);
  return out.join(" ");
}

export function wordsToBytes(text: string, len: number): Uint8Array {
  const words = normalizeWords(text);
  const want = Math.ceil((len * 8) / 11);
  if (words.length !== want) throw new Error(`A share is ${want} words (got ${words.length})`);
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  for (const w of words) {
    const i = wordlist.indexOf(w);
    if (i < 0) throw new Error(`"${w}" is not a word from the list`);
    acc = (acc << 11) | i;
    nbits += 11;
    while (nbits >= 8 && out.length < len) {
      nbits -= 8;
      out.push((acc >> nbits) & 0xff);
    }
    acc &= (1 << nbits) - 1;
  }
  return Uint8Array.from(out);
}
