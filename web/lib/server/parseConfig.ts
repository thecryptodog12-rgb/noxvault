import "server-only";
import { PublicKey } from "@solana/web3.js";
import { PRIMARY_HEIGHT, RECOVERY_HEIGHT, type Config } from "@nox/sdk/wots";
import type { ConfigJson } from "@/lib/configJson";
import { HttpError } from "./relayer";

const bad = (m: string) => new HttpError(400, m);

function bytes32(h: unknown, what: string): Uint8Array {
  if (typeof h !== "string" || !/^[0-9a-fA-F]{64}$/.test(h)) throw bad(`${what} must be 64 hex characters`);
  return Uint8Array.from(Buffer.from(h, "hex"));
}

function uint(v: unknown, what: string, maxDigits = 12): bigint {
  if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(String(v))) throw bad(`${what} must be a whole number`);
  return BigInt(String(v));
}

function key(v: unknown, what: string): Uint8Array {
  try {
    return new PublicKey(String(v)).toBytes();
  } catch {
    throw bad(`${what} is not a valid address`);
  }
}

/** Validates a v3 config sent by a browser (docs/SPEC.md §3). The program re-checks everything. */
export function parseConfig(j: ConfigJson): Config {
  if (!j || typeof j !== "object") throw bad("Body must be a config object");
  if (!Array.isArray(j.trees) || j.trees.length !== 4) throw bad("trees must have exactly 4 slots");
  const trees = j.trees.map((t, i) => {
    const root = bytes32(t?.root, `trees[${i}].root`);
    const empty = root.every((b) => b === 0);
    const want = empty ? 0 : i === 3 ? RECOVERY_HEIGHT : PRIMARY_HEIGHT;
    if (t.height !== want) throw bad(`trees[${i}].height must be ${want}`);
    return { root, height: want };
  });
  if (trees[0].height === 0) throw bad("slot 0 (the owner) must be set");
  const signers = trees.slice(0, 3).filter((t) => t.height).length;
  const threshold = Number(j.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > signers) throw bad(`threshold must be 1..${signers}`);
  if (!Array.isArray(j.whitelist) || j.whitelist.length > 4) throw bad("whitelist holds at most 4 addresses");
  if (!Array.isArray(j.heirs) || j.heirs.length > 4) throw bad("at most 4 heirs");
  const heirs = j.heirs.map((h, i) => {
    const bps = Number(h?.bps);
    if (!Number.isInteger(bps) || bps <= 0 || bps > 10000) throw bad(`heirs[${i}].bps must be 1..10000`);
    return { addr: key(h.addr, `heirs[${i}].addr`), bps };
  });
  if (heirs.length && heirs.reduce((s, h) => s + h.bps, 0) !== 10000) throw bad("heir shares must add up to 100%");
  return {
    trees,
    threshold,
    recoveryDelay: uint(j.recoveryDelay, "recoveryDelay"),
    whitelist: j.whitelist.map((w, i) => key(w, `whitelist[${i}]`)),
    slowDelay: uint(j.slowDelay, "slowDelay"),
    instantLimit: uint(j.instantLimit, "instantLimit", 19),
    heirs,
    testamentDelay: uint(j.testamentDelay, "testamentDelay"),
  };
}
