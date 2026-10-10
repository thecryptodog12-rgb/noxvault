import "server-only";
import { PublicKey } from "@solana/web3.js";
import { PRIMARY_HEIGHT, RECOVERY_HEIGHT, type Config } from "@nox/sdk/wots";
import type { ConfigJson } from "@/lib/configJson";
import { HttpError } from "./relayer";

function bytes32(h: unknown, what: string): Uint8Array {
  if (typeof h !== "string" || !/^[0-9a-fA-F]{64}$/.test(h)) throw new HttpError(400, `${what} must be 64 hex characters`);
  return Uint8Array.from(Buffer.from(h, "hex"));
}

function secs(v: unknown, what: string): bigint {
  if (!/^\d{1,12}$/.test(String(v))) throw new HttpError(400, `${what} must be a whole number of seconds`);
  return BigInt(String(v));
}

export function parseConfig(j: ConfigJson): Config {
  if (!j || typeof j !== "object") throw new HttpError(400, "Body must be a config object");
  const primaryRoot = bytes32(j.primaryRoot, "primaryRoot");
  const recoveryRoot = bytes32(j.recoveryRoot, "recoveryRoot");
  if (j.primaryHeight !== PRIMARY_HEIGHT) throw new HttpError(400, `primaryHeight must be ${PRIMARY_HEIGHT}`);
  const none = recoveryRoot.every((b) => b === 0);
  if (none ? j.recoveryHeight !== 0 : j.recoveryHeight !== RECOVERY_HEIGHT)
    throw new HttpError(400, `recoveryHeight must be ${none ? 0 : RECOVERY_HEIGHT}`);
  if (!Array.isArray(j.whitelist) || j.whitelist.length > 4) throw new HttpError(400, "whitelist must hold at most 4 addresses");
  const whitelist = j.whitelist.map((a) => {
    try {
      return new PublicKey(a).toBytes();
    } catch {
      throw new HttpError(400, `Bad whitelist address ${String(a).slice(0, 60)}`);
    }
  });
  return {
    primaryRoot,
    primaryHeight: PRIMARY_HEIGHT,
    recoveryRoot,
    recoveryHeight: none ? 0 : RECOVERY_HEIGHT,
    recoveryDelay: secs(j.recoveryDelay, "recoveryDelay"),
    whitelist,
    slowDelay: secs(j.slowDelay, "slowDelay"),
  };
}

