"use client";
// Owner side of sealed letters: unlock with the phrase, pick a vault, authorize a letter key,
// write / edit / delete letters and re-seal them to a later date (docs/SPEC.md §12).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  MAX_LETTER_LABEL,
  SIGNER_SLOTS,
  fetchLetterKey,
  findVaultsFor,
  inSlot,
  nextLetterId,
  vaultLetters,
  withRetry,
  type LetterKeyView,
  type LetterView,
  type Signer,
  type VaultStateView,
} from "@nox/sdk/client";
import { Copy, Empty, Label, Note, Panel } from "@/components/ui";
import SecretInput from "@/components/SecretInput";
import TreeProgress from "@/components/vault/TreeProgress";
import AuthorizeLetterKey from "@/components/letters/AuthorizeLetterKey";
import { useNox } from "@/lib/hooks";
import { getSigner } from "@/lib/trees";
import { errMsg, short, sol } from "@/lib/format";
import { dateTime, duration } from "@/lib/time";
import { sendIxs } from "@/lib/unlock";
import {
  LETTER_MARGIN_SECS,
  deleteLetter,
  loadLocalLetters,
  refreshLetters,
  saveLocalLetters,
  testamentHorizon,
  timeOfRound,
  writeLetter,
  type LocalLetter,
  type LocalLetters,
} from "@/lib/letters";

interface Found {
  n: number;
  signer: Signer;
  state: VaultStateView;
}

const MAX_NUMBERS = 16;
const TOP_UP_SOL = 0.02;

export default function LettersOwner() {
  const { program } = useNox();
  const [found, setFound] = useState<Found[] | null>(null);
  const [progress, setProgress] = useState<{ n: number; done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Found | null>(null);

  const scan = async (m: Uint8Array) => {
    setErr(null);
    setFound(null);
    setPick(null);
    const out: Found[] = [];
    try {
      for (let n = 0; n < MAX_NUMBERS; n++) {
        const signer = await getSigner(m, n, 0, (done, total) => setProgress({ n, done, total }));
        const states = await withRetry(() => findVaultsFor(program, signer));
        if (!states.length) break;
        for (const { state, slot } of states) out.push({ n, signer: inSlot(signer, slot), state });
      }
      setFound(out);
      if (out.length === 1) setPick(out[0]);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Panel title="your letters">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {!found && !progress && (
          <>
            <p className="text-[12.5px] text-mute">Enter your 24 words to find your vaults. They stay in this browser.</p>
            <SecretInput cta="find my vaults" onSecret={(m) => scan(m)} />
          </>
        )}
        {progress && <TreeProgress label={`vault number ${progress.n}`} done={progress.done} total={progress.total} />}
        {err && <Note kind="bad">Could not search the chain ({err}).</Note>}
        {found && !found.length && (
          <Empty title="no vaults found">
            These words have no vaults yet. <Link href="/create" className="underline">Create one</Link> first.
          </Empty>
        )}
        {found && found.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {found.map((f) => (
              <button
                key={f.state.vault.toBase58()}
                className={`rounded border px-3 py-2 text-[12px] ${pick?.state.vault.equals(f.state.vault) ? "border-teal text-bone" : "border-line-2 text-mute"}`}
                onClick={() => setPick(f)}
              >
                vault #{f.n} · {short(f.state.vault.toBase58(), 4)}
              </button>
            ))}
          </div>
        )}
        {pick && <VaultLetters key={pick.state.vault.toBase58()} vault={pick.state.vault} signer={pick.signer} state={pick.state} />}
      </div>
    </Panel>
  );
}

function VaultLetters({ vault, signer, state }: { vault: PublicKey; signer: Signer; state: VaultStateView }) {
  const { connection, program, wallet } = useNox();
  const { setVisible } = useWalletModal();
  const [local, setLocal] = useState<LocalLetters | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [chainKey, setChainKey] = useState<LetterKeyView | null | undefined>(undefined);
  const [chain, setChain] = useState<LetterView[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [origin, setOrigin] = useState("");

  // form
  const [editId, setEditId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [pass, setPass] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));

  const ownerPhrase = signer.tree < SIGNER_SLOTS;
  const horizon = testamentHorizon(state);
  const keyOk = !!local && !!chainKey && chainKey.key.equals(local.key.publicKey);
  const labelBytes = new TextEncoder().encode(label).length;

  const load = useCallback(async () => {
    try {
      // Only a signer phrase has letters here; other phrases simply see none.
      setLocal(ownerPhrase ? await loadLocalLetters(signer, vault) : null);
      setLocalErr(null);
    } catch (e) {
      setLocalErr(errMsg(e));
    }
    const [k, ls] = await Promise.all([fetchLetterKey(program, vault).catch(() => null), vaultLetters(program, vault).catch(() => null)]);
    setChainKey(k);
    setChain(ls);
  }, [program, vault, signer, ownerPhrase]);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, [load]);

  useEffect(() => {
    if (!local) return;
    let live = true;
    const tick = () => connection.getBalance(local.key.publicKey, "confirmed").then((b) => live && setBalance(b)).catch(() => {});
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [connection, local]);

  const rows = useMemo(() => {
    const byId = new Map<number, { local?: LocalLetter; chain?: LetterView }>();
    for (const l of local?.letters ?? []) byId.set(l.id, { local: l });
    for (const c of chain ?? []) byId.set(c.id, { ...byId.get(c.id), chain: c });
    return [...byId.entries()].sort((a, b) => a[0] - b[0]);
  }, [local, chain]);

  const act = async (what: string, fn: () => Promise<string | void>) => {
    setBusy(what);
    setMsg(null);
    try {
      const done = await fn();
      if (done) setMsg({ kind: "ok", text: done });
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
      load();
    }
  };

  const createKey = () =>
    act("creating a letter key", async () => {
      const l: LocalLetters = { key: Keypair.generate(), letters: local?.letters ?? [] };
      await saveLocalLetters(signer, vault, l);
      setLocal(l);
      return "A new letter key was created in this browser. Authorize it below, then top it up.";
    });

  const topUp = () =>
    act("topping up", async () => {
      if (!local) return;
      if (!wallet.publicKey) {
        setVisible(true);
        throw new Error("Connect a wallet to top up the letter key.");
      }
      const ix = SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: local.key.publicKey, lamports: Math.round(TOP_UP_SOL * 1e9) });
      await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [ix]);
      return `Sent ${TOP_UP_SOL} SOL to the letter key.`;
    });

  const horizonFor = (): number => {
    if (horizon) return horizon;
    const at = Math.floor(new Date(`${date}T12:00:00`).getTime() / 1000);
    const h = at - Math.floor(Date.now() / 1000);
    if (!Number.isFinite(h) || h < 86_400) throw new Error("Pick an opening date at least a day from now.");
    return h;
  };

  const save = () =>
    act("sealing", async () => {
      if (!local || !keyOk) throw new Error("Authorize this browser's letter key first.");
      if (!text.trim()) throw new Error("Write something first.");
      if (labelBytes > MAX_LETTER_LABEL) throw new Error(`The label is at most ${MAX_LETTER_LABEL} bytes.`);
      const id = editId ?? nextLetterId([...local.letters, ...(chain ?? [])]);
      const letter: LocalLetter = { id, label: label.trim(), text, pass: pass || undefined, horizon: horizonFor() };
      const next: LocalLetters = { ...local, letters: [...local.letters.filter((l) => l.id !== id), letter].sort((a, b) => a.id - b.id) };
      await saveLocalLetters(signer, vault, next); // the text is kept before anything is sent
      setLocal(next);
      const round = await writeLetter(program, vault, local.key, letter, (s) => setBusy(s));
      setEditId(null);
      setLabel("");
      setText("");
      setPass("");
      return `Sealed and written. It opens around ${dateTime(timeOfRound(round))} unless you are active before then.`;
    });

  const remove = (id: number) =>
    act("deleting", async () => {
      if (!local) return;
      if (!window.confirm("Delete this letter on chain and in this browser?")) return;
      if (chain?.some((c) => c.id === id)) {
        if (!keyOk) throw new Error("Only the authorized letter key can delete a letter on chain.");
        await deleteLetter(program, vault, local.key, id);
      }
      const next = { ...local, letters: local.letters.filter((l) => l.id !== id) };
      await saveLocalLetters(signer, vault, next);
      setLocal(next);
      return "Deleted.";
    });

  const refreshAll = () =>
    act("refreshing", async () => {
      if (!local) return;
      const r = await refreshLetters(program, vault, local, { force: true, onStep: (s) => setBusy(s) });
      if (r.errors.length) throw new Error(r.errors.join("; "));
      return `${r.refreshed} letter${r.refreshed === 1 ? "" : "s"} re-sealed to a later date.`;
    });

  const edit = (l: LocalLetter) => {
    setEditId(l.id);
    setLabel(l.label);
    setText(l.text);
    setPass(l.pass ?? "");
  };

  const readerUrl = `/letters/${vault.toBase58()}`;

  return (
    <div className="flex flex-col gap-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
        <span className="text-mute">vault</span>
        <span className="break-all">{vault.toBase58()}</span>
        <Link href={readerUrl} className="text-teal underline">
          public reader
        </Link>
        {origin && <Copy value={`${origin}${readerUrl}`} />}
      </div>

      {localErr && <Note kind="warn">{localErr}</Note>}

      {/* ---- letter key ---- */}
      <div className="flex flex-col gap-3">
        <Label>1 // letter key</Label>
        <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
          <div>
            <div className="text-dim">this browser</div>
            <div className="break-all">{local ? local.key.publicKey.toBase58() : "none"}</div>
            {local && <div className="text-dim">balance {balance === null ? "…" : `${sol(balance)} SOL`}</div>}
          </div>
          <div>
            <div className="text-dim">authorized on chain</div>
            <div className="break-all">{chainKey === undefined ? "…" : chainKey && !chainKey.key.equals(PublicKey.default) ? chainKey.key.toBase58() : "none"}</div>
            {chainKey && <div className="text-dim">since {dateTime(chainKey.updatedAt)}</div>}
          </div>
        </div>
        {!local && !localErr && (
          <button className="btn self-start" disabled={!!busy || !ownerPhrase} onClick={createKey}>
            create a letter key in this browser
          </button>
        )}
        {local && chainKey !== undefined && !keyOk && (
          <>
            <Note>
              {chainKey && !chainKey.key.equals(PublicKey.default)
                ? "The vault authorizes a different letter key (another browser, or an older key). Authorizing this one replaces it."
                : "Authorize this key with one of your one-time keys. It can only write this vault's letters."}
            </Note>
            <AuthorizeLetterKey vault={vault} signer={signer} letterKey={local.key.publicKey} onDone={() => act("reading", async () => "Letter key authorized.")} />
          </>
        )}
        {local && (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn ghost sm" disabled={!!busy} onClick={topUp}>
              top up {TOP_UP_SOL} SOL from wallet
            </button>
            <span className="text-[11.5px] text-dim">The letter key pays rent for its letters (about 0.007 SOL per KB, returned when a letter is deleted) and network fees.</span>
          </div>
        )}
      </div>

      {/* ---- write ---- */}
      {local && keyOk && (
        <div className="flex flex-col gap-3">
          <Label>2 // {editId === null ? "write a letter" : `edit letter #${editId}`}</Label>
          <input className="field" placeholder="label, shown to everyone (e.g. for Ana: wallets and documents)" value={label} onChange={(e) => setLabel(e.target.value)} />
          {labelBytes > MAX_LETTER_LABEL && <div className="text-[12px] text-bad">The label is {labelBytes} bytes; at most {MAX_LETTER_LABEL}.</div>}
          <textarea className="field min-h-[160px]" placeholder="the letter. Encrypted in this browser before it leaves." value={text} onChange={(e) => setText(e.target.value)} />
          <input
            className="field"
            type="password"
            placeholder="optional passphrase your heir knows (an extra lock after the date)"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="new-password"
          />
          {horizon ? (
            <div className="text-[12.5px] text-mute">
              Opens about {dateTime(Math.floor(Date.now() / 1000) + horizon)}: your testament delay ({duration(horizon - LETTER_MARGIN_SECS)}) plus 7 days. Each time you open your
              vault, this moves forward.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-mute">
              <span>This vault has no testament. Opens on</span>
              <input className="field w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <span className="text-dim">and each refresh keeps that same distance from the day you refresh.</span>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button className="btn" disabled={!!busy} onClick={save}>
              {busy ? `${busy}…` : editId === null ? "seal & write" : "seal & overwrite"}
            </button>
            {editId !== null && (
              <button className="btn ghost" disabled={!!busy} onClick={() => (setEditId(null), setLabel(""), setText(""), setPass(""))}>
                cancel edit
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- list ---- */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>3 // letters</Label>
          {local && keyOk && local.letters.length > 0 && (
            <button className="btn ghost sm" disabled={!!busy} onClick={refreshAll}>
              refresh all to a later date
            </button>
          )}
        </div>
        {chain === null && <Note kind="warn">Letters could not be listed (the RPC may block getProgramAccounts).</Note>}
        {!rows.length && <div className="text-[12.5px] text-dim">No letters yet.</div>}
        {rows.map(([id, r]) => (
          <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-line-2 px-3 py-2 text-[12.5px]">
            <div className="min-w-0">
              <div className="font-bold">
                #{id} {r.chain?.label || r.local?.label || "(no label)"}
              </div>
              <div className="text-dim">
                {r.chain
                  ? `${r.chain.complete ? "sealed" : "partly written"} · opens ${dateTime(timeOfRound(r.chain.unlockRound))} · updated ${dateTime(r.chain.updatedAt)}`
                  : "not on chain yet"}
                {r.chain && !r.local && " · this browser has no copy of the text, so it cannot be moved forward here"}
              </div>
            </div>
            <div className="flex gap-3 text-[11px] uppercase tracking-[0.14em]">
              {r.local && keyOk && (
                <button className="text-dim hover:text-teal" disabled={!!busy} onClick={() => edit(r.local!)}>
                  [edit]
                </button>
              )}
              {(r.local || keyOk) && (
                <button className="text-dim hover:text-bad" disabled={!!busy} onClick={() => remove(id)}>
                  [delete]
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {busy && (
        <div className="text-[12.5px] text-mute">
          {busy}
          <span className="blink">…</span>
        </div>
      )}
      {msg && <Note kind={msg.kind}>{msg.text}</Note>}

      <Note>
        This browser keeps the letter key and a copy of every letter&apos;s text so it can re-seal them, encrypted under a key derived from your phrase. Without your phrase that copy is
        unreadable; with your phrase and this browser, it is. The copy on chain is sealed and nobody can read it before its date.
      </Note>
    </div>
  );
}
