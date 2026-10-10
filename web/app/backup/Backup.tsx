"use client";
import { useRef, useState, type ReactNode } from "react";
import { Copy, Label, Note, PageHead, Panel } from "@/components/ui";
import { errMsg } from "@/lib/format";
import {
  SHARE_WORDS,
  decryptBackup,
  encryptBackup,
  parseBackupFile,
  passwordStrength,
  restorePhrase,
  splitPhrase,
  type Share,
} from "@/lib/backup";

const hideStyle = { WebkitTextSecurity: "disc" } as React.CSSProperties;

function PhraseField({ value, onChange, placeholder = "word1 word2 … word24" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [hidden, setHidden] = useState(true);
  const n = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        className="field resize-none leading-relaxed"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        style={hidden ? hideStyle : undefined}
      />
      <div className="flex items-center gap-4 text-[11px] text-dim">
        <span className={n === 24 ? "text-teal" : ""}>{n}/24 words</span>
        <button type="button" className="uppercase tracking-[0.18em] hover:text-teal" onClick={() => setHidden((h) => !h)}>
          [{hidden ? "show" : "hide"}]
        </button>
      </div>
    </div>
  );
}

function Words({ words }: { words: string }) {
  return (
    <ol className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-3 md:grid-cols-4">
      {words.split(" ").map((w, i) => (
        <li key={i} className="flex gap-2">
          <span className="w-5 shrink-0 text-right text-dim">{i + 1}</span>
          <span className="text-bone">{w}</span>
        </li>
      ))}
    </ol>
  );
}

function Restored({ words, fingerprint, children }: { words: string; fingerprint: string; children?: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-3 border border-teal-dim bg-teal/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-teal">✓ Phrase restored and re-derived · fingerprint {fingerprint}</span>
        <div className="flex items-center gap-3">
          <button className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-teal" onClick={() => setShow((s) => !s)}>
            [{show ? "hide" : "show"}]
          </button>
          <Copy value={words} />
        </div>
      </div>
      {show ? <Words words={words} /> : <div className="text-[12px] text-dim">Hidden. Make sure nobody is watching, then show.</div>}
      {children}
    </div>
  );
}

function Meter({ pw }: { pw: string }) {
  const s = passwordStrength(pw);
  const color = ["bg-bad", "bg-bad", "bg-warn", "bg-teal", "bg-teal"][s.score];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${pw && i <= s.score ? color : "bg-line"}`} />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-[11px]">
        <span className={s.score >= 3 ? "text-teal" : s.score === 2 ? "text-warn" : "text-bad"}>
          {pw ? `${s.label} · ~${s.bits} bits` : "no password yet"}
        </span>
        {s.hints[0] && <span className="text-dim">{s.hints[0]}</span>}
      </div>
    </div>
  );
}

// ---------- A: Shamir ----------

function SplitPanel() {
  const [phrase, setPhrase] = useState("");
  const [n, setN] = useState(3);
  const [k, setK] = useState(2);
  const [shares, setShares] = useState<Share[] | null>(null);
  const [fmt, setFmt] = useState<"words" | "hex">("words");
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setErr(null);
    try {
      setShares(await splitPhrase(phrase, n, k));
    } catch (e) {
      setShares(null);
      setErr(errMsg(e));
    }
  };

  return (
    <Panel title="01 // split into shares">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <p className="text-[12.5px] text-mute">
          Shamir&apos;s secret sharing: give one share each to people or places you trust. Any <strong className="text-bone">K</strong>{" "}
          shares rebuild the phrase; fewer reveal nothing about it at all.
        </p>
        <PhraseField value={phrase} onChange={(v) => (setPhrase(v), setShares(null))} />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>shares (N)</Label>
            <select className="field" value={n} onChange={(e) => (setN(Number(e.target.value)), setK((x) => Math.min(x, Number(e.target.value))), setShares(null))}>
              {Array.from({ length: 9 }, (_, i) => i + 2).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>needed to restore (K)</Label>
            <select className="field" value={k} onChange={(e) => (setK(Number(e.target.value)), setShares(null))}>
              {Array.from({ length: n - 1 }, (_, i) => i + 2).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn self-start" onClick={go} disabled={!phrase.trim()}>
          split phrase
        </button>
        {err && <div className="text-[12px] text-bad">✕ {err}</div>}
        {shares && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-mute">
                {shares.length} shares · fingerprint <span className="text-bone">{shares[0].fingerprint}</span>
              </span>
              <div className="flex gap-2">
                {(["words", "hex"] as const).map((f) => (
                  <button key={f} className={`btn sm ${fmt === f ? "outline" : "ghost"}`} onClick={() => setFmt(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {shares.map((s) => (
              <div key={s.index} className="rounded border border-line-2 bg-ink-2/70 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-teal">
                    share {s.index} of {s.n} · any {s.k} restore
                  </span>
                  <Copy value={fmt === "words" ? s.words : s.hex} />
                </div>
                {fmt === "words" ? <Words words={s.words} /> : <div className="break-all text-[12.5px] text-bone">{s.hex}</div>}
              </div>
            ))}
            <Note kind="warn">
              Write each share down with its label and the fingerprint. Never store two shares in the same place, and never keep
              K shares where one person or one break-in could reach them.
            </Note>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RestoreSharesPanel() {
  const [inputs, setInputs] = useState<string[]>(["", ""]);
  const [res, setRes] = useState<{ words: string; fingerprint: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      setRes(await restorePhrase(inputs));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="02 // restore from shares">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <p className="text-[12.5px] text-mute">
          Enter at least K shares, as {SHARE_WORDS} words or 84 hex characters each, in any order. A typo is caught by each
          share&apos;s checksum.
        </p>
        {inputs.map((v, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Label>share</Label>
            <textarea
              className="field resize-none text-[12px] leading-relaxed"
              rows={2}
              value={v}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setInputs((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button className="btn ghost sm" onClick={() => setInputs((xs) => [...xs, ""])} disabled={inputs.length >= 10}>
            + another share
          </button>
          {inputs.length > 2 && (
            <button className="btn ghost sm" onClick={() => setInputs((xs) => xs.slice(0, -1))}>
              − remove
            </button>
          )}
          <button className="btn sm" onClick={go} disabled={busy || inputs.filter((x) => x.trim()).length < 2}>
            restore
          </button>
        </div>
        {err && <div className="text-[12px] text-bad">✕ {err}</div>}
        {res && <Restored {...res} />}
      </div>
    </Panel>
  );
}

// ---------- B: encrypted file ----------

function EncryptPanel() {
  const [phrase, setPhrase] = useState("");
  const [label, setLabel] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const strength = passwordStrength(pw);

  const go = async () => {
    setErr(null);
    setDone(null);
    setBusy(true);
    try {
      if (pw !== pw2) throw new Error("The passwords differ");
      const file = await encryptBackup(phrase, pw, label.trim() || undefined);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "noxvault-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDone(file.fingerprint);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="03 // encrypted backup file">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <p className="text-[12.5px] text-mute">
          The phrase is encrypted in this tab with AES-256-GCM under a key stretched from your password with scrypt (N = 2¹⁷,
          r = 8, p = 1), then downloaded as <code className="text-teal">noxvault-backup.json</code>. The file is only as strong as the
          password.
        </p>
        <PhraseField value={phrase} onChange={(v) => (setPhrase(v), setDone(null))} />
        <div className="flex flex-col gap-1.5">
          <Label>label (optional, stored encrypted)</Label>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. main vault, primary phrase" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>password</Label>
            <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>repeat password</Label>
            <input className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <Meter pw={pw} />
        {pw2 && pw !== pw2 && <div className="text-[12px] text-warn">The passwords differ.</div>}
        <button className="btn self-start" onClick={go} disabled={busy || !phrase.trim() || !pw || pw !== pw2 || strength.score < 2}>
          {busy ? "encrypting…" : "encrypt & download"}
        </button>
        {strength.score < 2 && pw && <div className="text-[11px] text-dim">Needs at least a “fair” password.</div>}
        {err && <div className="text-[12px] text-bad">✕ {err}</div>}
        {done && (
          <Note kind="ok">
            Downloaded noxvault-backup.json (fingerprint {done}). Test it below before you rely on it. Keep the password somewhere
            other than the file.
          </Note>
        )}
      </div>
    </Panel>
  );
}

function DecryptPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ words: string; fingerprint: string; label?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      if (!text) throw new Error("Choose a file first");
      setRes(await decryptBackup(parseBackupFile(text), pw));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="04 // restore from file">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setName(f.name);
            setText(await f.text());
            setRes(null);
            setErr(null);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>
            choose backup file
          </button>
          <span className="truncate text-[12px] text-mute">{name || "no file chosen"}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>password</Label>
          <input
            className="field"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            autoComplete="current-password"
          />
        </div>
        <button className="btn self-start" onClick={go} disabled={busy || !text || !pw}>
          {busy ? "decrypting…" : "decrypt"}
        </button>
        {err && <div className="text-[12px] text-bad">✕ {err}</div>}
        {res && (
          <Restored words={res.words} fingerprint={res.fingerprint}>
            {res.label && <div className="text-[12px] text-mute">label: {res.label}</div>}
          </Restored>
        )}
      </div>
    </Panel>
  );
}

export default function Backup() {
  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="safety // backups"
        title={
          <>
            Back up your <span className="inv">words</span>
          </>
        }
        sub="Two ways to make losing your 24 words less likely, without trusting anyone with all of them. Everything on this page runs inside this tab and sends nothing over the network."
      />
      <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
        <Note kind="info">
          Paper still wins: the plain 24 words, written by hand and stored safely, are the simplest backup. Use these tools in
          addition, ideally on an offline device.
        </Note>
        <Note kind="warn">
          Back up the <strong>primary</strong> and the <strong>recovery</strong> phrase separately, and store them apart. The
          fingerprint lets you check which phrase a share or file belongs to without revealing it.
        </Note>
      </div>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <SplitPanel />
        <RestoreSharesPanel />
        <EncryptPanel />
        <DecryptPanel />
      </div>
    </div>
  );
}
