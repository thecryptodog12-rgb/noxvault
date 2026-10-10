"use client";
// A co-signer or recovery holder makes a code (their tree root) for someone else's new vault.
// The code is public: it lets the owner put the tree in the vault config, nothing more.
// Each vault must get a FRESH code: a tree that serves two vaults could sign two messages per key.
import { useState } from "react";
import Link from "next/link";
import { RECOVERY_TREE, findVaultsFor, newMasterSecret, secretToWords } from "@nox/sdk/client";
import { Copy, Label, Note, PageHead, Panel } from "@/components/ui";
import SecretInput from "@/components/SecretInput";
import TreeProgress from "@/components/vault/TreeProgress";
import { useNox } from "@/lib/hooks";
import { getSigner } from "@/lib/trees";
import { errMsg, hex } from "@/lib/format";

type Role = "cosigner" | "recovery";
const usedKey = (role: Role, rootHex: string) => `nox3.code.given.${role}.${rootHex}`;

export default function Cosign() {
  const { program } = useNox();
  const [role, setRole] = useState<Role>("cosigner");
  const [master, setMaster] = useState<Uint8Array | null>(null);
  const [newWords, setNewWords] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [res, setRes] = useState<{ code: string; n: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async (m: Uint8Array) => {
    setMaster(m);
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      const slot = role === "recovery" ? RECOVERY_TREE : 0;
      // The first vault number whose tree is in no vault yet and was not handed out from this browser.
      for (let n = 0; n < 64; n++) {
        const s = await getSigner(m, n, slot, (done, total) => setProgress({ done, total }));
        const code = hex(s.pub.root);
        let given = false;
        try {
          given = localStorage.getItem(usedKey(role, code)) !== null;
        } catch {}
        if (given) continue;
        const used = await findVaultsFor(program, s);
        if (used.length) continue;
        setRes({ code, n });
        try {
          localStorage.setItem(usedKey(role, code), String(Date.now()));
        } catch {}
        return;
      }
      throw new Error("No free vault number found");
    } catch (e) {
      setErr(`${errMsg(e)}. Finding a fresh code needs an RPC that allows getProgramAccounts.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="codes"
        title={
          <>
            Co-signer &amp; recovery <span className="inv">codes</span>
          </>
        }
        sub="Someone is creating a vault and wants you as a co-signer or as their recovery key. Make a code from your own phrase and send it to them. The code is public; your phrase never leaves this tab. A code is for one vault only — never reuse it."
      />
      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
        <Panel title="make a code">
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0">
              {(
                [
                  ["cosigner", "Co-signer", "256 keys · approves actions with the owner"],
                  ["recovery", "Recovery key", "16 keys · can cancel; takes over after inactivity"],
                ] as const
              ).map(([r, t, d]) => (
                <button
                  key={r}
                  onClick={() => (setRole(r), setRes(null))}
                  className={`rounded-md border px-3 py-2.5 text-left ${role === r ? "border-teal bg-teal/[0.06]" : "border-line-2"}`}
                >
                  <div className={`text-[12.5px] ${role === r ? "text-teal" : ""}`}>{t}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{d}</div>
                </button>
              ))}
            </div>
            {!newWords ? (
              <button className="self-start text-[11px] uppercase tracking-[0.14em] text-dim hover:text-teal" onClick={() => setNewWords(secretToWords(newMasterSecret()))}>
                [no phrase yet? make a new one]
              </button>
            ) : (
              <Note kind="warn">
                New phrase (write it down, it is not stored): <span className="text-bone">{newWords}</span>
              </Note>
            )}
            <SecretInput cta={busy ? "working…" : "make code"} onSecret={(m) => make(m)} />
            {progress && <TreeProgress label={role === "recovery" ? "recovery tree" : "signer tree"} done={progress.done} total={progress.total} />}
            {err && <Note kind="bad">{err}</Note>}
          </div>
        </Panel>
        <Panel title="your code" lit={!!res}>
          <div className="flex flex-col gap-3 p-4 sm:p-5 text-[12.5px]">
            {!res ? (
              <p className="text-mute">{master && busy ? "Finding a fresh vault number…" : "Your code appears here."}</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <Label>{role === "recovery" ? "recovery code" : "co-signer code"}</Label>
                  <Copy value={res.code} />
                </div>
                <div className="break-all rounded-md border border-line-2 bg-ink px-3 py-2.5 font-mono">{res.code}</div>
                <Note>
                  Send this code to the vault owner. Remember <strong>vault number {res.n}</strong>: you will need it with your phrase to act on
                  that vault ({role === "recovery" ? <Link href="/recovery" className="underline">recovery</Link> : <Link href="/mine" className="underline">my vaults</Link>}{" "}
                  finds it by itself when your RPC allows searching).
                </Note>
                <Note kind="warn">
                  <strong>A code is for one vault only — never reuse it.</strong> If the same tree served two vaults, one key could end up
                  signing two different messages. This page never offers a code that is already in a vault or was already shown here.
                </Note>
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
