"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, TREE_PRIMARY, RECOVERY_TREE, actionDigest, type SignedAction } from "@nox/sdk/client";
import { encodeRelayRequest } from "@nox/sdk/relayer";
import { authPath, equal, recoverRoot, sign, type PublicTree, type TreeSeeds } from "@nox/sdk/wots";
import SecretInput from "@/components/SecretInput";
import { Copy, Label, Note, PageHead, Panel } from "@/components/ui";
import { errMsg, hex } from "@/lib/format";
import {
  EMPTY_FORM,
  KIND_FIELDS,
  KIND_LABEL,
  PartCollector,
  SIGNED_PREFIX,
  SLOT_LABEL,
  UNSIGNED_PREFIX,
  actionFromForm,
  decodeUnsigned,
  splitForQr,
  summarize,
  type ActionForm,
  type UnsignedRequest,
} from "@/lib/offline";
import Scanner from "../submit/Scanner";
import { ActionFields, FeeFields, KindSelect } from "./ActionFields";
import QrParts from "./QrParts";
import Summary from "./Summary";

// What this device has signed, per vault / slot / leaf: the digest only (public, no secret). A
// second, different message for the same leaf is refused here even if the online device asks.
const signedKey = (vault: string, tree: number, leaf: number) => `nox.offline.signed.${vault}.${tree}.${leaf}`;
function signedBefore(vault: string, tree: number, leaf: number): string | null {
  try {
    return localStorage.getItem(signedKey(vault, tree, leaf));
  } catch {
    return null;
  }
}
function rememberSigned(vault: string, tree: number, leaf: number, digest: string) {
  try {
    localStorage.setItem(signedKey(vault, tree, leaf), digest);
  } catch {}
}

interface Built {
  tree: number;
  vaultNumber: number;
  seeds: TreeSeeds;
  pub: PublicTree;
}

const PART_SIZES = [
  { v: 600, l: "small parts (easiest to scan)" },
  { v: 800, l: "medium parts" },
  { v: 1000, l: "large parts (fewest QRs)" },
];

const AIRGAP_STEPS: [string, ReactNode][] = [
  ["online", <>On <Link key="l" href="/submit" className="text-teal">/submit</Link>, look up the vault and compose the action. It shows an animated QR.</>],
  ["offline", "Here, scan that QR. Every field of the action is shown before you sign."],
  ["offline", "Sign with your words. The signed request appears as an animated QR."],
  ["online", "Scan it back on /submit. It is checked against the chain, then sent via the relayer or your wallet."],
];

function useOnline() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", up);
    };
  }, []);
  return online;
}

export default function OfflineSigner() {
  const online = useOnline();
  const [master, setMaster] = useState<Uint8Array | null>(null);
  const [vaultNumber, setVaultNumber] = useState("0");
  const [tree, setTree] = useState<number>(TREE_PRIMARY);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [vault, setVault] = useState("");
  const [leaf, setLeaf] = useState("");
  const [form, setForm] = useState<ActionForm>(EMPTY_FORM);
  const [ack, setAck] = useState(false);
  const [out, setOut] = useState<{ text: string; summary: ReturnType<typeof summarize>; digest: string } | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [partSize, setPartSize] = useState(800);

  // Air-gapped input: an unsigned action scanned from the online device's animated QR.
  const [imported, setImported] = useState<UnsignedRequest | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanState, setScanState] = useState<{ have: number; n: number; note?: string }>({ have: 0, n: 0 });
  const collector = useRef(new PartCollector(UNSIGNED_PREFIX));
  const startScan = () => {
    collector.current = new PartCollector(UNSIGNED_PREFIX);
    setScanState({ have: 0, n: 0 });
    setScanning(true);
  };
  const onCode = (text: string) => {
    const c = collector.current;
    const r = c.add(text);
    if (r === "bad") {
      if (text.startsWith(`${SIGNED_PREFIX}:`)) setScanState((x) => ({ ...x, note: "That is a signed request. Scan it on the online device, at /submit." }));
      return;
    }
    if (r === "other") return setScanState((x) => ({ ...x, note: "That QR belongs to a different action. Scan again from the start." }));
    if (r === "new") setScanState({ have: c.parts.size, n: c.n });
    if (!c.done) return;
    try {
      const u = decodeUnsigned(c.text()!);
      setImported(u);
      setVault(u.vault.toBase58());
      setLeaf(String(u.leaf));
      setTree(u.tree);
      setScanning(false);
    } catch (e) {
      collector.current = new PartCollector(UNSIGNED_PREFIX);
      setScanState({ have: 0, n: 0, note: errMsg(e) });
    }
  };
  const dropImport = () => {
    setImported(null);
    setVault("");
    setLeaf("");
  };

  const newWorker = () => new Worker(new URL("./tree.worker.ts", import.meta.url));

  // Load the worker once while the page is open, so its code is cached for offline use.
  useEffect(() => {
    const warm = () => {
      const w = newWorker();
      w.postMessage({ type: "ping" });
      w.onmessage = () => w.terminate();
      setTimeout(() => w.terminate(), 10_000);
    };
    warm();
    // First visit: the service worker takes control only after install; load it once more then.
    navigator.serviceWorker?.addEventListener("controllerchange", warm);
    return () => {
      navigator.serviceWorker?.removeEventListener("controllerchange", warm);
      workerRef.current?.terminate();
    };
  }, []);

  const vn = Number(vaultNumber);
  const vnOk = /^\d+$/.test(vaultNumber) && vn < 2 ** 31;
  // Any change to the secret inputs invalidates the built tree and any output.
  useEffect(() => {
    setBuilt(null);
    setOut(null);
  }, [master, vaultNumber, tree]);
  useEffect(() => {
    setOut(null);
    setAck(false);
  }, [vault, leaf, form, imported]);

  const build = () => {
    if (!master || !vnOk) return;
    workerRef.current?.terminate();
    const w = newWorker();
    workerRef.current = w;
    setBuildErr(null);
    setProgress({ done: 0, total: tree === RECOVERY_TREE ? 16 : 256 });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") setProgress({ done: m.done, total: m.total });
      if (m.type === "done") {
        setBuilt({ tree: m.tree, vaultNumber: vn, seeds: m.seeds, pub: m.pub });
        setProgress(null);
        w.terminate();
      }
      if (m.type === "error") {
        setBuildErr(m.message);
        setProgress(null);
        w.terminate();
      }
    };
    w.onerror = (e) => {
      setBuildErr(e.message || "worker failed");
      setProgress(null);
    };
    w.postMessage({ type: "build", master, vaultNumber: vn, tree });
  };

  const forget = () => {
    workerRef.current?.terminate();
    master?.fill(0);
    setMaster(null);
    setBuilt(null);
    setOut(null);
    setProgress(null);
  };

  const maxLeaf = built ? (1 << built.pub.height) - 1 : tree === RECOVERY_TREE ? 15 : 255;

  // Live preview of what will be signed.
  const preview = useMemo(() => {
    try {
      const v = new PublicKey(vault.trim());
      const l = Number(leaf);
      if (leaf === "" || !Number.isInteger(l) || l < 0 || l > maxLeaf) throw new Error(`Leaf must be 0–${maxLeaf}`);
      if (imported && (!imported.vault.equals(v) || imported.leaf !== l || imported.tree !== tree))
        throw new Error("Vault, leaf or slot no longer match the scanned action. Scan again or clear it.");
      const action = imported ? imported.action : actionFromForm(form);
      const dec = imported ? imported.decimals : KIND_FIELDS[form.kind].includes("asset") && form.asset === "token" ? Number(form.decimals) : undefined;
      const digest = hex(actionDigest(PROGRAM_ID, v, tree, l, action));
      return { ok: true as const, v, l, action, digest, summary: summarize(v.toBase58(), tree, l, action, dec) };
    } catch (e) {
      return { ok: false as const, err: errMsg(e) };
    }
  }, [vault, leaf, form, tree, maxLeaf, imported]);

  // Did this device already sign something with this leaf? (localStorage, read after mount)
  const [prior, setPrior] = useState<string | null>(null);
  useEffect(() => {
    setPrior(preview.ok ? signedBefore(preview.v.toBase58(), tree, preview.l) : null);
  }, [preview, tree, out]);
  const conflict = preview.ok && prior !== null && prior !== preview.digest;

  const doSign = () => {
    setSignErr(null);
    try {
      if (!built || !preview.ok) return;
      const { v, l, action } = preview;
      const before = signedBefore(v.toBase58(), built.tree, l);
      if (before !== null && before !== preview.digest)
        throw new Error(`This device already signed a different message with one-time key #${l}. Signing a second one could let anyone forge signatures. Refused.`);
      const digest = actionDigest(PROGRAM_ID, v, built.tree, l, action);
      const signature = sign(built.seeds, l, digest);
      const path = authPath(built.pub, l);
      if (!equal(recoverRoot(built.pub.pkSeed, l, digest, signature, path), built.pub.root))
        throw new Error("Self-check failed: the signature does not rebuild this tree's root.");
      const s: SignedAction = { vault: v, tree: built.tree, leaf: l, pkSeed: built.pub.pkSeed, authPath: path, signature, action };
      const text = JSON.stringify(encodeRelayRequest(s));
      rememberSigned(v.toBase58(), built.tree, l, hex(digest));
      setOut({ text, summary: preview.summary, digest: hex(digest) });
    } catch (e) {
      setSignErr(errMsg(e));
    }
  };

  const parts = useMemo(() => (out ? splitForQr(out.text, partSize) : []), [out, partSize]);

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="offline // air-gapped signing"
        title={
          <>
            Sign <span className="inv">offline</span>
          </>
        }
        sub="Sign a vault action on a device that is never online. This page makes no network requests at all: it turns your words into keys, signs one action and gives you the result as text and an animated QR. Carry that to an online device and send it from /submit."
      />

      <div className="grid gap-3 md:grid-cols-3 [&>*]:min-w-0">
        <Note kind={online ? "warn" : "ok"}>
          {online === null
            ? "Checking network…"
            : online
              ? "This device is online. For real funds, load this page once, then disconnect (airplane mode, cable out) before typing your words."
              : "This device reports no network. Good."}
        </Note>
        <Note kind="info">
          Get the <strong>leaf number</strong> from the online <Link href="/submit" className="text-teal">prepare step</Link> (and check{" "}
          <Link href="/mine" className="text-teal">/mine</Link>) right before signing. This device cannot see the chain.
        </Note>
        <Note kind="bad">
          A one-time key (leaf) may sign <strong>one message, ever</strong>. If you sign a different action with the same leaf, never
          publish both: anyone could then forge signatures.
        </Note>
      </div>

      <Panel title="air-gapped over QR // no cable, no clipboard, no network" lit={!!imported}>
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_420px] [&>*]:min-w-0">
          <div className="flex flex-col gap-3">
            <ol className="grid gap-2 text-[12.5px] sm:grid-cols-2">
              {AIRGAP_STEPS.map(([who, d], i) => (
                <li key={i} className="flex gap-3 rounded border border-line px-3 py-2">
                  <span className="text-teal">0{i + 1}</span>
                  <span className="min-w-0">
                    <span className={`mr-2 text-[10px] uppercase tracking-[0.16em] ${who === "offline" ? "text-teal" : "text-dim"}`}>{who}</span>
                    <span className="text-mute">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[11.5px] text-dim">
              Only public data crosses the gap: the action going in, a one-time signature coming out. Your words never leave this device.
              Typing the action by hand below works too.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {imported ? (
              <>
                <Note kind="ok">
                  Action scanned: <strong>{KIND_LABEL[imported.action.kind as keyof typeof KIND_LABEL] ?? imported.action.kind}</strong> for vault{" "}
                  {imported.vault.toBase58().slice(0, 6)}…, {SLOT_LABEL(imported.tree)} key #{imported.leaf}. Review every field in step 03.
                </Note>
                <div className="flex flex-wrap gap-2">
                  <button className="btn ghost sm" onClick={startScan}>
                    scan another
                  </button>
                  <button className="btn ghost sm" onClick={dropImport}>
                    clear, type it by hand
                  </button>
                </div>
              </>
            ) : !scanning ? (
              <button className="btn self-start" onClick={startScan}>
                scan action from online device
              </button>
            ) : null}
            {scanning && (
              <>
                <span className="text-[12px] text-mute">
                  {scanState.n ? (
                    <>
                      scanned <span className="text-teal">{scanState.have}</span> of {scanState.n} parts · any order
                    </>
                  ) : (
                    "point the camera at the online device's QR…"
                  )}
                </span>
                {scanState.note && <Note kind="warn">{scanState.note}</Note>}
                <Scanner onCode={onCode} onClose={() => setScanning(false)} />
              </>
            )}
            {!scanning && scanState.note && !imported && <Note kind="bad">{scanState.note}</Note>}
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="01 // your words">
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            {master ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border border-teal-dim bg-teal/[0.05] px-3 py-2 text-[12px]">
                <span className="text-mute">24 words loaded in memory.</span>
                <button className="btn ghost sm" onClick={forget}>
                  forget words
                </button>
              </div>
            ) : (
              <SecretInput onSecret={(m) => setMaster(m)} cta="use these words" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>vault number</Label>
                <input className="field" inputMode="numeric" value={vaultNumber} onChange={(e) => setVaultNumber(e.target.value.trim())} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>your slot in the vault</Label>
                <select className="field" value={tree} onChange={(e) => setTree(Number(e.target.value))}>
                  <option value={TREE_PRIMARY}>signer 1 / owner (256 keys)</option>
                  <option value={1}>signer 2 / co-signer (256 keys)</option>
                  <option value={2}>signer 3 / co-signer (256 keys)</option>
                  <option value={RECOVERY_TREE}>recovery (16 keys)</option>
                </select>
              </div>
            </div>
            {!vnOk && <div className="text-[12px] text-bad">✕ Vault number must be a whole number (0, 1, 2…)</div>}
            <button className="btn" onClick={build} disabled={!master || !vnOk || !!progress}>
              {progress ? "building keys…" : built ? "rebuild keys" : "build keys"}
            </button>
            {progress && (
              <div className="flex flex-col gap-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-teal transition-[width]" style={{ width: `${(100 * progress.done) / progress.total}%` }} />
                </div>
                <div className="text-[11px] text-dim">
                  one-time key {progress.done} / {progress.total} (each is 34 chains × 255 hashes)
                </div>
              </div>
            )}
            {buildErr && <div className="text-[12px] text-bad">✕ {buildErr}</div>}
            <Note kind="warn">
              One tree, one vault: the tree of this phrase and vault number must serve <strong>only one vault</strong>. Online, check on{" "}
              <Link href="/mine" className="text-teal">/mine</Link> (or /vaults) that this tree root appears in no other vault before you sign.
            </Note>
            {built && (
              <div className="grid gap-1 text-[12px]">
                <div className="flex gap-3">
                  <span className="w-20 shrink-0 text-dim">tree root</span>
                  <span className="truncate text-teal">{hex(built.pub.root)}</span>
                </div>
                <div className="flex gap-3">
                  <span className="w-20 shrink-0 text-dim">keys</span>
                  <span className="text-mute">
                    {1 << built.pub.height} one-time keys, {SLOT_LABEL(built.tree)} tree of vault #{built.vaultNumber}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="02 // the action">
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <div className="flex flex-col gap-1.5">
              <Label>vault address</Label>
              <input className="field" value={vault} onChange={(e) => setVault(e.target.value)} placeholder="the vault's deposit address" spellCheck={false} readOnly={!!imported} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>leaf (one-time key #)</Label>
                <input className="field" inputMode="numeric" value={leaf} onChange={(e) => setLeaf(e.target.value.trim())} placeholder={`0–${maxLeaf}, from prepare`} readOnly={!!imported} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>action</Label>
                <KindSelect form={form} setForm={setForm} value={imported?.action.kind} disabled={!!imported} />
              </div>
            </div>

            {imported && (
              <Note kind="info">
                The action came from the online device&apos;s QR, so the fields are locked. Step 03 shows exactly what will be signed.
              </Note>
            )}
            {!imported && <ActionFields form={form} setForm={setForm} />}
            {!imported && <FeeFields form={form} setForm={setForm} />}
            <p className="text-[11px] text-dim">
              To use the gasless relayer, set its fee and address exactly as the prepare step shows. With fee 0 you send it yourself
              with a wallet that pays network fees.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="03 // review & sign" lit={!!out}>
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {preview.ok ? (
            <Summary {...preview.summary} digest={preview.digest} />
          ) : (
            <div className="text-[12.5px] text-dim">Fill in the action to see exactly what will be signed. ({preview.err})</div>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-mute">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-[#2ee6d6]" />
            <span>
              I took leaf #{leaf || "?"} from a fresh prepare step, and I have never signed a different action with this leaf. If I
              sign again, it will be this exact same action.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" onClick={doSign} disabled={!built || !preview.ok || !ack || conflict}>
              sign this action
            </button>
            {!built && <span className="text-[11px] text-dim">build keys first</span>}
          </div>
          {conflict && (
            <Note kind="bad">
              This device already signed a <strong>different</strong> message with one-time key #{leaf}. It will not sign another. Ask the
              online device for a fresh leaf (prepare step on /submit).
            </Note>
          )}
          {preview.ok && prior !== null && !conflict && (
            <Note kind="info">This device signed this exact action with this key before. Signing again gives the same signature, which is safe.</Note>
          )}
          {signErr && <div className="text-[12px] text-bad">✕ {signErr}</div>}
        </div>
      </Panel>

      {out && (
        <Panel title="04 // signed request" right={<Copy value={out.text} />} lit>
          <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[1fr_400px] [&>*]:min-w-0">
            <div className="flex flex-col gap-3">
              <Note kind="ok">
                Signed and self-checked against your tree root. This text holds no secret: it can only ever perform the action
                above. On the online device, open <strong>/submit</strong> and scan the animated QR (or paste the text).
              </Note>
              <Label>request ({out.text.length.toLocaleString("en-US")} characters)</Label>
              <textarea className="field h-56 resize-y text-[11px] leading-snug" readOnly value={out.text} onFocus={(e) => e.target.select()} />
              <div className="text-[11px] text-dim break-all">digest {out.digest}</div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <Label>as QR ({parts.length} parts)</Label>
                <select className="field !w-auto !py-1 text-[11.5px]" value={partSize} onChange={(e) => setPartSize(Number(e.target.value))}>
                  {PART_SIZES.map((p) => (
                    <option key={p.v} value={p.v}>
                      {p.l}
                    </option>
                  ))}
                </select>
              </div>
              <QrParts parts={parts} animate />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
