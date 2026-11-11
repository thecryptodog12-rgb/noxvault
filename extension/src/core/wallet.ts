// Accounts and the lock: create / import a phrase, unlock with the password, reveal, add, remove.
// Plaintext phrases exist only inside these functions; what is stored is the encrypted keyring
// (keyring.ts) and public account facts. Unlocking puts each master in chrome.storage.session.
import { sha256 } from "@noble/hashes/sha256";
import { secretToWords, wordsToSecret } from "../../../sdk/client";
import { hex } from "../../../web/lib/format";
import { load, save, type AccountMeta } from "../lib/store";
import { feeKeypair } from "./feeAccount";
import { WrongPasswordError, decryptKeyring, encryptKeyring, passwordProblem, type KeyringPlain } from "./keyring";
import { lock, readUnlocked, writeUnlocked } from "./session";

const FP = new TextEncoder().encode("nox-ext/fingerprint/v1");

export function fingerprint(master: Uint8Array): string {
  const b = new Uint8Array(FP.length + master.length);
  b.set(FP);
  b.set(master, FP.length);
  const out = hex(sha256(b).slice(0, 3));
  b.fill(0);
  return out;
}

const newId = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(6)));

function metaFor(id: string, name: string, master: Uint8Array): AccountMeta {
  return { id, name: name.trim().slice(0, 24) || "Account", fingerprint: fingerprint(master), feeAddress: feeKeypair(master).publicKey.toBase58(), createdAt: Math.floor(Date.now() / 1000) };
}

/** Normalized 24 words, or throws (same rules as the site: sdk wordsToSecret). */
export function cleanPhrase(words: string): { words: string; master: Uint8Array } {
  const master = wordsToSecret(words);
  return { words: secretToWords(master), master };
}

export async function hasWallet(): Promise<boolean> {
  const { keyring } = await load("keyring");
  return !!keyring;
}

async function unlockWith(plain: KeyringPlain): Promise<void> {
  const masters: Record<string, string> = {};
  for (const a of plain.accounts) {
    const m = wordsToSecret(a.words);
    masters[a.id] = hex(m);
    m.fill(0);
  }
  await writeUnlocked(masters);
}

/** First run: encrypt the phrase under a new password and unlock. */
export async function createWallet(words: string, password: string, name = "Account 1"): Promise<AccountMeta> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (await hasWallet()) throw new Error("This extension already has a wallet. Reset it first.");
  const { words: clean, master } = cleanPhrase(words);
  const id = newId();
  const meta = metaFor(id, name, master);
  master.fill(0);
  const plain: KeyringPlain = { accounts: [{ id, words: clean }] };
  const keyring = await encryptKeyring(plain, password);
  await save({ keyring, accounts: [meta], activeAccount: id, unlockFails: { count: 0, until: 0 } });
  await unlockWith(plain);
  return meta;
}

/** Wait after repeated wrong passwords: 5 → 30 s, then doubling, at most 15 min. */
export function failDelaySecs(count: number): number {
  return count < 5 ? 0 : Math.min(900, 30 * 2 ** (count - 5));
}

/** Throws WrongPasswordError (and counts it) or "wait" errors. */
export async function unlockWallet(password: string): Promise<void> {
  const { keyring, unlockFails } = await load("keyring", "unlockFails");
  if (!keyring) throw new Error("No wallet yet");
  const now = Math.floor(Date.now() / 1000);
  if (unlockFails.until > now) throw new Error(`Too many wrong passwords. Try again in ${unlockFails.until - now} s.`);
  let plain: KeyringPlain;
  try {
    plain = await decryptKeyring(keyring, password);
  } catch (e) {
    if (e instanceof WrongPasswordError) {
      const count = unlockFails.count + 1;
      await save({ unlockFails: { count, until: now + failDelaySecs(count) } });
    }
    throw e;
  }
  await save({ unlockFails: { count: 0, until: 0 } });
  await unlockWith(plain);
}

/** Decrypts with the password (for reveal / add / remove). Does not count as a failed unlock. */
async function openKeyring(password: string): Promise<KeyringPlain> {
  const { keyring } = await load("keyring");
  if (!keyring) throw new Error("No wallet yet");
  return decryptKeyring(keyring, password);
}

export async function revealPhrase(password: string, accountId: string): Promise<string> {
  const plain = await openKeyring(password);
  const a = plain.accounts.find((x) => x.id === accountId);
  if (!a) throw new Error("No such account");
  return a.words;
}

/** Adds another phrase (new or imported) under the same password. */
export async function addAccount(words: string, password: string, name: string): Promise<AccountMeta> {
  const plain = await openKeyring(password);
  const { words: clean, master } = cleanPhrase(words);
  const { accounts } = await load("accounts");
  const fp = fingerprint(master);
  if (accounts.some((a) => a.fingerprint === fp) && plain.accounts.some((a) => a.words === clean)) {
    master.fill(0);
    throw new Error("That phrase is already in this extension.");
  }
  const id = newId();
  const meta = metaFor(id, name || `Account ${accounts.length + 1}`, master);
  master.fill(0);
  plain.accounts.push({ id, words: clean });
  await save({ keyring: await encryptKeyring(plain, password), accounts: [...accounts, meta], activeAccount: id });
  await unlockWith(plain);
  return meta;
}

/** Removes an account's phrase from the keyring, and the vaults it owned from the list. */
export async function removeAccount(password: string, accountId: string): Promise<void> {
  const plain = await openKeyring(password);
  if (plain.accounts.length <= 1) throw new Error("This is the only account. Use Reset to remove everything.");
  plain.accounts = plain.accounts.filter((a) => a.id !== accountId);
  const { accounts, watched, activeAccount } = await load("accounts", "watched", "activeAccount");
  const rest = accounts.filter((a) => a.id !== accountId);
  await save({
    keyring: await encryptKeyring(plain, password),
    accounts: rest,
    watched: watched.filter((w) => w.accountId !== accountId),
    activeAccount: activeAccount === accountId ? rest[0].id : activeAccount,
  });
  if (await readUnlocked()) await unlockWith(plain);
}

export async function renameAccount(accountId: string, name: string): Promise<void> {
  const { accounts } = await load("accounts");
  await save({ accounts: accounts.map((a) => (a.id === accountId ? { ...a, name: name.trim().slice(0, 24) || a.name } : a)) });
}

/**
 * Forgets every phrase and every vault owned through them. Watched addresses stay, and so do the
 * frozen-action / attempted markers (public data that keeps one-time keys safe if the same phrase
 * is imported again while a send may still be in flight).
 */
export async function resetWallet(): Promise<void> {
  await lock();
  const { watched } = await load("watched");
  await save({
    keyring: null,
    accounts: [],
    activeAccount: "",
    unlockFails: { count: 0, until: 0 },
    watched: watched.filter((w) => !w.accountId).map((w) => ({ ...w, role: "watch" as const })),
  });
}
