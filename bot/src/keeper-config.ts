// Environment for the long-running keeper (src/keeper.ts). Pure: no Solana imports, so it is
// unit-tested and compiled with the rest of the bot.
export interface KeeperConfig {
  secretKey: Uint8Array;
  rpcUrl: string;
  programId: string | null;
  intervalSeconds: number;
  maxTx: number;
  once: boolean;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodeBase58(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error("not base58");
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A 64-byte secret key from a JSON array (solana-keygen file contents) or a base58 string (Phantom export). */
export function parseSecretKey(raw: string): Uint8Array {
  const s = raw.trim();
  let bytes: Uint8Array;
  if (s.startsWith("[")) {
    const arr = JSON.parse(s) as unknown;
    if (!Array.isArray(arr) || !arr.every((x) => Number.isInteger(x) && x >= 0 && x < 256)) throw new Error("KEEPER_SECRET_KEY: bad JSON array");
    bytes = Uint8Array.from(arr as number[]);
  } else {
    bytes = decodeBase58(s);
  }
  if (bytes.length !== 64) throw new Error(`KEEPER_SECRET_KEY must be 64 bytes, got ${bytes.length}`);
  return bytes;
}

function num(env: Record<string, string | undefined>, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Error(`${name} must be a number >= ${min}`);
  return n;
}

export function loadKeeperConfig(env: Record<string, string | undefined> = process.env, argv: string[] = process.argv): KeeperConfig {
  const raw = env.KEEPER_SECRET_KEY;
  if (!raw) throw new Error("KEEPER_SECRET_KEY is required (JSON array of 64 numbers or base58)");
  const network = env.NETWORK ?? "devnet";
  return {
    secretKey: parseSecretKey(raw),
    rpcUrl: env.RPC_URL || (network === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com"),
    programId: env.NOXVAULT_PROGRAM_ID || null,
    intervalSeconds: num(env, "KEEPER_INTERVAL_SECONDS", 60, 5),
    maxTx: num(env, "KEEPER_MAX_TX", 40, 1),
    once: argv.includes("--once"),
  };
}
