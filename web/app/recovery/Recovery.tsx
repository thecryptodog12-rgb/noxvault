"use client";
import { useEffect, useState, type FormEvent } from "react";
import { PublicKey } from "@solana/web3.js";
import { RECOVERY_TREE, fetchState, withRetry, wordsToSecret, type Signer, type VaultStateView } from "@nox/sdk/client";
import { equal } from "@nox/sdk/wots";
import { Label, Note, PageHead, Panel } from "@/components/ui";
import TreeProgress from "@/components/vault/TreeProgress";
import VaultView from "@/components/vault/VaultView";
import { useNox } from "@/lib/hooks";
import { getSigner } from "@/lib/trees";
import { errMsg, short } from "@/lib/format";

export default function Recovery() {
  const { program } = useNox();
  const [words, setWords] = useState("");
  const [hidden, setHidden] = useState(true);
  const [addr, setAddr] = useState("");
  const [n, setN] = useState("0");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ vault: PublicKey; state: VaultStateView; signer: Signer } | null>(null);
  const [fromAlert, setFromAlert] = useState(false);

  // /recovery?vault=<address>: opened from an alert about a pending withdrawal
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("vault");
    if (v) {
      setAddr((a) => a || v);
      setFromAlert(true);
    }
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      const master = wordsToSecret(words);
      let vault: PublicKey;
      try {
        vault = new PublicKey(addr.trim());
      } catch {
        throw new Error("The vault address is not valid");
      }
      const num = Number(n);
      if (!Number.isInteger(num) || num < 0) throw new Error("Vault number must be 0 or more");
      const state = await withRetry(() => fetchState(program, vault));
      if (!state) throw new Error("No initialized Noxvault at this address");
      if (state.config.trees[RECOVERY_TREE].height === 0) throw new Error("This vault has no recovery key");
      const signer = await getSigner(master, num, RECOVERY_TREE, (done, total) => setProgress({ done, total }));
      if (!equal(state.config.trees[RECOVERY_TREE].root, signer.pub.root))
        throw new Error(`This phrase (vault number ${num}) is not the recovery key of ${short(vault.toBase58(), 4)}. Try another vault number.`);
      setRes({ vault, state, signer });
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="recovery"
        title={
          <>
            Recovery <span className="inv">key</span>
          </>
        }
        sub="Hold someone's recovery phrase? You can cancel a suspicious pending withdrawal at any time, and freeze the vault so whoever started it cannot simply try again. After the owner has been inactive for the vault's recovery delay, you get full control."
      />

      {fromAlert && !res && (
        <Note kind="warn">
          Not your withdrawal? Enter the recovery phrase below, open the vault and choose &quot;Cancel + freeze&quot; (14 days by default): it cancels the
          payout and freezes the vault, so a thief holding the main phrase cannot queue the next one. If you did start it, you can ignore the alert.
        </Note>
      )}

      {!res ? (
        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
          <Panel title="recovery phrase + vault">
            <form onSubmit={submit} className="flex flex-col gap-4 p-4 sm:p-5">
              <label className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>recovery phrase (24 words)</Label>
                  <button type="button" className="text-[10.5px] uppercase tracking-[0.14em] text-dim hover:text-teal" onClick={() => setHidden((h) => !h)}>
                    [{hidden ? "show" : "hide"}]
                  </button>
                </div>
                <textarea
                  className="field resize-none"
                  rows={3}
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  style={hidden ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px] [&>*]:min-w-0">
                <label className="flex flex-col gap-1.5">
                  <Label>vault address</Label>
                  <input className="field" value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} placeholder="vault address" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <Label>vault number</Label>
                  <input className="field" value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" />
                </label>
              </div>
              {progress && <TreeProgress label="recovery tree (16 keys)" done={progress.done} total={progress.total} />}
              {err && <div className="text-[12px] text-bad">✕ {err}</div>}
              <button className="btn self-start" type="submit" disabled={busy || !words || !addr}>
                {busy ? "checking…" : "open as recovery"}
              </button>
              <p className="text-[11px] text-dim">The phrase is used only inside this tab and never sent anywhere.</p>
            </form>
          </Panel>
          <Panel title="what a recovery key can do" className="text-[12.5px]">
            <ul className="flex flex-col gap-2 p-4 text-mute">
              <li>
                <span className="text-teal">always</span> — cancel the vault&apos;s pending withdrawal (e.g. one to an unknown address).
              </li>
              <li>
                <span className="text-teal">cancel + freeze</span> — cancel and freeze the vault for 1 to 90 days (14 by default; recommended if the main
                phrase may be stolen). The main phrase alone then moves nothing, and its pings no longer keep your takeover away.
              </li>
              <li>
                <span className="text-teal">escape</span> — during a freeze, the main phrase and this recovery phrase together move everything to a new vault
                at once.
              </li>
              <li>
                <span className="text-teal">after the delay</span> — if the owner did nothing for the configured time, withdraw, stake
                and unstake like the owner.
              </li>
              <li>
                <span className="text-teal">16 keys</span> — a recovery tree has 16 one-time keys, so use them sparingly.
              </li>
            </ul>
          </Panel>
        </div>
      ) : (
        <>
          <Note kind="ok">This phrase is the recovery key of this vault.</Note>
          <VaultView vault={res.vault} initialState={res.state} signer={res.signer} title="RECOVERY VIEW" />
          <button className="btn ghost self-start" onClick={() => setRes(null)}>
            ← another vault
          </button>
        </>
      )}
    </div>
  );
}
