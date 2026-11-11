// Accounts and the lock: create / import a phrase, unlock with the password, reveal, add, remove.
// Plaintext phrases exist only inside these functions; what is stored is the encrypted keyring
// (keyring.ts) and public account facts. Unlocking puts each master in chrome.storage.session.
import { sha256 } from "@noble/hashes/sha256";
import { secretToWords, wordsToSecret } from "../../../sdk/client";
import { hex } from "../../../web/lib/format";
import type { Keypair } from "@solana/web3.js";
import { load, save, type AccountMeta, type StoreShape, type WalletMeta } from "../lib/store";
import { feeKeypair } from "./feeAccount";
import { addressOfSeed, exportSecretKey, keypairFromSeed, masterAccountSeed, parseImport, phraseAccountSeed } from "./hd";
import { WrongPasswordError, decryptKeyring, encryptKeyring, passwordProblem, type KeyringPlain } from "./keyring";
import { lock, masterFor, putWalletSeeds, readUnlocked, walletSeedFor, writeUnlocked } from "./session";

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
  return { id, name: name.trim().slice(0, 24) || "Account", fingerprint: fingerprint(master), feeAddress: feeKeypair(master).publicKey.toBase58(), createdAt: Math.floor(Date.now() / 1000), walletsInit: true };
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

/** The ed25519 seed of a wallet account from the decrypted keyring. Caller zeroes it. */
function seedOf(w: WalletMeta, plain: KeyringPlain): Uint8Array | null {
  if (w.kind === "derived" || w.kind === "legacy-fee") {
    const a = plain.accounts.find((x) => x.id === w.phraseId);
    if (!a) return null;
    const m = wordsToSecret(a.words);
    try {
      if (w.kind === "legacy-fee") return feeKeypair(m).secretKey.slice(0, 32);
      return masterAccountSeed(m, w.index ?? 0);
    } finally {
      m.fill(0);
    }
  }
  const imp = plain.imports?.find((x) => x.id === w.id);
  if (!imp) return null;
  if (imp.kind === "phrase" && imp.words) return phraseAccountSeed(imp.words, imp.index ?? 0);
  if (imp.kind === "key" && imp.seed) return fromHex(imp.seed);
  return null;
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/**
 * v0.3 migration + session: every phrase gets its wallet account #0 (m/44'/501'/0'/0'); a phrase from a
 * v0.2 install (no `walletsInit`) also keeps its old fee account, listed as a wallet so its SOL is never
 * stranded. Then the seeds of all wallet accounts go into the unlocked session next to the masters.
 */
async function unlockWith(plain: KeyringPlain): Promise<void> {
  const masters: Record<string, string> = {};
  for (const a of plain.accounts) {
    const m = wordsToSecret(a.words);
    masters[a.id] = hex(m);
    m.fill(0);
  }
  const { accounts, wallets, activeWallet } = await load("accounts", "wallets", "activeWallet");
  let list = [...wallets];
  let metas = accounts;
  let changed = false;
  for (const meta of accounts) {
    const a = plain.accounts.find((x) => x.id === meta.id);
    if (!a) continue;
    if (!list.some((w) => w.kind === "derived" && w.phraseId === meta.id)) {
      const m = wordsToSecret(a.words);
      const seed = masterAccountSeed(m, 0);
      m.fill(0);
      list.push({ id: newId(), name: `Wallet ${list.filter((w) => w.kind !== "watch").length + 1}`, address: addressOfSeed(seed), kind: "derived", phraseId: meta.id, index: 0, createdAt: now() });
      seed.fill(0);
      changed = true;
    }
    if (!meta.walletsInit) {
      if (!list.some((w) => w.kind === "legacy-fee" && w.phraseId === meta.id))
        list.push({ id: newId(), name: "Fee account (v0.2)", address: meta.feeAddress, kind: "legacy-fee", phraseId: meta.id, createdAt: now() });
      metas = metas.map((x) => (x.id === meta.id ? { ...x, walletsInit: true } : x));
      changed = true;
    }
  }
  const seeds: Record<string, string> = {};
  for (const w of list) {
    if (w.kind === "watch") continue;
    const s = seedOf(w, plain);
    if (s) {
      seeds[w.id] = hex(s);
      s.fill(0);
    }
  }
  if (changed || !list.some((w) => w.id === activeWallet)) {
    const pick = list.some((w) => w.id === activeWallet) ? activeWallet : (list.find((w) => w.kind === "derived") ?? list[0])?.id ?? "";
    list = list.slice(0, MAX_WALLETS);
    await save({ wallets: list, accounts: metas, activeWallet: pick });
  }
  await writeUnlocked(masters, seeds);
}

const now = () => Math.floor(Date.now() / 1000);
export const MAX_WALLETS = 20;

// ---------- v0.3 wallet accounts ----------

/** Adds the next derived account (m/44'/501'/i'/0', the lowest index not listed) of a phrase. Needs the wallet unlocked. */
export async function addDerivedWallet(phraseId: string, autoLockMin: number, name?: string): Promise<WalletMeta> {
  const m = await masterFor(phraseId, autoLockMin);
  if (!m) throw new Error("The wallet is locked. Unlock it and try again.");
  const { wallets } = await load("wallets");
  if (wallets.length >= MAX_WALLETS) throw new Error(`Up to ${MAX_WALLETS} wallet accounts.`);
  const used = new Set(wallets.filter((w) => w.kind === "derived" && w.phraseId === phraseId).map((w) => w.index));
  let index = 0;
  while (used.has(index)) index++;
  const seed = masterAccountSeed(m, index);
  m.fill(0);
  const meta: WalletMeta = { id: newId(), name: (name ?? "").trim().slice(0, 24) || `Wallet ${wallets.filter((w) => w.kind !== "watch").length + 1}`, address: addressOfSeed(seed), kind: "derived", phraseId, index, createdAt: now() };
  await putWalletSeeds({ [meta.id]: hex(seed) });
  seed.fill(0);
  await save({ wallets: [...wallets, meta], activeWallet: meta.id });
  return meta;
}

/**
 * Imports an existing Solana wallet (a 12–24 word BIP39 phrase + account index, or a private key) as an
 * extra wallet account. Its secret is added to the encrypted keyring under the same password.
 */
export async function importWallet(input: string, password: string, name: string, index = 0): Promise<WalletMeta> {
  const parsed = parseImport(input);
  if (!Number.isInteger(index) || index < 0 || index > 999) throw new Error("Account index is 0–999");
  const plain = await openKeyring(password);
  const { wallets } = await load("wallets");
  if (wallets.length >= MAX_WALLETS) throw new Error(`Up to ${MAX_WALLETS} wallet accounts.`);
  let seed: Uint8Array;
  if (parsed.kind === "phrase") seed = phraseAccountSeed(parsed.words, index);
  else seed = parsed.seed;
  const address = addressOfSeed(seed);
  const existing = wallets.find((w) => w.address === address);
  if (existing && existing.kind !== "watch") {
    seed.fill(0);
    throw new Error(`That wallet is already here (${existing.name}).`);
  }
  const id = newId();
  plain.imports = [...(plain.imports ?? []), parsed.kind === "phrase" ? { id, kind: "phrase", words: parsed.words, index } : { id, kind: "key", seed: hex(seed) }];
  const meta: WalletMeta = {
    id,
    name: name.trim().slice(0, 24) || `Imported ${wallets.filter((w) => w.kind.startsWith("imported")).length + 1}`,
    address,
    kind: parsed.kind === "phrase" ? "imported-phrase" : "imported-key",
    ...(parsed.kind === "phrase" ? { index } : {}),
    createdAt: now(),
  };
  const rest = wallets.filter((w) => w.address !== address); // a watch entry of the same address becomes this one
  await save({ keyring: await encryptKeyring(plain, password), wallets: [...rest, meta], activeWallet: id });
  await putWalletSeeds({ [id]: hex(seed) });
  seed.fill(0);
  return meta;
}

/** A watch-only wallet: any address, no key. Shows holdings and activity; cannot send. */
export async function addWatchWallet(address: string, name: string): Promise<WalletMeta> {
  const { wallets } = await load("wallets");
  if (wallets.length >= MAX_WALLETS) throw new Error(`Up to ${MAX_WALLETS} wallet accounts.`);
  if (wallets.some((w) => w.address === address)) throw new Error("That address is already in the list.");
  const meta: WalletMeta = { id: newId(), name: name.trim().slice(0, 24) || "Watched", address, kind: "watch", createdAt: now() };
  await save({ wallets: [...wallets, meta], activeWallet: meta.id });
  return meta;
}

export async function renameWallet(id: string, name: string): Promise<void> {
  const { wallets } = await load("wallets");
  await save({ wallets: wallets.map((w) => (w.id === id ? { ...w, name: name.trim().slice(0, 24) || w.name } : w)) });
}

/**
 * Removes a wallet account from the list. An imported one is also deleted from the keyring (password
 * needed). Account #0 of a phrase stays (remove the phrase instead); other derived accounts and the
 * v0.2 fee account are only hidden: the phrase still derives them.
 */
export async function removeWallet(id: string, password?: string): Promise<void> {
  const { wallets, activeWallet } = await load("wallets", "activeWallet");
  const w = wallets.find((x) => x.id === id);
  if (!w) return;
  if (w.kind === "derived" && (w.index ?? 0) === 0) throw new Error("Account #0 of a phrase cannot be removed on its own. Remove the phrase in Settings instead.");
  const patch: Partial<StoreShape> = {};
  if (w.kind === "imported-phrase" || w.kind === "imported-key") {
    if (!password) throw new Error("Enter your password");
    const plain = await openKeyring(password);
    plain.imports = (plain.imports ?? []).filter((x) => x.id !== id);
    patch.keyring = await encryptKeyring(plain, password);
  }
  const rest = wallets.filter((x) => x.id !== id);
  patch.wallets = rest;
  if (activeWallet === id) patch.activeWallet = (rest.find((x) => x.kind === "derived") ?? rest[0])?.id ?? "";
  await save(patch);
  const u = await readUnlocked();
  if (u?.wallets?.[id]) {
    const { [id]: _drop, ...keep } = u.wallets;
    await writeUnlocked(u.masters, keep);
  }
}

/** Phantom-format private key (base58, 64 bytes) of a wallet account. Needs the password every time. */
export async function exportWalletKey(password: string, id: string): Promise<string> {
  const plain = await openKeyring(password);
  const { wallets } = await load("wallets");
  const w = wallets.find((x) => x.id === id);
  if (!w || w.kind === "watch") throw new Error("This account has no private key here.");
  const seed = seedOf(w, plain);
  if (!seed) throw new Error("Its secret is not in this keyring.");
  try {
    if (addressOfSeed(seed) !== w.address) throw new Error("Derivation mismatch: refusing to export.");
    return exportSecretKey(seed);
  } finally {
    seed.fill(0);
  }
}

/** The keypair of a wallet account while unlocked (null when locked or watch-only). Caller should not keep it. */
export async function walletKeypair(id: string, autoLockMin: number): Promise<Keypair | null> {
  const seed = await walletSeedFor(id, autoLockMin);
  if (!seed) return null;
  try {
    return keypairFromSeed(seed);
  } finally {
    seed.fill(0);
  }
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
  const { accounts, watched, activeAccount, wallets, activeWallet } = await load("accounts", "watched", "activeAccount", "wallets", "activeWallet");
  const rest = accounts.filter((a) => a.id !== accountId);
  const restWallets = wallets.filter((w) => w.phraseId !== accountId);
  await save({
    keyring: await encryptKeyring(plain, password),
    accounts: rest,
    watched: watched.filter((w) => w.accountId !== accountId),
    activeAccount: activeAccount === accountId ? rest[0].id : activeAccount,
    wallets: restWallets,
    activeWallet: restWallets.some((w) => w.id === activeWallet) ? activeWallet : (restWallets[0]?.id ?? ""),
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
  const { watched, wallets } = await load("watched", "wallets");
  const keep = wallets.filter((w) => w.kind === "watch");
  await save({
    keyring: null,
    accounts: [],
    activeAccount: "",
    wallets: keep,
    activeWallet: keep[0]?.id ?? "",
    unlockFails: { count: 0, until: 0 },
    watched: watched.filter((w) => !w.accountId).map((w) => ({ ...w, role: "watch" as const })),
  });
}
