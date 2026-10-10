// Vault config as JSON (roots hex, whitelist base58, delays in seconds) for /api/init.
import { PublicKey } from "@solana/web3.js";
import type { Config } from "@nox/sdk/wots";
import { hex } from "./format";

export interface ConfigJson {
  primaryRoot: string;
  primaryHeight: number;
  recoveryRoot: string;
  recoveryHeight: number;
  recoveryDelay: number | string;
  whitelist: string[];
  slowDelay: number | string;
}

export function configToJson(c: Config): ConfigJson {
  return {
    primaryRoot: hex(c.primaryRoot),
    primaryHeight: c.primaryHeight,
    recoveryRoot: hex(c.recoveryRoot),
    recoveryHeight: c.recoveryHeight,
    recoveryDelay: c.recoveryDelay.toString(),
    whitelist: c.whitelist.map((k) => new PublicKey(k).toBase58()),
    slowDelay: c.slowDelay.toString(),
  };
}
