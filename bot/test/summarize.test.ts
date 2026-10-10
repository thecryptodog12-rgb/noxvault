import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Keypair, Message, PublicKey } from "@solana/web3.js";
import {
  formatMessage,
  formatUnits,
  summarize,
  toTxView,
  type TxView,
} from "../src/summarize.js";

const PROGRAM = "8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4";
const VAULT = "4VmyMBXEB9pXwVTssUEjJgy8EqfaooNurAEVybWtwkSV";
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEST = "BFwro7RnsG9GR2jV3yGXGwtGkRq8MDxH9LSoTAjMQf2x";

// Recorded from devnet (tx 3JE3aL…): Noxvault call that moved 0.04 SOL into the vault.
const recorded: TxView = JSON.parse(
  readFileSync(new URL("./fixtures/devnet-deposit.json", import.meta.url), "utf8"),
);

describe("summarize", () => {
  it("recorded devnet tx: incoming SOL + Noxvault action", () => {
    const s = summarize(recorded, VAULT, PROGRAM);
    expect(s.succeeded).toBe(true);
    expect(s.noxvault).toBe(true);
    expect(s.solDelta).toBe(40_000_000n);
    expect(s.tokens).toEqual([]);
    const msg = formatMessage(s, "devnet");
    expect(msg).toContain("Noxvault action");
    expect(msg).toContain("succeeded");
    expect(msg).toContain("+0.04 SOL");
    expect(msg).toContain(`https://solscan.io/tx/${recorded.signature}?cluster=devnet`);
  });

  it("mainnet link has no cluster param; other program is not a Noxvault action", () => {
    const s = summarize(recorded, VAULT, "11111111111111111111111111111112");
    const msg = formatMessage(s, "mainnet-beta");
    expect(msg).not.toContain("Noxvault action");
    expect(msg).toContain(`https://solscan.io/tx/${recorded.signature}"`);
  });

  it("outgoing SOL, token changes owned by vault only, failed tx", () => {
    const view: TxView = {
      signature: "sig1",
      slot: 1,
      blockTime: null,
      err: { InstructionError: [1, { Custom: 6000 }] },
      accountKeys: [DEST, VAULT, "Ata1111111111111111111111111111111111111111", PROGRAM],
      preBalances: [5_000_000, 1_500_000_000, 2_039_280, 1],
      postBalances: [4_995_000, 250_000_000, 2_039_280, 1],
      preTokenBalances: [
        { accountIndex: 2, mint: USDC, owner: VAULT, amount: "125000000", decimals: 6 },
        { accountIndex: 0, mint: USDC, owner: DEST, amount: "1", decimals: 6 },
      ],
      postTokenBalances: [
        { accountIndex: 2, mint: USDC, owner: VAULT, amount: "25500000", decimals: 6 },
        { accountIndex: 0, mint: USDC, owner: DEST, amount: "99500001", decimals: 6 },
      ],
      invokedPrograms: [PROGRAM],
    };
    const s = summarize(view, VAULT, PROGRAM);
    expect(s.succeeded).toBe(false);
    expect(s.solDelta).toBe(-1_250_000_000n);
    expect(s.tokens).toEqual([{ mint: USDC, delta: -99_500_000n, decimals: 6 }]);
    const msg = formatMessage(s, "devnet");
    expect(msg).toContain("Noxvault action</b> — ❌ failed");
    expect(msg).toContain("Outgoing: 1.25 SOL");
    expect(msg).not.toContain("incl. fee");
    expect(msg).toContain("4zMM…ncDU</code>: -99.5");
  });

  it("closed token account (no post entry) counts as going to zero", () => {
    const view: TxView = {
      ...recorded,
      preTokenBalances: [{ accountIndex: 3, mint: USDC, owner: VAULT, amount: "7", decimals: 0 }],
      postTokenBalances: [],
      invokedPrograms: [],
    };
    const s = summarize(view, VAULT, PROGRAM);
    expect(s.tokens).toEqual([{ mint: USDC, delta: -7n, decimals: 0 }]);
  });

  it("no balance change", () => {
    const s = summarize({ ...recorded, postBalances: recorded.preBalances }, VAULT, PROGRAM);
    expect(formatMessage(s, "devnet")).toContain("No balance change");
  });
});

describe("toTxView", () => {
  it("resolves account keys and inner-instruction programs from an RPC-shaped response", () => {
    const payer = Keypair.generate().publicKey;
    const vault = new PublicKey(VAULT);
    const program = new PublicKey(PROGRAM);
    const system = new PublicKey("11111111111111111111111111111111");
    const message = new Message({
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 },
      accountKeys: [payer, vault, program, system],
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [{ programIdIndex: 2, accounts: [0, 1], data: "" }],
    });
    const tx: any = {
      slot: 9,
      blockTime: 100,
      transaction: { message, signatures: ["x"] },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [10, 0, 1, 1],
        postBalances: [5, 3, 1, 1],
        innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 3, accounts: [0, 1], data: "" }] }],
        preTokenBalances: [],
        postTokenBalances: [
          { accountIndex: 1, mint: USDC, owner: VAULT, uiTokenAmount: { amount: "5", decimals: 2, uiAmount: 0.05, uiAmountString: "0.05" } },
        ],
        logMessages: [],
      },
    };
    const v = toTxView("sigX", tx);
    expect(v.accountKeys).toEqual([payer.toBase58(), VAULT, PROGRAM, system.toBase58()]);
    expect(v.invokedPrograms).toEqual([PROGRAM, system.toBase58()]);
    expect(v.postTokenBalances[0]).toEqual({ accountIndex: 1, mint: USDC, owner: VAULT, amount: "5", decimals: 2 });
  });
});

describe("formatUnits", () => {
  it("formats", () => {
    expect(formatUnits(40_000_000n, 9)).toBe("0.04");
    expect(formatUnits(-1_000_000_000n, 9)).toBe("-1");
    expect(formatUnits(123n, 0)).toBe("123");
    expect(formatUnits(1n, 6)).toBe("0.000001");
  });
});
