// Vault config (v3) as JSON for /api/init: roots hex, keys base58, numbers as decimal strings.
import { PublicKey } from "@solana/web3.js";
import type { Config } from "@nox/sdk/wots";
import { hex } from "./format";

export interface ConfigJson {
  trees: { root: string; height: number }[];
  threshold: number;
  recoveryDelay: string;
  whitelist: string[];
  slowDelay: string;
  instantLimit: string;
  heirs: { addr: string; bps: number }[];
  testamentDelay: string;
}

export function configToJson(c: Config): ConfigJson {
  return {
    trees: c.trees.map((t) => ({ root: hex(t.root), height: t.height })),
    threshold: c.threshold,
    recoveryDelay: c.recoveryDelay.toString(),
    whitelist: c.whitelist.map((k) => new PublicKey(k).toBase58()),
    slowDelay: c.slowDelay.toString(),
    instantLimit: c.instantLimit.toString(),
    heirs: c.heirs.map((h) => ({ addr: new PublicKey(h.addr).toBase58(), bps: h.bps })),
    testamentDelay: c.testamentDelay.toString(),
  };
}
