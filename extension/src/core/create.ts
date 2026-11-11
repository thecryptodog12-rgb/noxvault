// PORT of the settings logic of web/app/create/SetupVault.tsx, without React: `applyPreset`, the DAO
// address check, and the `built` memo that turns the form into a Config + vault address. Same
// presets (web/lib/presets.ts, imported), same validation messages, same makeConfig call.
// Plus the vault-number scan from SetupVault's first effect (first number with no vault), extended to
// also skip numbers this extension already used for a not-yet-initialized vault, so one tree never
// signs for two vaults.
import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import { findVaultsFor, makeConfig, vaultOf, withRetry, type Config, type Noxvault, type Signer } from "../../../sdk/client";
import { ANTITHEFT_INSTANT_SOL, type Preset } from "../../../web/lib/presets";
import { short, toBaseUnits } from "../../../web/lib/format";

export type RecoveryMode = "none" | "code" | "generate";

/** The form state of SetupVault (same fields, same defaults). Roots are public tree roots. */
export interface CreateForm {
  preset: Preset;
  recMode: RecoveryMode;
  recCode: string;
  recRoot: Uint8Array | null;
  recHanded: boolean;
  recDays: string;
  whitelist: string[];
  strict: boolean;
  slowHours: string;
  coCodes: string[];
  threshold: number;
  instantSol: string;
  heirs: { addr: string; pct: string }[];
  testDays: string;
  duressRoot: Uint8Array | null;
  duressHanded: boolean;
  duressSol: string;
  duressDays: string;
  daoAddr: string;
}

export function defaultForm(): CreateForm {
  return {
    preset: "personal",
    recMode: "none",
    recCode: "",
    recRoot: null,
    recHanded: false,
    recDays: "180",
    whitelist: [""],
    strict: false,
    slowHours: "24",
    coCodes: [],
    threshold: 1,
    instantSol: "0",
    heirs: [],
    testDays: "365",
    duressRoot: null,
    duressHanded: false,
    duressSol: "0.5",
    duressDays: "3",
    daoAddr: "",
  };
}

/** SetupVault `daoCheck`: the DAO preset's one destination, any valid public key. */
export function daoCheck(raw: string): { ok: true; pda: boolean } | { ok: false; error: string } | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const k = new PublicKey(v);
    return { ok: true, pda: !PublicKey.isOnCurve(k.toBytes()) };
  } catch {
    return { ok: false, error: "Not a valid Solana address." };
  }
}

/** SetupVault `applyPreset`. */
export function applyPreset(f: CreateForm, p: Preset): CreateForm {
  const n: CreateForm = { ...f, preset: p };
  const team = p === "team" || p === "vesting";
  const slow = p === "slow" || p === "vesting";
  const antitheft = p === "antitheft";
  n.coCodes = team ? ["", ""] : [];
  n.threshold = team ? 2 : 1;
  n.whitelist = [""];
  n.strict = false;
  n.slowHours = slow || antitheft ? "72" : "24";
  n.instantSol = slow ? "0.01" : antitheft ? ANTITHEFT_INSTANT_SOL : "0";
  if (team || slow) {
    if (n.recMode === "none") n.recMode = "generate";
    n.recDays = "30";
  }
  if (antitheft) {
    // the recovery phrase is what cancels a thief's withdrawal: it must exist
    if (n.recMode === "none") n.recMode = "generate";
    n.recDays = "90";
  }
  if (p === "dao") {
    // the DAO address is the only destination; everything else is refused (strict, no instant limit)
    n.whitelist = [f.daoAddr.trim()];
    n.strict = true;
    if (n.recMode === "none") n.recMode = "generate";
    n.recDays = "90";
  }
  return n;
}

/** SetupVault `changeDao`. */
export function changeDao(f: CreateForm, v: string): CreateForm {
  return { ...f, daoAddr: v, whitelist: [v.trim()], strict: true };
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

export type Built = { error: string } | { config: Config; vault: PublicKey };

/** SetupVault's `built` memo: the form → Config + vault address, or the first problem. */
export function buildConfig(signer: Signer | null, f: CreateForm, programId: PublicKey): Built {
  if (!signer) return { error: "Building your key tree…" };
  let recoveryRoot: Uint8Array | undefined;
  if (f.recMode === "code") {
    const c = f.recCode.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(c)) return { error: "A recovery code is 64 hex characters." };
    recoveryRoot = Uint8Array.from(c.match(/../g)!.map((h) => parseInt(h, 16)));
    if (recoveryRoot.every((b) => b === 0)) return { error: "That recovery code is empty." };
    if (recoveryRoot.every((b, i) => b === signer.pub.root[i])) return { error: "The recovery code cannot be your own primary root." };
  } else if (f.recMode === "generate") {
    if (!f.recRoot) return { error: "Generate the recovery phrase first." };
    if (!f.recHanded) return { error: "Confirm the recovery phrase was written down / handed over." };
    recoveryRoot = f.recRoot;
  }
  const days = Number(f.recDays);
  if (recoveryRoot && (!Number.isFinite(days) || days < 1 || days > 3650)) return { error: "Recovery delay must be 1–3650 days." };
  const daoIn = f.preset === "dao" ? daoCheck(f.daoAddr) : null;
  if (f.preset === "dao" && !daoIn) return { error: "Paste the DAO's Squads vault or Realms treasury address." };
  if (daoIn && !daoIn.ok) return { error: "The DAO address is not a valid Solana address." };
  const wl: PublicKey[] = [];
  for (const w of f.whitelist.map((x) => x.trim()).filter(Boolean)) {
    try {
      wl.push(new PublicKey(w));
    } catch {
      return { error: `Not a valid address: ${short(w, 6)}` };
    }
  }
  if (new Set(wl.map((k) => k.toBase58())).size !== wl.length) return { error: "The whitelist has a duplicate." };
  const hours = Number(f.slowHours);
  if (wl.length && !f.strict && (!Number.isFinite(hours) || hours < 1 || hours > 24 * 365)) return { error: "Delay must be 1 hour to 365 days." };
  const coSigners: Uint8Array[] = [];
  for (const [i, raw] of f.coCodes.entries()) {
    const c = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(c)) return { error: `Co-signer code ${i + 1} must be 64 hex characters.` };
    const root = fromHex(c);
    if (root.every((b) => b === 0)) return { error: `Co-signer code ${i + 1} is empty.` };
    const same = (a: Uint8Array, b: Uint8Array) => a.every((x, k) => x === b[k]);
    if (same(root, signer.pub.root) || (recoveryRoot && same(root, recoveryRoot)) || coSigners.some((r) => same(r, root)))
      return { error: `Co-signer code ${i + 1} repeats another key in this vault.` };
    coSigners.push(root);
  }
  const signers = 1 + coSigners.length;
  if (f.threshold < 1 || f.threshold > signers) return { error: `Threshold must be 1–${signers}.` };
  let instant = 0n;
  try {
    instant = f.instantSol.trim() ? toBaseUnits(f.instantSol, 9) : 0n;
  } catch {
    return { error: "Daily instant limit must be a number of SOL." };
  }
  const heirList: { addr: PublicKey; bps: number }[] = [];
  for (const h of f.heirs) {
    if (!h.addr.trim() && !h.pct.trim()) continue;
    let addr: PublicKey;
    try {
      addr = new PublicKey(h.addr.trim());
    } catch {
      return { error: `Heir address is not valid: ${short(h.addr, 6)}` };
    }
    const pct = Number(h.pct);
    if (!(pct > 0) || Math.round(pct * 100) !== pct * 100) return { error: "Heir shares are percentages with at most 2 decimals." };
    heirList.push({ addr, bps: Math.round(pct * 100) });
  }
  if (heirList.length && heirList.reduce((t, h) => t + h.bps, 0) !== 10000) return { error: "Heir shares must add up to exactly 100%." };
  const tdays = Number(f.testDays);
  if (heirList.length && (!Number.isFinite(tdays) || tdays < 30 || tdays > 3650)) return { error: "Testament delay must be 30–3650 days." };
  let duressLimit: bigint | undefined;
  let duressLockSecs: number | undefined;
  if (f.duressRoot) {
    if (!f.duressHanded) return { error: "Confirm the duress phrase is written down." };
    try {
      duressLimit = toBaseUnits(f.duressSol.trim() || "0", 9);
    } catch {
      return { error: "The duress amount must be a number of SOL." };
    }
    if (duressLimit <= 0n) return { error: "The duress amount must be more than 0 SOL." };
    const dd = Number(f.duressDays);
    if (!Number.isFinite(dd) || dd < 1 || dd > 365) return { error: "The duress lockdown must be 1–365 days." };
    duressLockSecs = Math.round(dd * 86400);
  }
  const restricted = wl.length > 0 || instant > 0n;
  if (instant > 0n && !f.strict && !wl.length && (!Number.isFinite(hours) || hours < 1)) return { error: "Delay must be at least 1 hour." };
  const config = makeConfig(signer, {
    coSigners,
    threshold: f.threshold,
    recoveryRoot,
    recoveryDelaySecs: recoveryRoot ? Math.round(days * 86400) : undefined,
    whitelist: wl,
    slowDelaySecs: restricted ? (f.strict ? 0 : Math.round(hours * 3600)) : 0,
    instantLimitLamports: instant,
    heirs: heirList,
    testamentDelaySecs: heirList.length ? Math.round(tdays * 86400) : undefined,
    duressRoot: f.duressRoot ?? undefined,
    duressLimitLamports: duressLimit,
    duressLockSecs,
  });
  return { config, vault: vaultOf(config, programId) };
}

/**
 * SetupVault's first effect: the first vault number of this phrase whose signer tree has no
 * initialized vault. `taken(root)` (extension addition) skips trees already used by a vault this
 * extension created but that is not initialized yet.
 */
export async function freeVaultNumber(
  program: Program<Noxvault>,
  signerFor: (n: number) => Promise<Signer>,
  taken: (root: Uint8Array) => boolean
): Promise<{ n: number; signer: Signer }> {
  for (let n = 0; n < 32; n++) {
    const s = await signerFor(n);
    if (taken(s.pub.root)) continue;
    const existing = await withRetry(() => findVaultsFor(program, s));
    if (!existing.length) return { n, signer: s };
  }
  throw new Error("Too many vaults for one phrase");
}
