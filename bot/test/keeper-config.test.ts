import { describe, expect, it } from "vitest";
import { decodeBase58, loadKeeperConfig, parseSecretKey } from "../src/keeper-config.js";

const KEY = Array.from({ length: 64 }, (_, i) => (i * 7) % 256);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encode(bytes: number[]): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

describe("keeper config", () => {
  it("reads a secret key as a JSON array or base58", () => {
    expect(Array.from(parseSecretKey(JSON.stringify(KEY)))).toEqual(KEY);
    expect(Array.from(parseSecretKey(encode(KEY)))).toEqual(KEY);
    expect(Array.from(decodeBase58("11"))).toEqual([0, 0]);
  });

  it("rejects keys of the wrong size or shape", () => {
    expect(() => parseSecretKey("[1,2,3]")).toThrow(/64 bytes/);
    expect(() => parseSecretKey("[1,2,300]")).toThrow(/bad JSON/);
    expect(() => parseSecretKey("0OIl")).toThrow(/base58/);
  });

  it("defaults to devnet, 60 s, and honours --once", () => {
    const c = loadKeeperConfig({ KEEPER_SECRET_KEY: JSON.stringify(KEY) }, ["node", "keeper", "--once"]);
    expect(c.rpcUrl).toBe("https://api.devnet.solana.com");
    expect(c.intervalSeconds).toBe(60);
    expect(c.once).toBe(true);
    expect(c.programId).toBe(null);
    expect(() => loadKeeperConfig({}, [])).toThrow(/KEEPER_SECRET_KEY/);
    expect(() => loadKeeperConfig({ KEEPER_SECRET_KEY: JSON.stringify(KEY), KEEPER_INTERVAL_SECONDS: "1" }, [])).toThrow(/>= 5/);
  });
});
