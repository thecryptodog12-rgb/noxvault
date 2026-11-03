"use client";
// Sealed letters (docs/SPEC.md §12): tlock encryption to drand quicknet, the vault's letter key,
// and this browser's encrypted copy of the letter texts that rolling re-encryption needs.
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { timelockDecrypt, timelockEncrypt, mainnetClient, roundAt, roundTime, defaultChainInfo, Buffer as TBuffer } from "tlock-js";
import {
  MAX_LETTER,
  closeLetterIx,
  fetchLetterKey,
  vaultLetters,
  writeLetterIxs,
  type LetterView,
  type Noxvault,
  type Signer,
  type VaultStateView,
} from "@nox/sdk/client";

/** Extra time on top of the testament delay before a letter opens. */
export const LETTER_MARGIN_SECS = 7 * 86_400;
/** Auto-refresh only once a letter's opening date has come at least this much closer. */
export const REFRESH_SLACK_SECS = 86_400;

// ---------- drand quicknet rounds ----------

// tlock-js's default chain is drand quicknet (3 s rounds, chain 52db9ba7…).
const CHAIN = defaultChainInfo;

export function roundForTime(unixSecs: number): number {
  return roundAt(unixSecs * 1000, CHAIN);
}
/** Unix seconds at which `round` is published (and the letter becomes readable). */
export function timeOfRound(round: number | bigint): number {
  return Math.floor(roundTime(CHAIN, Number(round)) / 1000);
}
export function currentRound(): number {
  return roundForTime(Math.floor(Date.now() / 1000));
}

// ---------- what goes inside the timelock ----------

export interface LetterBody {
  text: string;
}

interface Inner {
  v: 1;
  t?: string;
  /** Optional extra layer: AES-GCM under a passphrase the heir knows (PBKDF2-SHA256). */
  pw?: { s: string; i: string; c: string };
}

const b64 = (b: Uint8Array) => TBuffer.from(b).toString("base64");
const unb64 = (s: string) => new Uint8Array(TBuffer.from(s, "base64"));
/** A copy backed by a plain ArrayBuffer, as WebCrypto's types want. */
const ab = (u: Uint8Array) => new Uint8Array(u);
const enc = new TextEncoder();
const dec = new TextDecoder();
const PBKDF2_ITERS = 210_000;

async function passKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: ab(salt), iterations: PBKDF2_ITERS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Encrypts a letter to a drand round. Returns the age ciphertext as binary bytes (no armor). */
export async function sealLetter(round: number, text: string, passphrase?: string): Promise<Uint8Array> {
  let inner: Inner = { v: 1, t: text };
  if (passphrase) {
    const s = crypto.getRandomValues(new Uint8Array(16));
    const i = crypto.getRandomValues(new Uint8Array(12));
    const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: i }, await passKey(passphrase, s), enc.encode(text)));
    inner = { v: 1, pw: { s: b64(s), i: b64(i), c: b64(c) } };
  }
  const armored = await timelockEncrypt(round, TBuffer.from(JSON.stringify(inner)), mainnetClient());
  const body = armored.replace(/-----(BEGIN|END) AGE ENCRYPTED FILE-----/g, "").replace(/\s+/g, "");
  const bytes = unb64(body);
  if (bytes.length > MAX_LETTER) throw new Error(`This letter is ${bytes.length} bytes once sealed; the limit is ${MAX_LETTER}. Shorten it.`);
  return bytes;
}

export type Opened = { kind: "text"; text: string } | { kind: "passphrase"; open: (pass: string) => Promise<string> };

/** Decrypts a sealed letter whose round has passed (fetches the drand beacon). */
export async function openLetter(ciphertext: Uint8Array): Promise<Opened> {
  const plain = await timelockDecrypt(TBuffer.from(ciphertext).toString("binary"), mainnetClient());
  const inner = JSON.parse(dec.decode(plain)) as Inner;
  if (inner.pw) {
    const { s, i, c } = inner.pw;
    return {
      kind: "passphrase",
      open: async (pass: string) => {
        try {
          return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(i) }, await passKey(pass, unb64(s)), unb64(c)));
        } catch {
          throw new Error("Wrong passphrase.");
        }
      },
    };
  }
  return { kind: "text", text: inner.t ?? "" };
}

// ---------- this browser's copy: letter key + texts, encrypted under the owner's phrase ----------

export interface LocalLetter {
  id: number;
  label: string;
  text: string;
  /** Extra passphrase for the heir, if any (kept so a refresh can re-seal the same way). */
  pass?: string;
  /** Seconds from "now" to the opening date; every refresh moves the date forward by this. */
  horizon: number;
}

export interface LocalLetters {
  key: Keypair;
  letters: LocalLetter[];
}

interface Stored {
  v: 1;
  what: string;
  pub: string;
  iv: string;
  ct: string;
}

const storeKey = (vault: PublicKey) => `nox4.letters.${vault.toBase58()}`;
const LABEL = "Noxvault sealed letters: letter key and letter texts, AES-GCM encrypted under a key derived from your phrase";

async function localAesKey(signer: Signer, vault: PublicKey) {
  const raw = hkdf(sha256, signer.seeds.skSeed, vault.toBytes(), enc.encode("nox4/letters/local"), 32);
  return crypto.subtle.importKey("raw", ab(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function loadLocalLetters(signer: Signer, vault: PublicKey): Promise<LocalLetters | null> {
  let s: Stored;
  try {
    const raw = localStorage.getItem(storeKey(vault));
    if (!raw) return null;
    s = JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) }, await localAesKey(signer, vault), unb64(s.ct)).catch(() => null);
  if (!plain) throw new Error("This browser holds sealed letters for this vault, but they were stored under a different phrase.");
  const j = JSON.parse(dec.decode(plain)) as { key: string; letters: LocalLetter[] };
  return { key: Keypair.fromSecretKey(unb64(j.key)), letters: j.letters };
}

export async function saveLocalLetters(signer: Signer, vault: PublicKey, l: LocalLetters) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ key: b64(l.key.secretKey), letters: l.letters }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await localAesKey(signer, vault), body));
  const s: Stored = { v: 1, what: LABEL, pub: l.key.publicKey.toBase58(), iv: b64(iv), ct: b64(ct) };
  localStorage.setItem(storeKey(vault), JSON.stringify(s));
}

export function forgetLocalLetters(vault: PublicKey) {
  try {
    localStorage.removeItem(storeKey(vault));
  } catch {}
}

// ---------- opening dates ----------

/** Whether the vault's testament is set: letters then follow it (delay + margin). */
export function testamentHorizon(state: VaultStateView): number | null {
  const c = state.config;
  if (c.testamentDelay <= 0n || !c.heirs.length) return null;
  return Number(c.testamentDelay) + LETTER_MARGIN_SECS;
}

/** When a letter should open if it were sealed now. */
export function targetOpen(l: LocalLetter, now = Math.floor(Date.now() / 1000)): number {
  return now + l.horizon;
}

// ---------- writing with the letter key ----------

async function sendWithKey(conn: Connection, kp: Keypair, ix: TransactionInstruction): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(ix);
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 3 });
      const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
      return sig;
    } catch (e) {
      if (attempt >= 4 || !/Blockhash not found|block height exceeded|expired/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

/** Seals `l` to its rolling date and writes it on chain with the letter key. */
export async function writeLetter(program: Program<Noxvault>, vault: PublicKey, key: Keypair, l: LocalLetter, onStep?: (msg: string) => void): Promise<bigint> {
  const conn = program.provider.connection;
  const round = roundForTime(targetOpen(l));
  onStep?.(`sealing "${l.label || `#${l.id}`}" to drand round ${round}`);
  const ciphertext = await sealLetter(round, l.text, l.pass);
  const ixs = await writeLetterIxs(program, key.publicKey, vault, l.id, { unlockRound: BigInt(round), label: l.label, ciphertext });
  const rent = await conn.getMinimumBalanceForRentExemption(8 + 32 + 4 + 8 + 8 + 4 + 4 + enc.encode(l.label).length + 4 + ciphertext.length);
  const balance = await conn.getBalance(key.publicKey, "confirmed");
  if (balance < rent + ixs.length * 5000) throw new Error(`The letter key needs about ${((rent + ixs.length * 5000) / 1e9).toFixed(4)} SOL to write this letter (it holds ${(balance / 1e9).toFixed(4)}). Top it up first.`);
  for (const [i, ix] of ixs.entries()) {
    onStep?.(`writing "${l.label || `#${l.id}`}" ${i + 1}/${ixs.length}`);
    await sendWithKey(conn, key, ix);
  }
  return BigInt(round);
}

export async function deleteLetter(program: Program<Noxvault>, vault: PublicKey, key: Keypair, id: number) {
  await sendWithKey(program.provider.connection, key, await closeLetterIx(program, key.publicKey, vault, id));
}

export interface RefreshResult {
  refreshed: number;
  skipped: number;
  errors: string[];
}

/**
 * Re-seals every locally known letter to a later round. Without `force`, only letters whose
 * opening date has come at least REFRESH_SLACK_SECS closer (or that are missing on chain).
 */
export async function refreshLetters(
  program: Program<Noxvault>,
  vault: PublicKey,
  local: LocalLetters,
  opts: { force?: boolean; onStep?: (msg: string) => void } = {}
): Promise<RefreshResult> {
  const onChainKey = await fetchLetterKey(program, vault);
  if (!onChainKey || !onChainKey.key.equals(local.key.publicKey)) throw new Error("This browser's letter key is not the vault's authorized letter key.");
  const chain = new Map<number, LetterView>((await vaultLetters(program, vault)).map((l) => [l.id, l]));
  const now = Math.floor(Date.now() / 1000);
  const out: RefreshResult = { refreshed: 0, skipped: 0, errors: [] };
  for (const l of local.letters) {
    const c = chain.get(l.id);
    const fresh = c && c.complete && timeOfRound(c.unlockRound) >= targetOpen(l, now) - REFRESH_SLACK_SECS;
    if (fresh && !opts.force) {
      out.skipped++;
      continue;
    }
    try {
      await writeLetter(program, vault, local.key, l, opts.onStep);
      out.refreshed++;
    } catch (e) {
      out.errors.push(`${l.label || `#${l.id}`}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
