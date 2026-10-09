"use client";
import { useMemo, useState } from "react";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { LEN, LEN1, deriveKey, digits, recoverRoot, sign, equal, type OneTimeKey } from "@nox/sdk/wots";
import { Label, Note, PageHead, Panel } from "@/components/ui";
import { hex } from "@/lib/format";
import ChainGrid from "./ChainGrid";

const enc = new TextEncoder();
const digestOf = (m: string) => sha256(enc.encode(m));

interface Signed {
  msg: string;
  digest: Uint8Array;
  digits: number[];
  sig: Uint8Array[];
  ms: number;
}

export default function KeyLab() {
  const [key, setKey] = useState<OneTimeKey | null>(null);
  const [genMs, setGenMs] = useState(0);
  const [msg, setMsg] = useState("pay 1 SOL to the night watch");
  const [first, setFirst] = useState<Signed | null>(null);
  const [second, setSecond] = useState<Signed | null>(null);
  const [confirm2, setConfirm2] = useState(false);
  const [check, setCheck] = useState("");
  const [sigTamper, setSigTamper] = useState(false);

  const generate = () => {
    const t = performance.now();
    const k = deriveKey(randomBytes(32), 0);
    setGenMs(performance.now() - t);
    setKey(k);
    setFirst(null);
    setSecond(null);
    setConfirm2(false);
    setSigTamper(false);
  };

  const doSign = () => {
    if (!key) return;
    const d = digestOf(msg);
    const t = performance.now();
    const sig = sign(key, d);
    const s: Signed = { msg, digest: d, digits: digits(d), sig, ms: performance.now() - t };
    if (!first) {
      setFirst(s);
      setCheck(msg);
    } else if (msg === first.msg) {
      // deterministic: same message, same signature
      setFirst(s);
    } else if (!confirm2) {
      setConfirm2(true);
    } else {
      setSecond(s);
      setConfirm2(false);
    }
  };

  const verifyRes = useMemo(() => {
    if (!key || !first) return null;
    const sig = sigTamper ? first.sig.map((c, j) => (j === 5 ? Uint8Array.from(c, (x, i) => (i === 0 ? x ^ 1 : x)) : c)) : first.sig;
    const t = performance.now();
    const root = recoverRoot(key.pkSeed, digestOf(check), sig);
    return { ok: equal(root, key.root), root, ms: performance.now() - t };
  }, [key, first, check, sigTamper]);

  const sameAsFirst = first && msg === first.msg;
  const csum = first ? first.digits[LEN1] * 256 + first.digits[LEN1 + 1] : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="04 // key lab"
        title={
          <>
            Take a key <span className="inv">apart</span>
          </>
        }
        sub="Everything on this page runs in your browser with the same WOTS+ code the vaults use. Nothing is sent anywhere. The lab signs sha256(text) instead of a real withdrawal message."
      />

      {/* 1. key */}
      <Panel title="01 // generate" right={key && <span className="text-[10px] uppercase tracking-[0.18em] text-dim">{genMs.toFixed(1)} ms</span>}>
        <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center">
          <button className="btn shrink-0" onClick={generate}>
            {key ? "new key" : "generate key"}
          </button>
          {key ? (
            <div className="grid [&>*]:min-w-0 min-w-0 flex-1 gap-2 text-[12px]">
              <div className="flex gap-3">
                <span className="w-16 shrink-0 text-dim">pk_seed</span>
                <span className="truncate text-mute">{hex(key.pkSeed)}</span>
              </div>
              <div className="flex gap-3">
                <span className="w-16 shrink-0 text-dim">root</span>
                <span className="truncate text-moon">{hex(key.root)}</span>
              </div>
              <div className="flex gap-3">
                <span className="w-16 shrink-0 text-dim">work</span>
                <span className="text-mute">34 chains × 255 steps = 8,670 SHA-256 calls, then 1 more for the root</span>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-mute">
              A key is 34 secret starting values. Each is hashed 255 times; the 34 ends hashed together give the root, and the root
              gives the vault address.
            </p>
          )}
        </div>
      </Panel>

      {/* 2. chains */}
      <Panel title="02 // the 34 chains" right={<span className="text-[10px] uppercase tracking-[0.18em] text-dim">32 message + 2 checksum</span>}>
        <div className="p-4 sm:p-5">
          {key ? (
            <ChainGrid a={first?.digits ?? null} b={second?.digits ?? null} />
          ) : (
            <div className="py-10 text-center text-[12.5px] text-dim">Generate a key to see its chains.</div>
          )}
          {first && (
            <p className="mt-4 text-[12px] text-mute">
              Each message byte picks one position per chain: the signature is the value at that position. A verifier hashes it
              the rest of the way to the public end. The two checksum chains carry Σ(255 − byte) = {csum.toLocaleString("en-US")}, so pushing any message byte up pushes the checksum down: one signature never lets you sign something else.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid [&>*]:min-w-0 gap-6 lg:grid-cols-2">
        {/* 3. sign */}
        <Panel title="03 // sign">
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <Label>message</Label>
            <textarea
              className="field resize-none"
              rows={3}
              value={msg}
              onChange={(e) => {
                setMsg(e.target.value);
                setConfirm2(false);
              }}
              disabled={!key}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn" onClick={doSign} disabled={!key || !!second}>
                {!first ? "sign" : sameAsFirst ? "sign again (same message)" : confirm2 ? "sign anyway" : "sign a 2nd message"}
              </button>
              {first && <span className="text-[11px] text-dim">signed in {first.ms.toFixed(2)} ms · 1,088 bytes</span>}
            </div>
            {first && sameAsFirst && !second && (
              <Note>Same message, same signature, byte for byte. Re-signing the same message reveals nothing new.</Note>
            )}
            {confirm2 && (
              <Note kind="warn">
                This key already signed “{first?.msg}”. Signing a different message with it is exactly what Noxvault never does.
                Press again to see what it leaks.
              </Note>
            )}
            {second && (
              <Note kind="bad">
                Two messages signed with one key. On {second.digits.filter((d, j) => d !== first!.digits[j]).length} of {LEN}{" "}
                chains an attacker now holds a lower point than before, and can hash forward from whichever is lower. The red cells
                are positions that became reachable. With enough tries they can find a third message whose every position is
                reachable, and sign it. On chain this is impossible: the Spent marker stops a second unlock. Generate a new key to
                reset.
              </Note>
            )}
            {first && (
              <div className="mt-1">
                <Label>signature (first 4 of 34 chains)</Label>
                <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-dim">
                  {first.sig.slice(0, 4).map((c, j) => (
                    <span key={j} className="truncate">
                      <span className="text-mute">{String(j).padStart(2, "0")}@{String(first.digits[j]).padStart(3, " ")}</span> {hex(c)}
                    </span>
                  ))}
                  <span>…</span>
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* 4. verify */}
        <Panel title="04 // verify & tamper" lit={!!verifyRes?.ok}>
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            {!first ? (
              <p className="py-6 text-center text-[12.5px] text-dim">Sign a message first.</p>
            ) : (
              <>
                <Label>message to check against the first signature</Label>
                <textarea className="field resize-none" rows={3} value={check} onChange={(e) => setCheck(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn ghost sm"
                    onClick={() => setCheck((c) => (c.length ? c.slice(0, -1) + (c.endsWith("!") ? "?" : "!") : "x"))}
                  >
                    tamper message
                  </button>
                  <button className="btn ghost sm" onClick={() => setSigTamper((t) => !t)}>
                    {sigTamper ? "restore signature" : "flip 1 signature bit"}
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setCheck(first.msg);
                      setSigTamper(false);
                    }}
                  >
                    reset
                  </button>
                </div>
                {verifyRes && (
                  <div className={`border px-4 py-3 ${verifyRes.ok ? "border-moon text-moon" : "border-bad/70 text-bad"}`}>
                    <div className="font-display text-[22px]">{verifyRes.ok ? "VALID" : "REJECTED"}</div>
                    <div className="mt-1 text-[11px] text-dim">
                      rebuilt root {hex(verifyRes.root).slice(0, 24)}… {verifyRes.ok ? "=" : "≠"} key root ·{" "}
                      {verifyRes.ms.toFixed(2)} ms
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
