"use client";
import { useState } from "react";
import Link from "next/link";
import { newMasterSecret, secretToWords } from "@nox/sdk/client";
import { Label, Note, PageHead, Panel } from "@/components/ui";
import SetupVault from "./SetupVault";
import SecretInput from "@/components/SecretInput";
import { NETWORK } from "@/lib/config";

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
        sub="Make a 24-word phrase in this browser, choose the vault rules, then fund its address from any wallet or exchange."
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

          {stage === "ready" && master && <SetupVault master={master} words={words} onForget={reset} />}
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title="what happens" className="text-[12.5px]">
            <ol className="flex flex-col gap-3 p-4 text-mute">
              <li>
                <span className="text-teal">01</span> The words become 256 one-time keys in a Merkle tree. Its root, plus your
                settings, fixes the vault address forever.
              </li>
              <li>
                <span className="text-teal">02</span> Optional: a recovery key held by someone else, a whitelist, and a delay for
                withdrawals to other addresses.
              </li>
              <li>
                <span className="text-teal">03</span> Fund the address from any wallet or exchange. It is initialized by your
                wallet, or by the relayer once it holds 0.02 SOL.
              </li>
              <li>
                <span className="text-teal">04</span> Each later action (withdraw, stake, ping…) uses one key. Your wallet never
                gets power over the vault.
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

