import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { classifyControl, compact, headlines, onCurve, pct, redactRpc, splitByControl, STAKE_PROGRAM, SYSTEM_PROGRAM, VOTE_PROGRAM, type ExposureReport } from "./report";

const wallet = Keypair.generate().publicKey.toBase58();
const pda = PublicKey.findProgramAddressSync([Buffer.from("vault")], new PublicKey(STAKE_PROGRAM))[0].toBase58();
const SQUADS = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";

describe("classifyControl", () => {
  it("knows keys from program addresses", () => {
    expect(onCurve(wallet)).toBe(true);
    expect(onCurve(pda)).toBe(false);
    expect(onCurve("not an address")).toBe(false);
  });

  it("a system-owned wallet, or a token owner with no account, is one key", () => {
    expect(classifyControl({ address: wallet, programOwner: SYSTEM_PROGRAM })).toEqual({ control: "key", label: "wallet (ed25519)", key: wallet });
    expect(classifyControl({ address: wallet, programOwner: null }).control).toBe("key");
  });

  it("PDAs and program accounts are program-controlled, never counted as a key", () => {
    expect(classifyControl({ address: pda, programOwner: SYSTEM_PROGRAM })).toMatchObject({ control: "program", label: "PDA (System Program)", key: null });
    expect(classifyControl({ address: pda, programOwner: SQUADS }).label).toBe("PDA (Squads v4 (multisig))");
    expect(classifyControl({ address: wallet, programOwner: SQUADS }).control).toBe("program");
  });

  it("stake and vote accounts follow their withdraw authority", () => {
    expect(classifyControl({ address: pda, programOwner: STAKE_PROGRAM, withdrawer: wallet })).toEqual({ control: "key", label: "stake: wallet withdrawer", key: wallet });
    expect(classifyControl({ address: wallet, programOwner: STAKE_PROGRAM, withdrawer: pda }).control).toBe("program");
    expect(classifyControl({ address: wallet, programOwner: VOTE_PROGRAM, withdrawer: wallet }).label).toBe("vote: wallet withdrawer");
    expect(classifyControl({ address: wallet, programOwner: STAKE_PROGRAM, withdrawer: null }).control).toBe("unknown");
  });
});

describe("summaries", () => {
  it("splits value by control and formats shares", () => {
    const s = splitByControl(
      [
        { c: "key" as const, v: 3 },
        { c: "program" as const, v: 1 },
        { c: "key" as const, v: 4 },
      ],
      (r) => r.c,
      (r) => r.v
    );
    expect(s).toEqual({ total: 8, key: 7, program: 1, unknown: 0 });
    expect(pct(7, 8)).toBe("87.5");
    expect(pct(1, 0)).toBe("0.0");
    expect(compact(65_624_147)).toBe("65.6M");
    expect(compact(2_983_720_667)).toBe("2.98B");
    expect(compact(950)).toBe("950");
  });

  it("builds headlines from a snapshot", () => {
    const r: ExposureReport = {
      version: 1,
      generatedAt: "2026-11-04T00:00:00.000Z",
      slot: 1,
      sources: {},
      method: [],
      supply: { totalLamports: 1000e9, circulatingLamports: 800e9, nonCirculatingLamports: 200e9 },
      largestSol: { holders: [], totalLamports: 100e9, keyLamports: 80e9, programLamports: 20e9, unknownLamports: 0 },
      tokens: [
        { symbol: "USDC", mint: "m", decimals: 6, supply: 10, holders: [], topTotal: 10, topKey: 9, topProgram: 1, topUnknown: 0 },
        { symbol: "USDT", mint: "n", decimals: 6, supply: 10, holders: [], topTotal: 10, topKey: 5, topProgram: 5, topUnknown: 0 },
        { symbol: "BONK", mint: "o", decimals: 5, supply: 10, holders: [], topTotal: 10, topKey: 0, topProgram: 10, topUnknown: 0 },
      ],
      votes: { accounts: 4, keyWithdrawer: 3, programWithdrawer: 1, unknown: 0, lamports: 0, lamportsKey: 0, activatedStake: 0 },
      failures: [],
    };
    expect(headlines(r)).toMatchObject({ solKey: 80, solKeyPct: "80.0", solKeyOfCirculatingPct: "10.0", stableKey: 14, stableKeyPct: "70.0", votesKeyPct: "75.0" });
    expect(headlines({ ...r, largestSol: null })).toBeNull();
  });

  it("never publishes an RPC key", () => {
    expect(redactRpc("https://api.mainnet-beta.solana.com")).toBe("https://api.mainnet-beta.solana.com");
    expect(redactRpc("https://mainnet.helius-rpc.com/?api-key=abc")).toBe("https://mainnet.helius-rpc.com/<redacted>");
    expect(redactRpc("https://x.quiknode.pro/0123456789abcdef0123456789abcdef/")).toBe("https://x.quiknode.pro/<redacted>");
  });
});
