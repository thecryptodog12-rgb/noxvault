"use client";
import { useEffect, useState } from "react";
import { wordsToSecret } from "@nox/sdk/client";
import { loadWords } from "@/lib/secret";
import { errMsg } from "@/lib/format";

/** Textarea for 24 words. Calls onSecret with the 32-byte master once valid. */
export default function SecretInput({
  onSecret,
  cta = "unlock words",
}: {
  onSecret: (master: Uint8Array, words: string) => void;
  cta?: string;
}) {
  const [words, setWords] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [stored, setStored] = useState<string | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const s = loadWords();
    if (s) setStored(s.where === "session" ? "this tab's session" : "this browser (local storage)");
  }, []);

  const count = words.trim() ? words.trim().split(/\s+/).length : 0;

  const go = (w = words) => {
    try {
      const m = wordsToSecret(w);
      setErr(null);
      onSecret(m, w.trim().toLowerCase().split(/\s+/).join(" "));
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {stored && (
        <div className="flex flex-wrap items-center justify-between gap-2 border border-teal-dim bg-teal/[0.05] px-3 py-2 text-[12px]">
          <span className="text-mute">
            Words remembered in <span className="text-bone">{stored}</span>.
          </span>
          <button
            className="btn sm"
            onClick={() => {
              const s = loadWords();
              if (s) go(s.words);
            }}
          >
            use them
          </button>
        </div>
      )}
      <div className="relative">
        <textarea
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="word1 word2 word3 … word24"
          rows={4}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="field resize-none leading-relaxed"
          style={hidden ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-[11px] text-dim">
          <span className={count === 24 ? "text-teal" : ""}>{count}/24 words</span>
          <button type="button" className="uppercase tracking-[0.18em] hover:text-teal" onClick={() => setHidden((h) => !h)}>
            [{hidden ? "show" : "hide"}]
          </button>
        </div>
        <button className="btn" onClick={() => go()} disabled={count === 0}>
          {cta}
        </button>
      </div>
      {err && <div className="text-[12px] text-bad">✕ {err}</div>}
      <p className="text-[11px] text-dim">The words are turned into keys inside this tab. They are never sent to any server or RPC.</p>
    </div>
  );
}
