"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { newMasterSecret, recordPda, scanVaults, secretToWords, vaultKey, type VaultKey } from "@nox/sdk/client";
import { Copy, Label, Note, PageHead, Panel } from "@/components/ui";
import SecretInput from "@/components/SecretInput";
import { useNox } from "@/lib/hooks";
import { errMsg, fromBaseUnits, hex, sol, toBaseUnits } from "@/lib/format";
import { explorerUrl, NETWORK } from "@/lib/config";
import { forgetWords, loadWords, saveWords, type Remember } from "@/lib/secret";
import { sendIxs } from "@/lib/unlock";

type Stage = "choose" | "show" | "quiz" | "ready";

function pick3(): number[] {
  const s = new Set<number>();
  const r = new Uint32Array(8);
  while (s.size < 3) {
    crypto.getRandomValues(r);
    for (const x of r) if (s.size < 3) s.add(x % 24);
  }
  return [...s].sort((a, b) => a - b);
}

export default function CreateVault() {
  const [mode, setMode] = useState<"new" | "import">("new");
  const [stage, setStage] = useState<Stage>("choose");
  const [master, setMaster] = useState<Uint8Array | null>(null);
  const [words, setWords] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [wrote, setWrote] = useState(false);
  const [quizIdx, setQuizIdx] = useState<number[]>([]);
  const [quiz, setQuiz] = useState<string[]>(["", "", ""]);
  const [quizErr, setQuizErr] = useState(false);

  const generate = () => {
    const m = newMasterSecret();
    setMaster(m);
    setWords(secretToWords(m));
    setRevealed(false);
    setWrote(false);
    setStage("show");
  };

  const reset = () => {
    setMaster(null);
    setWords("");
    setStage("choose");
    setQuiz(["", "", ""]);
    setQuizErr(false);
  };

  const list = words.split(" ");

  return (
    <div>
      <PageHead
        kicker="01 // create vault"
        title={
          <>
            Create a <span className="inv">vault</span>
          </>
        }
        sub="Make a 24-word secret in this browser, see the address of your next fresh vault, then fund it from any wallet."
      />

      <div className="grid [&>*]:min-w-0 gap-6 xl:grid-cols-[1.25fr_1fr]">
        <div className="flex flex-col gap-6">
          {stage !== "ready" && (
            <Panel title="step 1 // your secret">
              <div className="flex border-b border-line">
                {(["new", "import"] as const).map((m) => (
                  <button
                    key={m}
                    className={`flex-1 px-4 py-2.5 text-[11px] uppercase tracking-[0.18em] ${
                      mode === m ? "bg-ink-3 text-teal" : "text-dim hover:text-bone"
                    }`}
                    onClick={() => {
                      setMode(m);
                      reset();
                    }}
                  >
                    {m === "new" ? "new secret" : "import words"}
                  </button>
                ))}
              </div>
              <div className="p-4 sm:p-5">
                {mode === "import" ? (
                  <SecretInput
                    cta="use these words"
                    onSecret={(m, w) => {
                      setMaster(m);
                      setWords(w);
                      setStage("ready");
                    }}
                  />
                ) : stage === "choose" ? (
                  <div className="flex flex-col items-start gap-4">
                    <p className="text-[13px] text-mute">
                      Your browser draws 32 random bytes with <code className="text-bone">crypto.getRandomValues</code> and shows
                      them as 24 BIP39 words. Every vault you will ever have comes from these words. Lose them and the funds are
                      gone. Nobody can reset them.
                    </p>
                    <button className="btn" onClick={generate}>
                      generate 24 words
                    </button>
                  </div>
                ) : stage === "show" ? (
                  <div className="flex flex-col gap-4">
                    <Note kind="warn">Write these on paper, in order. Do not screenshot, do not paste them into chats or cloud notes.</Note>
                    <div className="relative">
                      <ol
                        className={`grid [&>*]:min-w-0 grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 md:grid-cols-4 ${
                          revealed ? "" : "select-none blur-[6px]"
                        }`}
                      >
                        {list.map((w, i) => (
                          <li key={i} className="flex items-baseline gap-2 bg-ink-2 px-3 py-2 text-[13px]">
                            <span className="w-5 text-right text-[10px] text-dim">{i + 1}</span>
                            <span>{w}</span>
                          </li>
                        ))}
                      </ol>
                      {!revealed && (
                        <button className="absolute inset-0 m-auto h-fit w-fit btn" onClick={() => setRevealed(true)}>
                          reveal words
                        </button>
                      )}
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 text-[13px]">
                      <input
                        type="checkbox"
                        checked={wrote}
                        onChange={(e) => setWrote(e.target.checked)}
                        className="mt-1 accent-[#2ee6d6]"
                        disabled={!revealed}
                      />
                      <span>I wrote these 24 words down, in order, somewhere offline.</span>
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <button
                        className="btn"
                        disabled={!wrote}
                        onClick={() => {
                          setQuizIdx(pick3());
                          setQuiz(["", "", ""]);
                          setQuizErr(false);
                          setStage("quiz");
                        }}
                      >
                        check my copy →
                      </button>
                      <button className="btn ghost" onClick={generate}>
                        new words
                      </button>
                    </div>
                  </div>
                ) : (
                  <form
                    className="flex flex-col gap-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const ok = quizIdx.every((ix, k) => quiz[k].trim().toLowerCase() === list[ix]);
                      setQuizErr(!ok);
                      if (ok) setStage("ready");
                    }}
                  >
                    <p className="text-[13px] text-mute">From your paper copy, type these three words.</p>
                    <div className="grid [&>*]:min-w-0 gap-3 sm:grid-cols-3">
                      {quizIdx.map((ix, k) => (
                        <label key={ix} className="flex flex-col gap-1.5">
                          <Label>word #{ix + 1}</Label>
                          <input
                            className="field"
                            value={quiz[k]}
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            onChange={(e) => setQuiz((q) => q.map((v, i) => (i === k ? e.target.value : v)))}
                          />
                        </label>
                      ))}
                    </div>
                    {quizErr && <div className="text-[12px] text-bad">✕ That does not match. Check your copy.</div>}
                    <div className="flex flex-wrap gap-3">
                      <button className="btn" type="submit">
                        confirm
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setStage("show")}>
                        ← back to words
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </Panel>
          )}

          {stage === "ready" && master && <ReadyVault master={master} words={words} onForget={reset} />}
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title="what happens" className="text-[12.5px]">
            <ol className="flex flex-col gap-3 p-4 text-mute">
              <li>
                <span className="text-teal">01</span> The words become a master secret. Vault <em>i</em> is the i-th WOTS+ key
                derived from it.
              </li>
              <li>
                <span className="text-teal">02</span> The browser checks the chain for vaults you already used and shows the next
                fresh one. A key is never reused.
              </li>
              <li>
                <span className="text-teal">03</span> You send SOL with a plain transfer. Your wallet pays; it gets no power over
                the vault.
              </li>
              <li>
                <span className="text-teal">04</span> Optional: list the vault in the public{" "}
                <Link href="/vaults" className="underline decoration-dotted hover:text-teal">
                  explorer
                </Link>
                . This reveals that the address is a Noxvault, nothing else.
              </li>
            </ol>
          </Panel>
          <Note kind="warn">
            Unaudited software on {NETWORK}. Use test SOL only. Read the <Link href="/risks" className="underline">risks</Link>.
          </Note>
        </aside>
      </div>
    </div>
  );
}

function ReadyVault({ master, words, onForget }: { master: Uint8Array; words: string; onForget: () => void }) {
  const { connection, program, wallet, deployed } = useNox();
  const { setVisible } = useWalletModal();
  const [scan, setScan] = useState<{ nextFresh: number; used: number } | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [remember, setRemember] = useState<Remember>(() => {
    const s = loadWords();
    return s && s.words === words ? s.where : "off";
  });
  const [balance, setBalance] = useState<number | null>(null);
  const [rentMin, setRentMin] = useState<number>(890_880);
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string; sig?: string } | null>(null);
  const [ack, setAck] = useState(false);
  const [registered, setRegistered] = useState<boolean | null>(null);

  const key: VaultKey | null = useMemo(() => (scan ? vaultKey(master, scan.nextFresh, program.programId) : null), [scan, master, program]);

  useEffect(() => {
    let live = true;
    scanVaults(program, master)
      .then((r) => live && setScan({ nextFresh: r.nextFresh, used: r.vaults.length }))
      .catch((e) => {
        if (!live) return;
        setScanErr(errMsg(e));
        setScan({ nextFresh: 0, used: 0 });
      });
    connection.getMinimumBalanceForRentExemption(0).then((v) => live && setRentMin(v)).catch(() => {});
    return () => {
      live = false;
    };
  }, [program, master, connection]);

  const refresh = async () => {
    if (!key) return;
    try {
      setBalance(await connection.getBalance(key.vault));
      setRegistered(!!(await connection.getAccountInfo(recordPda(key.vault, program.programId))));
    } catch {
      setBalance(null);
    }
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (remember === "off") forgetWords();
    else saveWords(words, remember);
  }, [remember, words]);

  const canDeposit = deployed || ack;

  const deposit = async () => {
    if (!key || !wallet.publicKey) return;
    setMsg(null);
    try {
      const lamports = toBaseUnits(amount, 9);
      if (lamports <= 0n) throw new Error("Amount must be above zero");
      if ((balance ?? 0) === 0 && lamports < BigInt(rentMin))
        throw new Error(`A new vault needs at least ${sol(rentMin, 6)} SOL (the rent minimum for an empty account)`);
      setBusy("deposit");
      const sig = await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [
        SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: key.vault, lamports: Number(lamports) }),
      ]);
      setMsg({ kind: "ok", text: `Deposited ${amount} SOL.`, sig });
      refresh();
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  const register = async () => {
    if (!key || !wallet.publicKey) return;
    setMsg(null);
    setBusy("register");
    try {
      const ix = await program.methods
        .register(Array.from(key.root))
        .accountsPartial({ payer: wallet.publicKey, vault: key.vault, record: recordPda(key.vault, program.programId) })
        .instruction();
      const sig = await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [ix]);
      setMsg({ kind: "ok", text: "Vault listed in the explorer.", sig });
      setRegistered(true);
    } catch (e) {
      // "already in use": someone (maybe you) listed this vault already, which is the goal
      if (/already in use/i.test(errMsg(e) + JSON.stringify((e as { logs?: string[] })?.logs ?? []))) {
        setMsg({ kind: "ok", text: "This vault is already listed in the explorer." });
        setRegistered(true);
        return;
      }
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Panel lit title="step 2 // your next fresh vault" right={<span className="text-[10px] uppercase tracking-[0.18em] text-teal">sealed</span>}>
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {!scan ? (
            <div className="text-[13px] text-mute">
              scanning your vaults<span className="blink">…</span>
            </div>
          ) : (
            <>
              <div className="grid [&>*]:min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <Label>index</Label>
                  <div className="font-display mt-1 text-[22px]">#{scan.nextFresh}</div>
                </div>
                <div>
                  <Label>vaults used</Label>
                  <div className="font-display mt-1 text-[22px]">{scan.used}</div>
                </div>
                <div>
                  <Label>balance</Label>
                  <div className="font-display mt-1 text-[22px]">{balance === null ? "—" : sol(balance)}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>vault address</Label>
                  {key && <Copy value={key.vault.toBase58()} />}
                </div>
                <a
                  href={key ? explorerUrl(key.vault.toBase58()) : "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all border border-line bg-ink px-3 py-2 text-[13px] hover:border-teal-dim"
                >
                  {key?.vault.toBase58()}
                </a>
              </div>
              <div>
                <Label>root (sha-256 of the 34 chain ends)</Label>
                <div className="mt-1 break-all text-[11.5px] text-dim">{key && hex(key.root)}</div>
              </div>
              {scanErr && <Note kind="warn">Could not scan the chain ({scanErr}). Showing index 0; check again before funding.</Note>}
              {scan.used > 0 && (
                <Note>
                  These words already have {scan.used} vault{scan.used > 1 ? "s" : ""}. Manage them in{" "}
                  <Link href="/mine" className="underline">
                    my vaults
                  </Link>
                  .
                </Note>
              )}
            </>
          )}
        </div>
      </Panel>

      <Panel title="remember in this browser?">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="grid [&>*]:min-w-0 gap-2 sm:grid-cols-3">
            {(
              [
                ["off", "don't remember", "gone when you close the page"],
                ["session", "this tab only", "sessionStorage, cleared when the tab closes"],
                ["local", "keep on this device", "localStorage, stays until you forget it"],
              ] as const
            ).map(([v, t, s]) => (
              <button
                key={v}
                onClick={() => setRemember(v)}
                className={`border px-3 py-2.5 text-left ${remember === v ? "border-teal bg-teal/[0.06]" : "border-line hover:border-line-2"}`}
              >
                <div className={`text-[12px] ${remember === v ? "text-teal" : ""}`}>{t}</div>
                <div className="mt-0.5 text-[11px] text-dim">{s}</div>
              </button>
            ))}
          </div>
          {remember !== "off" && (
            <Note kind="warn">
              The words are stored unencrypted in this browser. Any script or extension that can read this site&apos;s storage can
              take every vault. Only do this on a device you trust{remember === "local" ? ", and press forget when done" : ""}.
            </Note>
          )}
        </div>
      </Panel>

      <Panel title="step 3 // fund it">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {deployed === false && (
            <div className="flex flex-col gap-2">
              <Note kind="warn">
                The Noxvault program is not deployed on {NETWORK} yet. SOL sent now sits at this address until it is; nobody can
                withdraw it before then.
              </Note>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-mute">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-[#2ee6d6]" />I
                understand, let me deposit anyway
              </label>
            </div>
          )}
          {!wallet.publicKey ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-mute">Connect a wallet to send the deposit.</span>
              <button className="btn" onClick={() => setVisible(true)}>
                connect wallet
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <input
                    className="field pr-14"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-label="Amount in SOL"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-dim">SOL</span>
                </div>
                <button className="btn" onClick={deposit} disabled={!key || !!busy || !canDeposit}>
                  {busy === "deposit" ? "sending…" : "deposit sol"}
                </button>
              </div>
              <p className="text-[11px] text-dim">
                A plain SystemProgram transfer from your wallet. First deposit must be ≥ {sol(rentMin, 6)} SOL (rent minimum).
              </p>
              <TokenDeposit vault={key?.vault ?? null} disabled={!canDeposit} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-line pt-4">
                <div className="text-[12px] text-mute">
                  {registered ? (
                    <span className="text-teal">✓ listed in the explorer</span>
                  ) : (
                    <>List this vault in the public explorer (optional, costs a little rent).</>
                  )}
                </div>
                {!registered && (
                  <button className="btn ghost sm" onClick={register} disabled={!key || !!busy || !deployed}>
                    {busy === "register" ? "sending…" : "register(root)"}
                  </button>
                )}
              </div>
            </>
          )}
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
        </div>
      </Panel>

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
          forget secret
        </button>
      </div>
    </>
  );
}

function TokenDeposit({ vault, disabled }: { vault: PublicKey | null; disabled: boolean }) {
  const { connection, wallet } = useNox();
  const [open, setOpen] = useState(false);
  const [mint, setMint] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ kind: "ok" | "bad"; text: string; sig?: string } | null>(null);

  const send = async () => {
    if (!vault || !wallet.publicKey) return;
    setRes(null);
    setBusy(true);
    try {
      const mintPk = new PublicKey(mint.trim());
      const info = await connection.getAccountInfo(mintPk);
      if (!info) throw new Error("Mint not found");
      const tokenProgram = info.owner;
      const m = await getMint(connection, mintPk, "confirmed", tokenProgram);
      const units = toBaseUnits(amount, m.decimals);
      const from = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, false, tokenProgram);
      const to = getAssociatedTokenAddressSync(mintPk, vault, true, tokenProgram);
      const sig = await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [
        createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, to, vault, mintPk, tokenProgram),
        createTransferCheckedInstruction(from, mintPk, to, wallet.publicKey, units, m.decimals, [], tokenProgram),
      ]);
      setRes({ kind: "ok", text: `Sent ${fromBaseUnits(units, m.decimals)} tokens to the vault.`, sig });
    } catch (e) {
      setRes({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button className="self-start text-[11px] uppercase tracking-[0.18em] text-dim hover:text-teal" onClick={() => setOpen(true)}>
        [+ deposit an spl token instead]
      </button>
    );
  return (
    <div className="flex flex-col gap-2 border border-dashed border-line p-3">
      <Label>spl / token-2022 deposit</Label>
      <input className="field" placeholder="mint address" value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" placeholder="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="btn" onClick={send} disabled={busy || disabled || !mint || !amount}>
          {busy ? "sending…" : "deposit token"}
        </button>
      </div>
      <p className="text-[11px] text-dim">Creates the vault&apos;s token account (owner = vault) if needed, then transfers.</p>
      {res && (
        <Note kind={res.kind}>
          {res.text}{" "}
          {res.sig && (
            <a className="underline" href={explorerUrl(res.sig, "tx")} target="_blank" rel="noreferrer">
              view tx
            </a>
          )}
        </Note>
      )}
    </div>
  );
}
