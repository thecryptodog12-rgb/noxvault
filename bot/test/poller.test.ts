import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Message, PublicKey } from "@solana/web3.js";
import { Poller } from "../src/poller.js";
import { StateStore } from "../src/state.js";
import { loadConfig } from "../src/config.js";

const VAULT = "4VmyMBXEB9pXwVTssUEjJgy8EqfaooNurAEVybWtwkSV";
const PAYER = "BFwro7RnsG9GR2jV3yGXGwtGkRq8MDxH9LSoTAjMQf2x";

function fakeTx(lamportsIn: number): any {
  const message = new Message({
    header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
    accountKeys: [new PublicKey(PAYER), new PublicKey(VAULT), new PublicKey("11111111111111111111111111111111")],
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [{ programIdIndex: 2, accounts: [0, 1], data: "" }],
  });
  return {
    slot: 1, blockTime: 1, transaction: { message, signatures: [] },
    meta: { err: null, fee: 5000, preBalances: [1e9, 0, 1], postBalances: [1e9 - lamportsIn, lamportsIn, 1], innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
  };
}

describe("Poller", () => {
  it("first poll only records the cursor, later polls notify oldest-first", async () => {
    const chain = ["s3", "s2", "s1"]; // newest first
    const rpc: any = {
      signatures: async (_a: string, o: { until?: string; limit: number }) => {
        const end = o.until ? chain.indexOf(o.until) : chain.length;
        return chain.slice(0, end).slice(0, o.limit).map((signature) => ({ signature }));
      },
      transaction: async (sig: string) => fakeTx(Number(sig.slice(1)) * 1_000_000),
    };
    const file = path.join(mkdtempSync(path.join(tmpdir(), "noxpoll-")), "state.json");
    const state = new StateStore(file);
    await state.watch(42, VAULT);
    const sent: string[] = [];
    const poller = new Poller({ ...loadConfig(false), network: "devnet" }, rpc, state, async (chat, html) => {
      sent.push(`${chat}:${html}`);
    });

    await poller.cycle();
    expect(sent).toEqual([]);
    expect(state.cursor(VAULT)).toBe("s3");

    chain.unshift("s5", "s4");
    await poller.cycle();
    expect(sent.length).toBe(2);
    expect(sent[0]).toMatch(/^42:.*\+0\.004 SOL/s);
    expect(sent[1]).toMatch(/\+0\.005 SOL/);
    expect(JSON.parse(readFileSync(file, "utf8")).cursors[VAULT]).toBe("s5");

    await poller.cycle();
    expect(sent.length).toBe(2);
  });
});
