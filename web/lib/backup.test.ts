import { describe, expect, it } from "vitest";
import {
  SHARE_WORDS,
  decryptBackup,
  encryptBackup,
  parseBackupFile,
  parseShare,
  passwordStrength,
  restorePhrase,
  secretToPhrase,
  splitPhrase,
} from "./backup";

const phrase = secretToPhrase(Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff));
const other = secretToPhrase(Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 5) & 0xff));

describe("shamir shares", () => {
  it("splits and restores with any k of n", async () => {
    const shares = await splitPhrase(phrase, 5, 3);
    expect(shares).toHaveLength(5);
    for (const s of shares) {
      expect(s.words.split(" ")).toHaveLength(SHARE_WORDS);
      expect(parseShare(s.words).hex).toBe(s.hex);
      expect(parseShare(s.hex).words).toBe(s.words);
    }
    for (const pick of [[0, 1, 2], [2, 3, 4], [0, 2, 4], [4, 1, 3]]) {
      const r = await restorePhrase(pick.map((i) => (i % 2 ? shares[i].hex : shares[i].words)));
      expect(r.words).toBe(phrase);
    }
  });

  it("refuses too few shares, typos and mixed backups", async () => {
    const shares = await splitPhrase(phrase, 3, 2);
    await expect(restorePhrase([shares[0].words])).rejects.toThrow(/Need 2/);
    await expect(restorePhrase([shares[0].words, shares[0].hex])).rejects.toThrow(/Need 2/);
    const w = shares[1].words.split(" ");
    w[3] = w[3] === "abandon" ? "ability" : "abandon";
    expect(() => parseShare(w.join(" "))).toThrow(/typo/);
    const others = await splitPhrase(other, 3, 2);
    await expect(restorePhrase([shares[0].words, others[1].words])).rejects.toThrow(/different backups/);
  });

  it("rejects invalid parameters and phrases", async () => {
    await expect(splitPhrase(phrase, 2, 3)).rejects.toThrow();
    await expect(splitPhrase(phrase, 3, 1)).rejects.toThrow();
    await expect(splitPhrase("not a phrase", 3, 2)).rejects.toThrow(/valid/);
  });
});

describe("encrypted backup file", () => {
  it("round trips with the right password", async () => {
    const f = await encryptBackup(phrase, "correct horse battery staple", "main vault");
    expect(f.kdf).toEqual({ name: "scrypt", N: 1 << 17, r: 8, p: 1 });
    const back = parseBackupFile(JSON.stringify(f));
    const plain = await decryptBackup(back, "correct horse battery staple");
    expect(plain.words).toBe(phrase);
    expect(plain.label).toBe("main vault");
    expect(plain.fingerprint).toBe(f.fingerprint);
    expect(JSON.stringify(f)).not.toContain(phrase.split(" ")[0] + " ");
  }, 30_000);

  it("fails with a wrong password or a changed file", async () => {
    const f = await encryptBackup(phrase, "correct horse battery staple");
    await expect(decryptBackup(f, "correct horse battery stapler")).rejects.toThrow(/Wrong password/);
    const ct = atob(f.ct);
    const flipped = btoa(String.fromCharCode(ct.charCodeAt(0) ^ 1) + ct.slice(1));
    await expect(decryptBackup({ ...f, ct: flipped }, "correct horse battery staple")).rejects.toThrow(/Wrong password/);
  }, 30_000);

  it("rejects non-backup files", () => {
    expect(() => parseBackupFile("hello")).toThrow();
    expect(() => parseBackupFile("{}")).toThrow();
  });
});

describe("password strength", () => {
  it("ranks", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("password123").score).toBe(0);
    expect(passwordStrength("correct horse battery staple tiger").score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength("T7#kq!29zLm@Vx4w").score).toBeGreaterThanOrEqual(3);
  });
});
