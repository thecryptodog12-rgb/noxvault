// Vault config (v4) as JSON for /api/init: roots hex, keys base58, numbers as decimal strings.
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
  /** v4: always present; a decoy root when the owner set no duress phrase. */
  duress: { root: string; height: number };
  duressLimit: string;
  duressLock: string;
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
    duress: { root: hex(c.duress.root), height: c.duress.height },
    duressLimit: c.duressLimit.toString(),
    duressLock: c.duressLock.toString(),
  };
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

/** The reverse of configToJson, for configs this browser saved itself. */
export function configFromJson(j: ConfigJson): Config {
  return {
    trees: j.trees.map((t) => ({ root: fromHex(t.root), height: t.height })),
    threshold: j.threshold,
    recoveryDelay: BigInt(j.recoveryDelay),
    whitelist: j.whitelist.map((w) => new PublicKey(w).toBytes()),
    slowDelay: BigInt(j.slowDelay),
    instantLimit: BigInt(j.instantLimit),
    heirs: j.heirs.map((h) => ({ addr: new PublicKey(h.addr).toBytes(), bps: h.bps })),
    testamentDelay: BigInt(j.testamentDelay),
    duress: { root: fromHex(j.duress.root), height: j.duress.height },
    duressLimit: BigInt(j.duressLimit),
    duressLock: BigInt(j.duressLock),
  };
}

/** Configs saved by /create on this device whose owner tree has this root (hex). */
export function savedConfigsFor(rootHex: string): { vault: PublicKey; config: Config }[] {
  const out: { vault: PublicKey; config: Config }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("nox3.config.")) continue;
      const j = JSON.parse(localStorage.getItem(k) ?? "null") as ConfigJson | null;
      if (!j?.duress) continue; // saved by the v3 app; not a v4 vault
      if (j?.trees?.[0]?.root === rootHex) out.push({ vault: new PublicKey(k.slice("nox3.config.".length)), config: configFromJson(j) });
    }
  } catch {}
  return out;
}
