"use client";
// Step 2+ of /create: settings → config → vault address → initialize + fund (wallet), or
// fund from anywhere and let the relayer initialize it (no wallet).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import QRCode from "qrcode";
import {
  RECOVERY_TREE,
  fetchState,
  findVaultsFor,
  initVaultIx,
  makeConfig,
  newMasterSecret,
  secretToWords,
  vaultOf,
  withRetry,
  type Signer,
} from "@nox/sdk/client";
import { Copy, Label, Note, Panel } from "@/components/ui";
import TreeProgress from "@/components/vault/TreeProgress";
import TokenDeposit from "./TokenDeposit";
import { useNox } from "@/lib/hooks";
import { getSigner } from "@/lib/trees";
import { errMsg, hex, short, sol, toBaseUnits } from "@/lib/format";
import { explorerUrl, NETWORK } from "@/lib/config";
import { forgetWords, loadWords, saveWords, type Remember } from "@/lib/secret";
import { sendIxs } from "@/lib/unlock";
import { configToJson } from "@/lib/configJson";
import { duration } from "@/lib/time";

const signerCountOf = (c: { trees: { height: number }[] }) => [0, 1, 2].filter((t) => c.trees[t].height > 0).length;
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const RELAY_INIT_MIN = 0.02 * LAMPORTS_PER_SOL;
type RecoveryMode = "none" | "code" | "generate";

export default function SetupVault({ master, words, onForget }: { master: Uint8Array; words: string; onForget: () => void }) {
  const { connection, program, wallet, deployed } = useNox();
  const { setVisible } = useWalletModal();

  // ---- 1. which vault number, and the primary tree ----
  const [signer, setSigner] = useState<Signer | null>(null);
  const [vaultNumber, setVaultNumber] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanTry, setScanTry] = useState(0);

  useEffect(() => {
    let live = true;
    setScanErr(null);
    setSigner(null);
    setVaultNumber(null);
    (async () => {
      try {
        // The first vault number with no initialized vault (usually 0).
        for (let n = 0; n < 32; n++) {
          const s = await getSigner(master, n, 0, (done, total) => live && setProgress({ done, total }));
          // skip trees this browser already handed out as a co-signer code (/cosign)
          let given = false;
          try {
            given = localStorage.getItem(`nox3.code.given.cosigner.${hex(s.pub.root)}`) !== null;
          } catch {}
          if (given) continue;
          const existing = await withRetry(() => findVaultsFor(program, s));
          if (!live) return;
          if (!existing.length) {
            setSigner(s);
            setVaultNumber(n);
            return;
          }
        }
        throw new Error("Too many vaults for one phrase");
      } catch (e) {
        if (live) setScanErr(errMsg(e));
      } finally {
        if (live) setProgress(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [master, program, scanTry]);

  // ---- 2. settings ----
  const [recMode, setRecMode] = useState<RecoveryMode>("none");
  const [recCode, setRecCode] = useState("");
  const [recWords, setRecWords] = useState<string | null>(null);
  const [recHanded, setRecHanded] = useState(false);
  const [recRoot, setRecRoot] = useState<Uint8Array | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [recDays, setRecDays] = useState("180");
  const [whitelist, setWhitelist] = useState<string[]>([""]);
  const [strict, setStrict] = useState(false);
  const [slowHours, setSlowHours] = useState("24");
  const [coCodes, setCoCodes] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(1);
  const [instantSol, setInstantSol] = useState("0");
  const [heirs, setHeirs] = useState<{ addr: string; pct: string }[]>([]);
  const [testDays, setTestDays] = useState("365");
  const [remember, setRemember] = useState<Remember>(() => {
    const s = loadWords();
    return s && s.words === words ? s.where : "off";
  });

  useEffect(() => {
    if (remember === "off") forgetWords();
    else saveWords(words, remember);
  }, [remember, words]);

  const makeRecovery = async () => {
    if (vaultNumber === null) return;
    setRecBusy(true);
    try {
      const m = newMasterSecret();
      const s = await getSigner(m, vaultNumber, RECOVERY_TREE);
      setRecWords(secretToWords(m));
      setRecRoot(s.pub.root);
      setRecHanded(false);
    } finally {
      setRecBusy(false);
    }
  };

  // ---- 3. config + address ----
  const built = useMemo(() => {
    if (!signer) return { error: "Building your key tree…" } as const;
    let recoveryRoot: Uint8Array | undefined;
    if (recMode === "code") {
      const c = recCode.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(c)) return { error: "A recovery code is 64 hex characters." } as const;
      recoveryRoot = Uint8Array.from(c.match(/../g)!.map((h) => parseInt(h, 16)));
      if (recoveryRoot.every((b) => b === 0)) return { error: "That recovery code is empty." } as const;
      if (recoveryRoot.every((b, i) => b === signer.pub.root[i])) return { error: "The recovery code cannot be your own primary root." } as const;
    } else if (recMode === "generate") {
      if (!recRoot) return { error: "Generate the recovery phrase first." } as const;
      if (!recHanded) return { error: "Confirm the recovery phrase was written down / handed over." } as const;
      recoveryRoot = recRoot;
    }
    const days = Number(recDays);
    if (recoveryRoot && (!Number.isFinite(days) || days < 1 || days > 3650)) return { error: "Recovery delay must be 1–3650 days." } as const;
    const wl: PublicKey[] = [];
    for (const w of whitelist.map((x) => x.trim()).filter(Boolean)) {
      try {
        wl.push(new PublicKey(w));
      } catch {
        return { error: `Not a valid address: ${short(w, 6)}` } as const;
      }
    }
    if (new Set(wl.map((k) => k.toBase58())).size !== wl.length) return { error: "The whitelist has a duplicate." } as const;
    const hours = Number(slowHours);
    if (wl.length && !strict && (!Number.isFinite(hours) || hours < 1 || hours > 24 * 365)) return { error: "Delay must be 1 hour to 365 days." } as const;
    const coSigners: Uint8Array[] = [];
    for (const [i, raw] of coCodes.entries()) {
      const c = raw.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(c)) return { error: `Co-signer code ${i + 1} must be 64 hex characters.` } as const;
      const root = fromHex(c);
      if (root.every((b) => b === 0)) return { error: `Co-signer code ${i + 1} is empty.` } as const;
      const same = (a: Uint8Array, b: Uint8Array) => a.every((x, k) => x === b[k]);
      if (same(root, signer.pub.root) || (recoveryRoot && same(root, recoveryRoot)) || coSigners.some((r) => same(r, root)))
        return { error: `Co-signer code ${i + 1} repeats another key in this vault.` } as const;
      coSigners.push(root);
    }
    const signers = 1 + coSigners.length;
    if (threshold < 1 || threshold > signers) return { error: `Threshold must be 1–${signers}.` } as const;
    let instant = 0n;
    try {
      instant = instantSol.trim() ? toBaseUnits(instantSol, 9) : 0n;
    } catch {
      return { error: "Daily instant limit must be a number of SOL." } as const;
    }
    const heirList: { addr: PublicKey; bps: number }[] = [];
    for (const h of heirs) {
      if (!h.addr.trim() && !h.pct.trim()) continue;
      let addr: PublicKey;
      try {
        addr = new PublicKey(h.addr.trim());
      } catch {
        return { error: `Heir address is not valid: ${short(h.addr, 6)}` } as const;
      }
      const pct = Number(h.pct);
      if (!(pct > 0) || Math.round(pct * 100) !== pct * 100) return { error: "Heir shares are percentages with at most 2 decimals." } as const;
      heirList.push({ addr, bps: Math.round(pct * 100) });
    }
    if (heirList.length && heirList.reduce((t, h) => t + h.bps, 0) !== 10000) return { error: "Heir shares must add up to exactly 100%." } as const;
    const tdays = Number(testDays);
    if (heirList.length && (!Number.isFinite(tdays) || tdays < 30 || tdays > 3650)) return { error: "Testament delay must be 30–3650 days." } as const;
    const restricted = wl.length > 0 || instant > 0n;
    if (instant > 0n && !strict && !wl.length && (!Number.isFinite(hours) || hours < 1)) return { error: "Delay must be at least 1 hour." } as const;
    const config = makeConfig(signer, {
      coSigners,
      threshold,
      recoveryRoot,
      recoveryDelaySecs: recoveryRoot ? Math.round(days * 86400) : undefined,
      whitelist: wl,
      slowDelaySecs: restricted ? (strict ? 0 : Math.round(hours * 3600)) : 0,
      instantLimitLamports: instant,
      heirs: heirList,
      testamentDelaySecs: heirList.length ? Math.round(tdays * 86400) : undefined,
    });
    return { config, vault: vaultOf(config, program.programId) } as const;
  }, [signer, recMode, recCode, recRoot, recHanded, recDays, whitelist, strict, slowHours, coCodes, threshold, instantSol, heirs, testDays, program]);

  const config = "config" in built ? built.config : null;
  const vault = "vault" in built ? built.vault : null;

  // remember the (public) config per vault so an uninitialized deposit can be finished later
  useEffect(() => {
    if (!config || !vault) return;
    try {
      localStorage.setItem(`nox3.config.${vault.toBase58()}`, JSON.stringify(configToJson(config)));
    } catch {}
  }, [config, vault]);

  // ---- 4. live status of the address ----
  const [balance, setBalance] = useState<number | null>(null);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [rentMin, setRentMin] = useState(890_880);
  const refresh = useCallback(async () => {
    if (!vault) return;
    try {
      const [b, st] = await Promise.all([connection.getBalance(vault, "confirmed"), fetchState(program, vault)]);
      setBalance(b);
      setInitialized(!!st);
    } catch {
      setBalance(null);
      setInitialized(null);
    }
  }, [vault, connection, program]);
  useEffect(() => {
    setBalance(null);
    setInitialized(null);
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    connection.getMinimumBalanceForRentExemption(0).then(setRentMin).catch(() => {});
  }, [connection]);

  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!vault) return setQr(null);
    QRCode.toString(`solana:${vault.toBase58()}`, { type: "svg", margin: 1, color: { dark: "#e6f0ef", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [vault]);

  // ---- 5. initialize + deposit ----
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string; sig?: string } | null>(null);
  const ready = !!config && !!vault && vaultNumber !== null && !scanErr && deployed !== false && initialized !== null;

  const initAndDeposit = async () => {
    if (!ready || !config || !vault || !wallet.publicKey) return;
    setMsg(null);
    setBusy("wallet");
    try {
      const lamports = toBaseUnits(amount, 9);
      if ((balance ?? 0) === 0 && lamports > 0n && lamports < BigInt(rentMin))
        throw new Error(`The first deposit must be at least ${sol(rentMin, 6)} SOL (rent minimum).`);
      const ixs: TransactionInstruction[] = [];
      if (!initialized) ixs.push(await initVaultIx(program, wallet.publicKey, config));
      if (lamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: vault, lamports: Number(lamports) }));
      if (!ixs.length) throw new Error("Nothing to do");
      const sig = await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, ixs);
      setMsg({ kind: "ok", text: initialized ? `Deposited ${amount} SOL.` : `Vault initialized${lamports > 0n ? ` and funded with ${amount} SOL` : ""}.`, sig });
      refresh();
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  const initViaRelayer = async () => {
    if (!ready || !config) return;
    setMsg(null);
    setBusy("relayer");
    try {
      const r = await fetch("/api/init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(configToJson(config)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Init failed (${r.status})`);
      setMsg({ kind: "ok", text: j.already ? "This vault was already initialized." : "The relayer initialized your vault.", sig: j.signature });
      refresh();
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  // ---------- render ----------

  if (scanErr)
    return (
      <Panel title="step 2 // your vault">
        <div className="flex flex-col items-start gap-3 p-4 sm:p-5">
          <Note kind="bad">
            Could not check the chain for vaults these words already have ({scanErr}). Everything is disabled until this works, so an
            existing vault is never set up twice. Searching needs an RPC that allows getProgramAccounts.
          </Note>
          <button className="btn ghost sm" onClick={() => setScanTry((n) => n + 1)}>
            retry
          </button>
        </div>
      </Panel>
    );

  if (!signer || vaultNumber === null)
    return (
      <Panel title="step 2 // your key tree">
        <div className="p-4 sm:p-5">
          {progress ? (
            <TreeProgress label="primary tree (256 one-time keys)" done={progress.done} total={progress.total} />
          ) : (
            <div className="text-[13px] text-mute">
              checking the chain<span className="blink">…</span>
            </div>
          )}
        </div>
      </Panel>
    );

  const wlCount = whitelist.filter((w) => w.trim()).length;

  return (
    <>
      <Panel title={`step 2 // settings · vault number ${vaultNumber}`}>
        <div className="flex flex-col gap-6 p-4 sm:p-5">
          {/* recovery */}
          <div className="flex flex-col gap-3">
            <Label>recovery key</Label>
            <div className="grid gap-2 sm:grid-cols-3 [&>*]:min-w-0">
              {(
                [
                  ["none", "None", "only your phrase can act"],
                  ["code", "Paste a recovery code", "the holder makes it on /cosign"],
                  ["generate", "Make a recovery phrase", "24 words to hand to someone"],
                ] as const
              ).map(([m, t, d]) => (
                <button
                  key={m}
                  onClick={() => setRecMode(m)}
                  className={`rounded-md border px-3 py-2.5 text-left ${recMode === m ? "border-teal bg-teal/[0.06]" : "border-line-2"}`}
                >
                  <div className={`text-[12.5px] ${recMode === m ? "text-teal" : ""}`}>{t}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{d}</div>
                </button>
              ))}
            </div>
            {recMode === "code" && (
              <input
                className="field font-mono"
                placeholder="64 hex characters from the recovery holder"
                value={recCode}
                onChange={(e) => setRecCode(e.target.value)}
                spellCheck={false}
              />
            )}
            {recMode === "generate" && (
              <div className="flex flex-col gap-3">
                {!recWords ? (
                  <button className="btn ghost self-start" onClick={makeRecovery} disabled={recBusy}>
                    {recBusy ? "building…" : "generate recovery phrase"}
                  </button>
                ) : (
                  <>
                    <Note kind="warn">
                      Give these 24 words to the person (or place) that should hold recovery, together with the vault address and vault
                      number {vaultNumber}. They are shown once and never stored.
                    </Note>
                    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
                      {recWords.split(" ").map((w, i) => (
                        <li key={i} className="flex gap-2 bg-ink-2 px-3 py-1.5 text-[12.5px]">
                          <span className="w-5 text-right text-[10px] text-dim">{i + 1}</span>
                          {w}
                        </li>
                      ))}
                    </ol>
                    <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                      <input type="checkbox" className="accent-[#2ee6d6]" checked={recHanded} onChange={(e) => setRecHanded(e.target.checked)} />
                      The recovery phrase is written down / handed over.
                    </label>
                  </>
                )}
              </div>
            )}
            {recMode !== "none" && (
              <label className="flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
                Full control for recovery after
                <input className="field !w-24" inputMode="numeric" value={recDays} onChange={(e) => setRecDays(e.target.value)} />
                days of owner inactivity. It can always cancel a pending withdrawal.
              </label>
            )}
          </div>

          {/* whitelist */}
          <div className="flex flex-col gap-3">
            <Label>whitelist (up to 4 addresses, optional)</Label>
            {whitelist.map((w, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="field flex-1"
                  placeholder="wallet address"
                  value={w}
                  onChange={(e) => setWhitelist((l) => l.map((x, k) => (k === i ? e.target.value : x)))}
                  spellCheck={false}
                />
                {whitelist.length > 1 && (
                  <button className="btn ghost sm" onClick={() => setWhitelist((l) => l.filter((_, k) => k !== i))} aria-label="Remove">
                    ×
                  </button>
                )}
              </div>
            ))}
            {whitelist.length < 4 && (
              <button className="self-start text-[11px] uppercase tracking-[0.14em] text-dim hover:text-teal" onClick={() => setWhitelist((l) => [...l, ""])}>
                [+ add address]
              </button>
            )}
            <label className="flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
              Daily instant limit
              <input className="field !w-28" inputMode="decimal" value={instantSol} onChange={(e) => setInstantSol(e.target.value)} />
              SOL per 24 h may go to other addresses at once (0 = off). Above it, they wait.
            </label>
            {(wlCount > 0 || (Number(instantSol) || 0) > 0) && (
              <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
                Withdrawals to other addresses:
                <label className="flex items-center gap-2">
                  <input type="radio" className="accent-[#2ee6d6]" checked={!strict} onChange={() => setStrict(false)} />
                  wait
                  <input className="field !w-20" inputMode="numeric" value={slowHours} onChange={(e) => setSlowHours(e.target.value)} disabled={strict} />
                  hours (cancellable)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" className="accent-[#2ee6d6]" checked={strict} onChange={() => setStrict(true)} />
                  strict: whitelist only
                </label>
              </div>
            )}
          </div>

          {/* co-signers */}
          <div className="flex flex-col gap-3">
            <Label>co-signers (optional, up to 2)</Label>
            <p className="text-[11.5px] text-dim">
              Each co-signer opens <Link href="/cosign" className="underline">/cosign</Link> with their own phrase and sends you their code. With a
              threshold above 1, every action needs that many signers to approve the same thing.
            </p>
            {coCodes.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="field flex-1 font-mono"
                  placeholder={`co-signer ${i + 2} code (64 hex)`}
                  value={c}
                  onChange={(e) => setCoCodes((l) => l.map((x, k) => (k === i ? e.target.value : x)))}
                  spellCheck={false}
                />
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    setCoCodes((l) => l.filter((_, k) => k !== i));
                    setThreshold((t) => Math.min(t, coCodes.length));
                  }}
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            {coCodes.length < 2 && (
              <button className="self-start text-[11px] uppercase tracking-[0.14em] text-dim hover:text-teal" onClick={() => setCoCodes((l) => [...l, ""])}>
                [+ add co-signer]
              </button>
            )}
            {coCodes.length > 0 && (
              <label className="flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
                Approvals needed:
                <select className="field !w-24" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
                  {Array.from({ length: coCodes.length + 1 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} of {coCodes.length + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* testament */}
          <div className="flex flex-col gap-3">
            <Label>testament (optional, up to 4 heirs)</Label>
            {heirs.map((h, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="field flex-1"
                  placeholder="heir wallet address"
                  value={h.addr}
                  onChange={(e) => setHeirs((l) => l.map((x, k) => (k === i ? { ...x, addr: e.target.value } : x)))}
                  spellCheck={false}
                />
                <input
                  className="field !w-24"
                  placeholder="%"
                  inputMode="decimal"
                  value={h.pct}
                  onChange={(e) => setHeirs((l) => l.map((x, k) => (k === i ? { ...x, pct: e.target.value } : x)))}
                />
                <button className="btn ghost sm" onClick={() => setHeirs((l) => l.filter((_, k) => k !== i))} aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
            {heirs.length < 4 && (
              <button
                className="self-start text-[11px] uppercase tracking-[0.14em] text-dim hover:text-teal"
                onClick={() => setHeirs((l) => [...l, { addr: "", pct: l.length ? "" : "100" }])}
              >
                [+ add heir]
              </button>
            )}
            {heirs.length > 0 && (
              <label className="flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
                Anyone may distribute the vault to the heirs after
                <input className="field !w-24" inputMode="numeric" value={testDays} onChange={(e) => setTestDays(e.target.value)} />
                days without owner activity. Shares must add up to 100%.
              </label>
            )}
          </div>

          {/* remember */}
          <div className="flex flex-col gap-2">
            <Label>remember the words in this browser?</Label>
            <div className="grid gap-2 sm:grid-cols-3 [&>*]:min-w-0">
              {(
                [
                  ["off", "Don't remember", "gone when you close the page"],
                  ["session", "This tab only", "sessionStorage"],
                  ["local", "Keep on this device", "localStorage, until you forget"],
                ] as const
              ).map(([v, t, d]) => (
                <button key={v} onClick={() => setRemember(v)} className={`rounded-md border px-3 py-2 text-left ${remember === v ? "border-teal bg-teal/[0.06]" : "border-line-2"}`}>
                  <div className={`text-[12.5px] ${remember === v ? "text-teal" : ""}`}>{t}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{d}</div>
                </button>
              ))}
            </div>
            {remember !== "off" && <Note kind="warn">The words are stored unencrypted. Anything that can run script on this site could read them.</Note>}
          </div>
        </div>
      </Panel>

      <Panel lit={!!vault} title="step 3 // your vault">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {"error" in built ? (
            <Note kind="warn">{built.error}</Note>
          ) : (
            <>
<dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-[12.5px] [&>dd]:min-w-0">
                <dt className="text-dim">signers</dt>
                <dd>
                  {signerCountOf(config!)} ({signerCountOf(config!) === 1 ? "you" : `you + ${signerCountOf(config!) - 1} co-signer${signerCountOf(config!) > 2 ? "s" : ""}`}) ·{" "}
                  {config!.threshold} must approve each action · 256 one-time keys each
                </dd>
                <dt className="text-dim">recovery</dt>
                <dd>
                  {config!.trees[RECOVERY_TREE].height
                    ? `yes, 16 keys · may always cancel; full control after ${duration(Number(config!.recoveryDelay))} of owner inactivity`
                    : "none"}
                </dd>
                <dt className="text-dim">whitelist</dt>
                <dd>{config!.whitelist.length ? config!.whitelist.map((k) => short(new PublicKey(k).toBase58(), 4)).join(", ") : "none"}</dd>
                <dt className="text-dim">other addresses</dt>
                <dd>
                  {!config!.whitelist.length && config!.instantLimit === 0n
                    ? "allowed immediately"
                    : `${config!.instantLimit > 0n ? `up to ${sol(config!.instantLimit)} SOL / 24 h at once, then ` : ""}${
                        config!.slowDelay === 0n ? "refused" : `wait ${duration(Number(config!.slowDelay))} (cancellable)`
                      }; tokens always wait`}
                </dd>
                <dt className="text-dim">testament</dt>
                <dd>
                  {config!.heirs.length
                    ? `${config!.heirs.map((h) => `${short(new PublicKey(h.addr).toBase58(), 4)} ${h.bps / 100}%`).join(", ")} after ${duration(Number(config!.testamentDelay))} of inactivity`
                    : "none"}
                </dd>
                <dt className="text-dim">status</dt>
                <dd>
                  {initialized === null ? "checking…" : initialized ? <span className="text-teal">initialized</span> : "not initialized yet"} ·{" "}
                  {balance === null ? "…" : `${sol(balance)} SOL`}
                </dd>
              </dl>
              <div className="grid gap-4 sm:grid-cols-[1fr_150px] [&>*]:min-w-0">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label>vault address</Label>
                    <Copy value={vault!.toBase58()} />
                  </div>
                  <a
                    href={explorerUrl(vault!.toBase58())}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all rounded-md border border-line-2 bg-ink px-3 py-2.5 text-[13px] hover:border-teal/50"
                  >
                    {vault!.toBase58()}
                  </a>
                  <p className="text-[11px] text-dim">
                    The address commits to these exact settings: change any of them and you get a different address. They can never be
                    changed later.
                  </p>
                </div>
                {qr && (
                  <div
                    className="mx-auto w-[150px] rounded-md border border-line-2 bg-ink p-2 [&_svg]:h-auto [&_svg]:w-full"
                    aria-label="QR code of the vault address"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel title="step 4 // initialize and fund">
        <div className="grid gap-0 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <Label>with a wallet</Label>
            <p className="text-[12.5px] text-mute">
              {initialized ? "Already initialized: this only deposits." : "One transaction: initialize the vault and deposit."} Your wallet
              pays; it gets no power over the vault.
            </p>
            {!wallet.publicKey ? (
              <button className="btn self-start" onClick={() => setVisible(true)}>
                connect wallet
              </button>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <input className="field pr-14" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in SOL" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-dim">SOL</span>
                  </div>
                  <button className="btn" onClick={initAndDeposit} disabled={!ready || !!busy}>
                    {busy === "wallet" ? "sending…" : initialized ? "deposit" : "initialize + deposit"}
                  </button>
                </div>
                {initialized && vault && <TokenDeposit vault={vault} disabled={!ready} />}
              </>
            )}
          </div>
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <Label>no wallet</Label>
            <p className="text-[12.5px] text-mute">
              Send SOL to the address (or scan the QR) from any wallet or exchange. Once it holds at least {RELAY_INIT_MIN / LAMPORTS_PER_SOL} SOL,
              the relayer initializes it for free.
            </p>
            <div className="text-[12.5px]">
              Balance: <span className="text-bone">{balance === null ? "…" : `${sol(balance)} SOL`}</span>{" "}
              {balance !== null && balance < RELAY_INIT_MIN && !initialized && <span className="text-dim">(waiting for ≥ 0.02 SOL)</span>}
            </div>
            <button className="btn outline self-start" onClick={initViaRelayer} disabled={!ready || !!busy || initialized === true || (balance ?? 0) < RELAY_INIT_MIN}>
              {busy === "relayer" ? "asking relayer…" : initialized ? "initialized" : "initialize via relayer"}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
          {deployed === false && <Note kind="warn">The Noxvault program is not deployed on {NETWORK}: initializing is disabled.</Note>}
          {msg && (
            <Note kind={msg.kind}>
              {msg.text}{" "}
              {msg.sig && (
                <a className="underline" href={explorerUrl(msg.sig, "tx")} target="_blank" rel="noreferrer">
                  view tx
                </a>
              )}
            </Note>
          )}
          <div className="flex flex-wrap gap-3">
            <Link href="/mine" className="btn ghost">
              go to my vaults →
            </Link>
            <button
              className="btn ghost"
              onClick={() => {
                forgetWords();
                onForget();
              }}
            >
              forget phrase
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}
