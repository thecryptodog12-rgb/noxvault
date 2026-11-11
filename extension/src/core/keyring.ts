// The encrypted keyring: the 24-word phrases of every account in this extension, encrypted with the
// user's password. Only this ciphertext is ever written to disk (chrome.storage.local).
//
//   key  = PBKDF2-HMAC-SHA256(password NFKC, salt 16 random bytes, 600 000 iterations) → 256 bits
//   blob = AES-256-GCM(key, iv 12 random bytes, aad "noxvault-extension-keyring-v1", JSON plaintext)
//
// A fresh salt and IV are drawn for every save. Pure WebCrypto: runs in pages, the service worker
// and Node (tests). No plaintext is returned except by decryptKeyring.

export const KDF_ITERATIONS = 600_000;
const AAD = new TextEncoder().encode("noxvault-extension-keyring-v1");

export interface EncryptedKeyring {
  v: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number };
  cipher: "AES-256-GCM";
  salt: string; // base64, 16 bytes
  iv: string; // base64, 12 bytes
  ct: string; // base64, ciphertext || 16-byte tag
}

export interface KeyringAccount {
  id: string;
  words: string;
}

export interface KeyringPlain {
  accounts: KeyringAccount[];
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WrongPasswordError";
  }
}

export const MIN_PASSWORD = 8;

/** Why a new password is refused, or null when it is acceptable. */
export function passwordProblem(pw: string, repeat?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (/^(.)\1+$/.test(pw)) return "Do not repeat one character.";
  if (/^(password|12345678|123456789|qwertyui|noxvault)/i.test(pw)) return "That password is too common.";
  if (repeat !== undefined && pw !== repeat) return "The two passwords differ.";
  return null;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto is not available");
  return s;
}

const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function toB64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", new TextEncoder().encode(password.normalize("NFKC")) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptKeyring(plain: KeyringPlain, password: string): Promise<EncryptedKeyring> {
  if (!password) throw new Error("Choose a password");
  const salt = rand(16);
  const iv = rand(12);
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const pt = new TextEncoder().encode(JSON.stringify(plain));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: AAD as BufferSource }, key, pt as BufferSource));
  pt.fill(0);
  return { v: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS }, cipher: "AES-256-GCM", salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

/** Throws WrongPasswordError on a wrong password or a modified blob. */
export async function decryptKeyring(blob: EncryptedKeyring, password: string): Promise<KeyringPlain> {
  if (!blob || blob.v !== 1 || blob.kdf?.name !== "PBKDF2" || blob.cipher !== "AES-256-GCM") throw new Error("Unknown keyring format");
  // Never accept weaker parameters than we write (a tampered blob could lower them).
  if (blob.kdf.iterations < KDF_ITERATIONS) throw new Error("Keyring key-derivation parameters are too weak");
  const key = await deriveKey(password, fromB64(blob.salt), blob.kdf.iterations);
  let pt: Uint8Array;
  try {
    pt = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) as BufferSource, additionalData: AAD as BufferSource }, key, fromB64(blob.ct) as BufferSource));
  } catch {
    throw new WrongPasswordError();
  }
  const plain = JSON.parse(new TextDecoder().decode(pt)) as KeyringPlain;
  pt.fill(0);
  if (!plain || !Array.isArray(plain.accounts)) throw new Error("Keyring is damaged");
  return plain;
}
