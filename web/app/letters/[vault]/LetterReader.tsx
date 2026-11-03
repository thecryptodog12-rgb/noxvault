"use client";
// Public reader: lists a vault's sealed letters with their opening dates and decrypts those whose
// drand round has passed. Decryption happens in this browser with the drand beacon for that round.
import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { vaultLetters, type LetterView } from "@nox/sdk/client";
import { Copy, Empty, Note, PageHead, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { errMsg } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import { dateTime, duration, useNow } from "@/lib/time";
import { openLetter, timeOfRound, type Opened } from "@/lib/letters";

export default function LetterReader({ vault }: { vault: string }) {
  const { program } = useNox();
  const [letters, setLetters] = useState<LetterView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let key: PublicKey;
    try {
      key = new PublicKey(vault);
    } catch {
      setErr("That is not a valid Solana address.");
      return;
    }
    const load = () =>
      vaultLetters(program, key)
        .then((l) => live && (setLetters(l), setErr(null)))
        .catch((e) => live && setErr(`Letters could not be listed (${errMsg(e)}). The RPC may block getProgramAccounts.`));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [vault, program]);

  return (
    <div className="flex max-w-[1000px] flex-col gap-6">
      <PageHead
        kicker="sealed letters // public"
        title={
          <>
            Sealed <span className="inv">letters</span>
          </>
        }
        sub="Letters this vault's owner sealed to a future date. Before that date nobody can read them. After it, anyone with this page can, unless the letter also asks for a passphrase."
      />
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <a href={explorerUrl(vault)} target="_blank" rel="noreferrer" className="break-all hover:text-teal">
          {vault}
        </a>
        <Copy value={vault} />
      </div>

      {err && <Note kind="bad">{err}</Note>}
      {!letters && !err && <Empty title="reading the chain…" />}
      {letters && !letters.length && (
        <Empty title="no sealed letters">
          This vault has no letters. Owners can write them on <Link href="/letters" className="underline">Sealed letters</Link>.
        </Empty>
      )}
      {letters?.map((l) => <LetterCard key={l.id} l={l} />)}

      <Note>
        While the owner is active, the app moves each letter&apos;s date forward. A date in the past means the owner did not refresh it in time; that does not prove anything
        happened to them.
      </Note>
    </div>
  );
}

function LetterCard({ l }: { l: LetterView }) {
  const now = useNow(5000);
  const opensAt = timeOfRound(l.unlockRound);
  const due = now >= opensAt;
  const [opened, setOpened] = useState<Opened | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setErr(null);
    try {
      const o = await openLetter(l.ciphertext);
      setOpened(o);
      if (o.kind === "text") setText(o.text);
    } catch (e) {
      setErr(/too early|not yet|future/i.test(errMsg(e)) ? "drand has not published this round yet. Try again in a minute." : errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (opened?.kind !== "passphrase") return;
    setBusy(true);
    setErr(null);
    try {
      setText(await opened.open(pass));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={`#${l.id} ${l.label || "(no label)"}`} right={<span className={`text-[11px] ${due ? "text-teal" : "text-mute"}`}>{due ? "open" : "sealed"}</span>}>
      <div className="flex flex-col gap-3 p-4 text-[13px] sm:p-5">
        <div className="text-mute">
          {due ? "Opened" : "Opens"} {dateTime(opensAt)} {!due && <span className="text-dim">(in {duration(opensAt - now)})</span>} · drand round {l.unlockRound.toString()} · last
          sealed {dateTime(l.updatedAt)} · {l.ciphertext.length} bytes
        </div>
        {!l.complete && <Note kind="warn">This letter is only partly written (an update was interrupted), so it cannot be opened.</Note>}
        {due && l.complete && text === null && opened?.kind !== "passphrase" && (
          <button className="btn self-start" disabled={busy} onClick={open}>
            {busy ? "fetching the drand beacon…" : "open letter"}
          </button>
        )}
        {opened?.kind === "passphrase" && text === null && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="field flex-1" type="password" placeholder="this letter also needs a passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
            <button className="btn" disabled={busy || !pass} onClick={unlock}>
              {busy ? "unlocking…" : "unlock"}
            </button>
          </div>
        )}
        {text !== null && <pre className="whitespace-pre-wrap break-words rounded border border-line-2 bg-ink-2 p-4 font-sans text-[14px] leading-7 text-bone">{text}</pre>}
        {err && <Note kind="bad">{err}</Note>}
      </div>
    </Panel>
  );
}
