"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, TREE_PRIMARY, RECOVERY_TREE, actionDigest, type SignedAction } from "@nox/sdk/client";
import { encodeRelayRequest } from "@nox/sdk/relayer";
import { authPath, equal, recoverRoot, sign, type PublicTree, type TreeSeeds } from "@nox/sdk/wots";
import SecretInput from "@/components/SecretInput";
import { Copy, Label, Note, PageHead, Panel } from "@/components/ui";
import { errMsg, hex } from "@/lib/format";
import { ACTION_KINDS, EMPTY_FORM, KIND_FIELDS, KIND_LABEL, SLOT_LABEL, actionFromForm, splitForQr, summarize, type ActionForm } from "@/lib/offline";
import QrParts from "./QrParts";
import Summary from "./Summary";

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
  }, [vault, leaf, form]);

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
      const action = actionFromForm(form);
      const dec = KIND_FIELDS[form.kind].includes("asset") && form.asset === "token" ? Number(form.decimals) : undefined;
      return { ok: true as const, v, l, action, summary: summarize(v.toBase58(), tree, l, action, dec) };
    } catch (e) {
      return { ok: false as const, err: errMsg(e) };
    }
  }, [vault, leaf, form, tree, maxLeaf]);

  const doSign = () => {
    setSignErr(null);
    try {
      if (!built || !preview.ok) return;
      const { v, l, action } = preview;
      const digest = actionDigest(PROGRAM_ID, v, built.tree, l, action);
      const signature = sign(built.seeds, l, digest);
      const path = authPath(built.pub, l);
      if (!equal(recoverRoot(built.pub.pkSeed, l, digest, signature, path), built.pub.root))
        throw new Error("Self-check failed: the signature does not rebuild this tree's root.");
      const s: SignedAction = { vault: v, tree: built.tree, leaf: l, pkSeed: built.pub.pkSeed, authPath: path, signature, action };
      const text = JSON.stringify(encodeRelayRequest(s));
      setOut({ text, summary: preview.summary, digest: hex(digest) });
    } catch (e) {
      setSignErr(errMsg(e));
    }
  };

  const parts = useMemo(() => (out ? splitForQr(out.text, partSize) : []), [out, partSize]);
  const set = (k: keyof ActionForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="offline // air-gapped signing"
        title={
          <>
            Sign <span className="inv">offline</span>
          </>
        }
        sub="Sign a vault action on a device that is never online. This page makes no network requests at all: it turns your words into keys, signs one action and gives you the result as text and QR codes. Carry that to an online device and send it from /submit."
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
              <input className="field" value={vault} onChange={(e) => setVault(e.target.value)} placeholder="the vault's deposit address" spellCheck={false} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>leaf (one-time key #)</Label>
                <input className="field" inputMode="numeric" value={leaf} onChange={(e) => setLeaf(e.target.value.trim())} placeholder={`0–${maxLeaf}, from prepare`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>action</Label>
                <select className="field" value={form.kind} onChange={set("kind")}>
                  {ACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(() => {
              const f = KIND_FIELDS[form.kind];
              const tokenAsset = f.includes("asset") && form.asset === "token";
              const field = (k: keyof ActionForm, label: string, extra: Record<string, string> = {}) => (
                <div className="flex flex-col gap-1.5">
                  <Label>{label}</Label>
                  <input className="field" value={form[k] as string} onChange={set(k)} spellCheck={false} {...extra} />
                </div>
              );
              const unit = (k: "intervalUnit" | "periodUnit") => (
                <select className="field !w-24" value={form[k]} onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.value as "h" | "d" }))}>
                  <option value="h">hours</option>
                  <option value="d">days</option>
                </select>
              );
              return (
                <>
                  {f.includes("asset") && (
                    <>
                      <div className="flex gap-2">
                        {(["sol", "token"] as const).map((a) => (
                          <button key={a} className={`btn sm ${form.asset === a ? "outline" : "ghost"}`} onClick={() => setForm((x) => ({ ...x, asset: a }))}>
                            {a === "sol" ? "SOL" : "SPL / Token-2022"}
                          </button>
                        ))}
                      </div>
                      {tokenAsset && (
                        <div className="grid grid-cols-[1fr_96px] gap-3">
                          {field("mint", "mint")}
                          {field("decimals", "decimals", { inputMode: "numeric" })}
                        </div>
                      )}
                    </>
                  )}
                  {f.includes("id") && field("id", form.kind === "schedule" || form.kind === "cancelSchedule" ? "schedule slot (0–255)" : "budget slot (0–255)", { inputMode: "numeric" })}
                  {f.includes("session") && field("session", "session wallet (an ordinary wallet that may spend)")}
                  {f.includes("dest") && field("dest", form.kind === "schedule" ? "pay to" : "destination wallet")}
                  {f.includes("vote") && field("vote", "validator vote account")}
                  {f.includes("newVault") && field("newVault", "new vault address (must be an initialized Noxvault)")}
                  <div className="grid grid-cols-2 gap-3">
                    {f.includes("amount") &&
                      field(
                        "amount",
                        `${form.kind === "schedule" ? "amount per payment" : form.kind === "budget" ? "limit per period" : "amount"} (${tokenAsset ? "tokens" : "SOL"})`,
                        { inputMode: "decimal", placeholder: "0.0" }
                      )}
                    {f.includes("seed") && field("seed", "stake slot (0–7)", { inputMode: "numeric" })}
                    {f.includes("count") && field("count", "number of payments", { inputMode: "numeric" })}
                  </div>
                  {f.includes("interval") && (
                    <div className="flex flex-col gap-1.5">
                      <Label>every</Label>
                      <div className="flex gap-2">
                        <input className="field flex-1" inputMode="decimal" value={form.interval} onChange={set("interval")} />
                        {unit("intervalUnit")}
                      </div>
                    </div>
                  )}
                  {f.includes("period") && (
                    <div className="flex flex-col gap-1.5">
                      <Label>period</Label>
                      <div className="flex gap-2">
                        <input className="field flex-1" inputMode="decimal" value={form.period} onChange={set("period")} />
                        {unit("periodUnit")}
                      </div>
                    </div>
                  )}
                  {f.includes("start") && field("start", "first payment", { type: "datetime-local" })}
                  {f.includes("expires") && field("expires", "budget expires", { type: "datetime-local" })}
                  {(form.kind === "schedule" || form.kind === "budget" || form.kind === "cancelSchedule" || form.kind === "cancelBudget") && (
                    <p className="text-[11px] text-dim">Slots: take a free one (new) or the existing one (stop) from the online prepare step / vault view.</p>
                  )}
                </>
              );
            })()}
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>fee (SOL)</Label>
                <input className="field" inputMode="decimal" value={form.fee} onChange={set("fee")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>fee payee (relayer)</Label>
                <input className="field" value={form.feePayee} onChange={set("feePayee")} disabled={!Number(form.fee)} placeholder={Number(form.fee) ? "relayer address" : "no fee: you submit with a wallet"} spellCheck={false} />
              </div>
            </div>
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
            <Summary {...preview.summary} />
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
            <button className="btn" onClick={doSign} disabled={!built || !preview.ok || !ack}>
              sign this action
            </button>
            {!built && <span className="text-[11px] text-dim">build keys first</span>}
          </div>
          {signErr && <div className="text-[12px] text-bad">✕ {signErr}</div>}
        </div>
      </Panel>

      {out && (
        <Panel title="04 // signed request" right={<Copy value={out.text} />} lit>
          <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[1fr_400px] [&>*]:min-w-0">
            <div className="flex flex-col gap-3">
              <Note kind="ok">
                Signed and self-checked against your tree root. This text holds no secret: it can only ever perform the action
                above. Move it to an online device and open <strong>/submit</strong>.
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
              <QrParts parts={parts} />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
