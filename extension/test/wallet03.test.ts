// v0.3 wallet accounts: standard derivation (vectors), domain separation from the WOTS keys, imported
// keys stored encrypted, the v0.2 → v0.3 migration, amounts, transfers, recipient checks, activity parsing.
import { beforeEach, describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { mnemonicToSeedSync } from "@scure/bip39";
import { derivePath } from "ed25519-hd-key";
import { newMasterSecret, secretToWords } from "../../sdk/client";
import { treeSeeds, seedIndex } from "../../sdk/wots";
import { hex } from "../../web/lib/format";
import { addressOfSeed, cleanBip39, exportSecretKey, masterAccountSeed, parseImport, phraseAccountSeed, slip10Ed25519, solanaPath } from "../src/core/hd";
import { feeKeypair } from "../src/core/feeAccount";
import { addDerivedWallet, addWatchWallet, createWallet, exportWalletKey, importWallet, removeWallet, unlockWallet, walletKeypair } from "../src/core/wallet";
import { encryptKeyring } from "../src/core/keyring";
import { lock, readUnlocked } from "../src/core/session";
import { decodeMetaplex, fmtUnits, fmtUsd, isSpam, parseUnits, unitsToInput } from "../src/core/holdings";
import { RENT_EMPTY, checkRecipient, maxSol, packLegs, recipientAta, simError, transferIxs, type AssetRef } from "../src/core/transfer";
import { parseWalletTx } from "../src/core/activity";
import { base58Encode } from "../src/lib/net";
import { installChrome } from "./chromeFake";

const PW = "correct horse battery staple";
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

describe("SLIP-0010 ed25519 / BIP44 Solana derivation", () => {
  it("matches the SLIP-0010 ed25519 test vector 1", () => {
    const seed = fromHex("000102030405060708090a0b0c0d0e0f");
    expect(hex(slip10Ed25519(seed, "m"))).toBe("2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7");
    expect(hex(slip10Ed25519(seed, "m/0'"))).toBe("68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3");
    expect(hex(slip10Ed25519(seed, "m/0'/1'"))).toBe("b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2");
    expect(hex(slip10Ed25519(seed, "m/0'/1'/2'/2'/1000000000'"))).toBe("8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793");
  });

  it("refuses non-hardened paths (ed25519 has none)", () => {
    expect(() => slip10Ed25519(new Uint8Array(16), "m/44'/501'/0")).toThrow(/hardened/);
  });

  it("the 'abandon … about' phrase gives the published Phantom / Solflare address at m/44'/501'/0'/0'", () => {
    // Cross-checked against an independent implementation (ed25519-hd-key, used by many Solana wallets)
    // and against the address published for this test mnemonic.
    const seed = mnemonicToSeedSync(ABANDON);
    const ref = Keypair.fromSeed(derivePath(solanaPath(0), Buffer.from(seed).toString("hex")).key).publicKey.toBase58();
    const ours = addressOfSeed(phraseAccountSeed(ABANDON, 0));
    expect(ours).toBe(ref);
    expect(ours).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    for (const i of [1, 2, 7]) {
      const r = Keypair.fromSeed(derivePath(solanaPath(i), Buffer.from(seed).toString("hex")).key).publicKey.toBase58();
      expect(addressOfSeed(phraseAccountSeed(ABANDON, i))).toBe(r);
    }
  });

  it("a 24-word Noxvault phrase is valid BIP39 and derives the same keys as its words", () => {
    const m = newMasterSecret();
    const words = secretToWords(m);
    expect(cleanBip39(words)).toBe(words);
    const seed = mnemonicToSeedSync(words);
    const ref = Keypair.fromSeed(derivePath(solanaPath(0), Buffer.from(seed).toString("hex")).key).publicKey.toBase58();
    expect(addressOfSeed(masterAccountSeed(m, 0))).toBe(ref);
  });

  it("is domain-separated from the WOTS trees and the v0.2 fee account of the same phrase", () => {
    const m = new Uint8Array(32).fill(7);
    const wallet = [0, 1, 2].map((i) => hex(masterAccountSeed(m, i)));
    const fee = hex(feeKeypair(m).secretKey.slice(0, 32));
    const wots: string[] = [];
    for (let n = 0; n < 4; n++)
      for (const t of [0, 1, 2] as const) {
        const s = treeSeeds(m, seedIndex(n, t));
        wots.push(hex(s.skSeed), hex(s.pkSeed));
      }
    const all = [...wallet, fee, ...wots, hex(m)];
    expect(new Set(all).size).toBe(all.length);
    // and none of the wallet keys is the master or a prefix-shifted copy of it
    for (const w of wallet) expect(w.includes(hex(m).slice(0, 16))).toBe(false);
    // pinned: changing the derivation would move users' funds
    expect(addressOfSeed(masterAccountSeed(m, 0))).toMatchInlineSnapshot(`"8zzKEAB4VqnUchbsmAor9QzyVWVQFanQGJYQw8UQPh1j"`);
  });
});

describe("import parsing", () => {
  it("accepts 12/24-word phrases, base58 64-byte keys and JSON arrays", () => {
    expect(parseImport(`  1. ${ABANDON.split(" ").join("\n")} `)).toEqual({ kind: "phrase", words: ABANDON });
    const kp = Keypair.generate();
    const b58 = parseImport(base58Encode(kp.secretKey));
    expect(b58.kind).toBe("key");
    expect(b58.kind === "key" && b58.address).toBe(kp.publicKey.toBase58());
    const arr = parseImport(JSON.stringify([...kp.secretKey]));
    expect(arr.kind === "key" && arr.address).toBe(kp.publicKey.toBase58());
    expect(exportSecretKey(kp.secretKey.slice(0, 32))).toBe(base58Encode(kp.secretKey));
  });

  it("refuses addresses, damaged keys and bad phrases", () => {
    const kp = Keypair.generate();
    expect(() => parseImport(kp.publicKey.toBase58())).toThrow(/address/);
    const bad = new Uint8Array(kp.secretKey);
    bad[40] ^= 1;
    expect(() => parseImport(base58Encode(bad))).toThrow(/does not match/);
    expect(() => parseImport(ABANDON.replace("about", "abandon"))).toThrow(/valid BIP39/);
    expect(() => parseImport("abandon abandon abandon")).toThrow(/12, 15, 18, 21 or 24/);
  });
});

describe("wallet accounts on chrome.storage", () => {
  let fake: ReturnType<typeof installChrome>;
  beforeEach(() => {
    fake = installChrome();
  });

  it("a new phrase gets wallet #0 = m/44'/501'/0'/0', seed only in the session", async () => {
    const m = newMasterSecret();
    const words = secretToWords(m);
    await createWallet(words, PW);
    const { wallets, activeWallet } = (await chrome.storage.local.get(["wallets", "activeWallet"])) as { wallets: { id: string; kind: string; address: string; index: number }[]; activeWallet: string };
    expect(wallets).toHaveLength(1); // no v0.2 fee account for a v0.3 phrase
    expect(wallets[0].kind).toBe("derived");
    expect(wallets[0].address).toBe(addressOfSeed(masterAccountSeed(m, 0)));
    expect(activeWallet).toBe(wallets[0].id);
    const seedHex = hex(masterAccountSeed(m, 0));
    expect(fake.disk()).not.toContain(seedHex);
    expect(fake.mem()).toContain(seedHex);
    const kp = await walletKeypair(wallets[0].id, 15);
    expect(kp?.publicKey.toBase58()).toBe(wallets[0].address);
    const next = await addDerivedWallet((await chrome.storage.local.get("accounts") as { accounts: { id: string }[] }).accounts[0].id, 15);
    expect(next.index).toBe(1);
    expect(next.address).toBe(addressOfSeed(masterAccountSeed(m, 1)));
    await lock();
    expect(await walletKeypair(wallets[0].id, 15)).toBeNull();
  });

  it("v0.2 → v0.3: an existing phrase keeps its fee account as a wallet (no stranded SOL)", async () => {
    const m = newMasterSecret();
    const words = secretToWords(m);
    // what a v0.2 install has on disk: keyring + account meta without walletsInit, no wallets
    const keyring = await encryptKeyring({ accounts: [{ id: "a1", words }] }, PW);
    const fee = feeKeypair(m).publicKey.toBase58();
    await chrome.storage.local.set({ keyring, accounts: [{ id: "a1", name: "Account 1", fingerprint: "x", feeAddress: fee, createdAt: 1 }], activeAccount: "a1" });
    await unlockWallet(PW);
    const { wallets, accounts } = (await chrome.storage.local.get(["wallets", "accounts"])) as { wallets: { id: string; kind: string; address: string }[]; accounts: { walletsInit?: boolean }[] };
    expect(wallets.map((w) => w.kind).sort()).toEqual(["derived", "legacy-fee"]);
    const legacy = wallets.find((w) => w.kind === "legacy-fee")!;
    expect(legacy.address).toBe(fee);
    expect((await walletKeypair(legacy.id, 15))?.publicKey.toBase58()).toBe(fee);
    expect(accounts[0].walletsInit).toBe(true);
    // a second unlock does not duplicate anything
    await lock();
    await unlockWallet(PW);
    expect(((await chrome.storage.local.get("wallets")) as { wallets: unknown[] }).wallets).toHaveLength(2);
  });

  it("imported phrases and keys are stored only inside the encrypted keyring", async () => {
    await createWallet(secretToWords(newMasterSecret()), PW);
    const kp = Keypair.generate();
    const secretB58 = base58Encode(kp.secretKey);
    await expect(importWallet(secretB58, "wrong password!", "x")).rejects.toThrow();
    const a = await importWallet(secretB58, PW, "Hot");
    const b = await importWallet(ABANDON, PW, "Phantom", 0);
    expect(a.address).toBe(kp.publicKey.toBase58());
    expect(b.address).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    const disk = fake.disk();
    expect(disk).not.toContain(hex(kp.secretKey.slice(0, 32)));
    expect(disk).not.toContain(secretB58);
    expect(disk).not.toContain("abandon abandon");
    await expect(importWallet(ABANDON, PW, "again", 0)).rejects.toThrow(/already here/);
    // survives lock / unlock, and exports behind the password
    await lock();
    await unlockWallet(PW);
    expect((await walletKeypair(a.id, 15))?.publicKey.toBase58()).toBe(a.address);
    expect((await walletKeypair(b.id, 15))?.publicKey.toBase58()).toBe(b.address);
    expect(await exportWalletKey(PW, a.id)).toBe(secretB58);
    await expect(exportWalletKey("nope nope nope", a.id)).rejects.toThrow();
    // removing deletes it from the keyring
    await removeWallet(a.id, PW);
    await lock();
    await unlockWallet(PW);
    expect(await walletKeypair(a.id, 15)).toBeNull();
    const u = await readUnlocked();
    expect(Object.keys(u!.wallets!)).not.toContain(a.id);
  });

  it("watch-only wallets have no key", async () => {
    await createWallet(secretToWords(newMasterSecret()), PW);
    const w = await addWatchWallet(Keypair.generate().publicKey.toBase58(), "Big wallet");
    expect(await walletKeypair(w.id, 15)).toBeNull();
    await expect(exportWalletKey(PW, w.id)).rejects.toThrow(/no private key/);
  });
});

describe("amounts", () => {
  it("formats base units exactly", () => {
    expect(fmtUnits(1_500_000_000n, 9)).toBe("1.5");
    expect(fmtUnits("123456789012345", 6)).toBe("123,456,789.012345");
    expect(fmtUnits(1n, 9, 6)).toBe("<0.000001");
    expect(fmtUnits(0n, 9)).toBe("0");
    expect(fmtUnits(-2_000_000n, 6)).toBe("-2");
    expect(fmtUnits(5n, 0)).toBe("5");
    expect(unitsToInput(1_234_567_000_000n, 9)).toBe("1234.567");
  });
  it("parses without float rounding and refuses extra decimals", () => {
    expect(parseUnits("0.1", 9)).toBe(100_000_000n);
    expect(parseUnits("1,000.000001", 6)).toBe(1_000_000_001n);
    expect(parseUnits(".5", 2)).toBe(50n);
    expect(() => parseUnits("0.0000001", 6)).toThrow(/6 decimals/);
    expect(() => parseUnits("-1", 6)).toThrow();
    expect(() => parseUnits("1e3", 6)).toThrow();
  });
  it("usd and spam", () => {
    expect(fmtUsd(1234.5)).toBe("$1,234.50");
    expect(fmtUsd(0.001)).toBe("<$0.01");
    const base = { raw: "5", name: "Token", symbol: "TKN", mint: "X", program: "spl" as const };
    expect(isSpam({ ...base, price: 1 }, "mainnet-beta")).toBe(false);
    expect(isSpam(base, "mainnet-beta")).toBe(true); // unpriced unknown mint on mainnet
    expect(isSpam(base, "devnet")).toBe(false);
    expect(isSpam({ ...base, raw: "0" }, "devnet")).toBe(true);
    expect(isSpam({ ...base, name: "Claim at www.free.com", price: 1 }, "mainnet-beta")).toBe(true);
  });
  it("decodes Metaplex metadata", () => {
    const enc = (s: string, pad: number) => {
      const b = new TextEncoder().encode(s.padEnd(pad, "\0"));
      const out = new Uint8Array(4 + b.length);
      new DataView(out.buffer).setUint32(0, b.length, true);
      out.set(b, 4);
      return out;
    };
    const parts = [new Uint8Array([4]), new Uint8Array(64), enc("Noxvault Test", 32), enc("tNOX", 10), enc("https://x", 200)];
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) (data.set(p, o), (o += p.length));
    expect(decodeMetaplex(data)).toEqual({ name: "Noxvault Test", symbol: "tNOX" });
    expect(decodeMetaplex(new Uint8Array(10))).toBeNull();
  });
});

describe("transfers", () => {
  const from = Keypair.generate().publicKey;
  const to = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const SOL: AssetRef = { mint: "So11111111111111111111111111111111111111112", decimals: 9, program: "sol" };

  it("SOL is one system transfer", () => {
    const ixs = transferIxs(from, to, [{ asset: SOL, amount: 5n }]);
    expect(ixs).toHaveLength(1);
    expect(ixs[0].programId.equals(SystemProgram.programId)).toBe(true);
    expect(() => transferIxs(from, to, [{ asset: SOL, amount: 0n }])).toThrow();
  });

  it("a token creates the recipient's ATA when needed, then transferChecked", () => {
    const src = Keypair.generate().publicKey.toBase58();
    const asset: AssetRef = { mint: mint.toBase58(), decimals: 6, program: "spl", account: src };
    const ixs = transferIxs(from, to, [{ asset, amount: 1_000_000n, createAta: true }]);
    expect(ixs).toHaveLength(2);
    const ata = getAssociatedTokenAddressSync(mint, to, true, TOKEN_PROGRAM_ID);
    expect(ixs[0].keys[1].pubkey.equals(ata)).toBe(true); // create idempotent: payer, ata, owner, mint
    expect(ixs[0].data[0]).toBe(1); // CreateIdempotent
    expect(ixs[1].programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ixs[1].keys[2].pubkey.equals(ata)).toBe(true); // source, mint, dest, authority
    expect(ixs[1].keys[3].pubkey.equals(from)).toBe(true);
    expect(transferIxs(from, to, [{ asset, amount: 1n }])).toHaveLength(1);
  });

  it("Token-2022 and off-curve owners (vaults) are handled", () => {
    const vault = PublicKey.findProgramAddressSync([new Uint8Array([1])], SystemProgram.programId)[0];
    const asset: AssetRef = { mint: mint.toBase58(), decimals: 9, program: "2022", account: to.toBase58() };
    const ixs = transferIxs(from, vault, [{ asset, amount: 3n, createAta: true }]);
    expect(ixs[1].programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(recipientAta(asset, vault).equals(getAssociatedTokenAddressSync(mint, vault, true, TOKEN_2022_PROGRAM_ID))).toBe(true);
  });

  it("recipient checks", () => {
    const f = { to: to.toBase58(), from: from.toBase58(), onCurve: true, owner: "11111111111111111111111111111111", lamports: 1, ownVault: false, isVault: false };
    expect(checkRecipient({ ...f, to: from.toBase58() }, SOL, 1n).error).toMatch(/own address/);
    expect(checkRecipient({ ...f, owner: TOKEN_PROGRAM_ID.toBase58() }, SOL, 1n).error).toMatch(/token account/);
    expect(checkRecipient({ ...f, owner: null }, SOL, 1000n).error).toMatch(/rent minimum/);
    expect(checkRecipient({ ...f, owner: null }, SOL, BigInt(RENT_EMPTY)).error).toBeUndefined();
    expect(checkRecipient({ ...f, ownVault: true, isVault: true, onCurve: false }, SOL, 1n).info.join()).toMatch(/your Noxvault vaults/);
    expect(checkRecipient({ ...f, isVault: true, onCurve: false }, SOL, 1n).warnings.join()).toMatch(/someone else's/);
    expect(checkRecipient({ ...f, onCurve: false }, SOL, 1n).warnings.join()).toMatch(/no private key/);
    expect(checkRecipient(f, SOL, 1n)).toEqual({ warnings: [], info: [] });
  });

  it("max SOL, packing, simulation errors", () => {
    expect(maxSol(1_000_000, 5_000)).toBe(995_000n);
    expect(maxSol(1_000, 5_000)).toBe(0n);
    const tok = (n: number) => ({ asset: { mint: `m${n}`, decimals: 0, program: "spl" as const, account: "a" }, amount: 1n });
    const packed = packLegs([{ asset: SOL, amount: 1n }, tok(1), tok(2), tok(3), tok(4)], 3);
    expect(packed.map((p) => p.length)).toEqual([3, 2]);
    expect(packed[1][1].asset.program).toBe("sol");
    expect(simError({ InstructionError: [2, { Custom: 1 }] }, ["Program log: Error: insufficient funds"])).toMatch(/Not enough tokens/);
    expect(simError({ InstructionError: [2, { Custom: 1 }] }, ["Transfer: insufficient lamports 5, need 10"])).toMatch(/Not enough SOL/);
  });
});

describe("activity parsing", () => {
  const me = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const tx = (p: Partial<{ keys: string[]; pre: number[]; post: number[]; fee: number; err: unknown; preT: unknown[]; postT: unknown[]; ixs: unknown[] }>) =>
    ({
      blockTime: 100,
      transaction: { message: { accountKeys: (p.keys ?? [me, other]).map((k) => ({ pubkey: new PublicKey(k) })), instructions: p.ixs ?? [] } },
      meta: { err: p.err ?? null, fee: p.fee ?? 5000, preBalances: p.pre ?? [], postBalances: p.post ?? [], preTokenBalances: p.preT ?? [], postTokenBalances: p.postT ?? [] },
    }) as unknown as ParsedTransactionWithMeta;

  it("sent SOL (fee excluded) with counterparty", () => {
    const t = parseWalletTx("s", tx({ pre: [10_000_000, 0], post: [10_000_000 - 1_000_000 - 5000, 1_000_000], ixs: [{ parsed: { type: "transfer", info: { source: me, destination: other, lamports: 1_000_000 } } }] }), me);
    expect(t).toMatchObject({ kind: "sent", solDelta: -1_000_000, fee: 5000, counterparty: other, ok: true });
  });
  it("received SOL", () => {
    const t = parseWalletTx("s", tx({ keys: [other, me], pre: [9e6, 0], post: [8e6 - 5000, 1e6], ixs: [{ parsed: { type: "transfer", info: { source: other, destination: me, lamports: 1e6 } } }] }), me);
    expect(t).toMatchObject({ kind: "received", solDelta: 1_000_000, fee: 0, counterparty: other });
  });
  it("received a token", () => {
    const tb = (amount: string) => [{ accountIndex: 1, mint: "M", owner: me, uiTokenAmount: { amount, decimals: 6 } }];
    const t = parseWalletTx("s", tx({ keys: [other, me], pre: [1e6, 2e6], post: [1e6 - 5000, 2e6], preT: tb("0"), postT: tb("2500000") }), me);
    expect(t.kind).toBe("received");
    expect(t.tokens).toEqual([{ mint: "M", delta: "2500000", decimals: 6 }]);
  });
  it("failed transactions", () => {
    expect(parseWalletTx("s", tx({ err: { InstructionError: [0, "x"] }, pre: [1, 0], post: [1, 0] }), me)).toMatchObject({ kind: "failed", ok: false });
    expect(parseWalletTx("s", null, me).ok).toBe(false);
  });
});
