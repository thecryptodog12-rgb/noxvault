// Crypto storage: the encrypted keyring, the wallet operations on chrome.storage, the lock.
import { beforeEach, describe, expect, it } from "vitest";
import { newMasterSecret, secretToWords, wordsToSecret } from "../../sdk/client";
import { hex } from "../../web/lib/format";
import { KDF_ITERATIONS, WrongPasswordError, decryptKeyring, encryptKeyring, fromB64, passwordProblem, toB64 } from "../src/core/keyring";
import { lockDue, masterFor, readUnlocked, SESSION_KEY } from "../src/core/session";
import { addAccount, createWallet, failDelaySecs, fingerprint, removeAccount, resetWallet, revealPhrase, unlockWallet } from "../src/core/wallet";
import { feeKeypair } from "../src/core/feeAccount";
import { installChrome } from "./chromeFake";

const PW = "correct horse battery staple";

describe("keyring encryption (PBKDF2-SHA256 600k → AES-256-GCM)", () => {
  it("round-trips, with fresh salt and IV each time", async () => {
    const words = secretToWords(newMasterSecret());
    const plain = { accounts: [{ id: "a1", words }] };
    const a = await encryptKeyring(plain, PW);
    const b = await encryptKeyring(plain, PW);
    expect(a.kdf).toEqual({ name: "PBKDF2", hash: "SHA-256", iterations: 600_000 });
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(fromB64(a.salt)).toHaveLength(16);
    expect(fromB64(a.iv)).toHaveLength(12);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await decryptKeyring(a, PW)).toEqual(plain);
  });

  it("rejects a wrong password and a modified blob with WrongPasswordError", async () => {
    const enc = await encryptKeyring({ accounts: [{ id: "x", words: "w" }] }, PW);
    await expect(decryptKeyring(enc, PW + "!")).rejects.toBeInstanceOf(WrongPasswordError);
    const ct = fromB64(enc.ct);
    ct[3] ^= 1;
    await expect(decryptKeyring({ ...enc, ct: toB64(ct) }, PW)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("refuses a blob whose KDF was weakened", async () => {
    const enc = await encryptKeyring({ accounts: [] }, PW);
    await expect(decryptKeyring({ ...enc, kdf: { ...enc.kdf, iterations: 1000 } }, PW)).rejects.toThrow(/too weak/);
  });

  it("password rules", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/repeat/);
    expect(passwordProblem("password123")).toMatch(/common/);
    expect(passwordProblem("a-good-pass", "a-good-pas")).toMatch(/differ/);
    expect(passwordProblem("a-good-pass", "a-good-pass")).toBeNull();
  });
});

describe("wallet on chrome.storage: nothing secret in plaintext", () => {
  let fake: ReturnType<typeof installChrome>;
  beforeEach(() => {
    fake = installChrome();
  });

  it("create → only ciphertext on disk; the master only in session storage", async () => {
    const master = newMasterSecret();
    const words = secretToWords(master);
    const meta = await createWallet(words, PW);
    const disk = fake.disk();
    for (const w of words.split(" ")) if (w.length > 3) expect(disk).not.toMatch(new RegExp(`\\b${w}\\b`));
    expect(disk).not.toContain(hex(master));
    expect(disk).not.toContain(PW);
    expect(disk).not.toContain(toB64(master));
    expect(disk).toContain('"keyring"');
    expect(meta.fingerprint).toBe(fingerprint(master));
    expect(meta.feeAddress).toBe(feeKeypair(master).publicKey.toBase58());
    // unlocked: the master is in the session area only
    const u = await readUnlocked();
    expect(u?.masters[meta.id]).toBe(hex(master));
    expect(fake.mem()).not.toContain(PW);
    expect(fake.mem()).not.toContain(words.split(" ")[0] + " " + words.split(" ")[1]);
  });

  it("unlock: wrong password counts and pauses, right one unlocks", async () => {
    const words = secretToWords(newMasterSecret());
    const meta = await createWallet(words, PW);
    await chrome.storage.session.remove(SESSION_KEY);
    for (let i = 0; i < 5; i++) await expect(unlockWallet("nope-nope-nope")).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await readUnlocked()).toBeNull();
    const { unlockFails } = (await chrome.storage.local.get("unlockFails")) as { unlockFails: { count: number; until: number } };
    expect(unlockFails.count).toBe(5);
    await expect(unlockWallet(PW)).rejects.toThrow(/Too many wrong passwords/);
    await chrome.storage.local.set({ unlockFails: { count: 5, until: 0 } });
    await unlockWallet(PW);
    expect((await readUnlocked())?.masters[meta.id]).toBe(hex(wordsToSecret(words)));
    expect(failDelaySecs(4)).toBe(0);
    expect(failDelaySecs(5)).toBe(30);
    expect(failDelaySecs(20)).toBe(900);
  });

  it("reveal needs the password; add / remove accounts re-encrypt", async () => {
    const w1 = secretToWords(newMasterSecret());
    const w2 = secretToWords(newMasterSecret());
    const a1 = await createWallet(w1, PW);
    await expect(revealPhrase("wrong-password", a1.id)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await revealPhrase(PW, a1.id)).toBe(w1);
    const a2 = await addAccount(w2, PW, "Second");
    await expect(addAccount(w2, PW, "Dup")).rejects.toThrow(/already/);
    expect(await revealPhrase(PW, a2.id)).toBe(w2);
    expect(Object.keys((await readUnlocked())!.masters).sort()).toEqual([a1.id, a2.id].sort());
    expect(fake.disk()).not.toContain(w2.split(" ").slice(0, 3).join(" "));
    await removeAccount(PW, a1.id);
    await expect(revealPhrase(PW, a1.id)).rejects.toThrow(/No such account/);
    await expect(removeAccount(PW, a2.id)).rejects.toThrow(/only account/);
  });

  it("auto-lock: masterFor returns null and locks once idle too long", async () => {
    const meta = await createWallet(secretToWords(newMasterSecret()), PW);
    expect(await masterFor(meta.id, 15)).toHaveLength(32);
    const u = (await readUnlocked())!;
    await chrome.storage.session.set({ [SESSION_KEY]: { ...u, lastActive: Date.now() - 16 * 60_000 } });
    expect(await masterFor(meta.id, 15)).toBeNull();
    expect(await readUnlocked()).toBeNull();
    expect(lockDue({ lastActive: 0 }, 5, 5 * 60_000 - 1)).toBe(false);
    expect(lockDue({ lastActive: 0 }, 5, 5 * 60_000)).toBe(true);
  });

  it("reset forgets phrases and owned vaults, keeps watched addresses and one-time-key markers", async () => {
    const meta = await createWallet(secretToWords(newMasterSecret()), PW);
    await chrome.storage.local.set({
      watched: [
        { address: "A", cluster: "devnet", label: "", addedAt: 1, role: "owner", accountId: meta.id },
        { address: "B", cluster: "devnet", label: "", addedAt: 1 },
      ],
      attempted: { "A.0.3": 1 },
    });
    await resetWallet();
    const got = (await chrome.storage.local.get(["keyring", "watched", "attempted"])) as Record<string, unknown>;
    expect(got.keyring).toBeNull();
    expect((got.watched as { address: string }[]).map((w) => w.address)).toEqual(["B"]);
    expect(got.attempted).toEqual({ "A.0.3": 1 });
    expect(await readUnlocked()).toBeNull();
  });
});

describe("fee account", () => {
  it("is deterministic per phrase and domain-separated", () => {
    const m = new Uint8Array(32).fill(7);
    expect(feeKeypair(m).publicKey.toBase58()).toBe(feeKeypair(new Uint8Array(32).fill(7)).publicKey.toBase58());
    expect(feeKeypair(m).publicKey.toBase58()).not.toBe(feeKeypair(new Uint8Array(32).fill(8)).publicKey.toBase58());
    // pinned vector: changing the derivation would silently move users' fee SOL
    expect(feeKeypair(m).publicKey.toBase58()).toMatchInlineSnapshot(`"DWVarRo9CavaVb42XaxYmaxRhvzzZymd2ZxbzVnw4zsy"`);
  });
});
