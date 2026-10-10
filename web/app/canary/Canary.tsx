"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Radar } from "lucide-react";
import { CANARY_ADDRESS, canaryPda, fetchCanary, raiseBaselineIx, tripCanaryIx, type CanaryView } from "@nox/sdk/client";
import { Label, Note, PageHead, Panel } from "@/components/ui";
import WalletButton from "@/components/WalletButton";
import { useMounted, useNox } from "@/lib/hooks";
import { dateTime } from "@/lib/time";
import { errMsg, sol, toBaseUnits } from "@/lib/format";
import { CANARY_DOMAIN, deriveCanary, walletSend } from "@/lib/escape";
import { Addr, Pill, Result, Row, type ResultMsg } from "../escape/parts";

export default function Canary() {
  const { connection, program, wallet } = useNox();
  const mounted = useMounted();
  const [c, setC] = useState<CanaryView | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [derived, setDerived] = useState<ReturnType<typeof deriveCanary> | null>(null);
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [fundRes, setFundRes] = useState<ResultMsg | null>(null);
  const [tripRes, setTripRes] = useState<ResultMsg | null>(null);

  const refresh = useCallback(async () => {
    try {
      setC(await fetchCanary(program));
      setErr(null);
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [program]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fund = async () => {
    setBusy("fund");
    setFundRes(null);
    try {
      const lamports = toBaseUnits(amount, 9);
      if (lamports <= 0n) throw new Error("Enter an amount");
      const sig = await walletSend(connection, wallet, [
        SystemProgram.transfer({ fromPubkey: wallet.publicKey!, toPubkey: CANARY_ADDRESS, lamports }),
        await raiseBaselineIx(program),
      ]);
      setFundRes({ kind: "ok", text: `Added ${amount} SOL to the bounty and raised the baseline.`, sigs: [sig] });
    } catch (e) {
      setFundRes({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const check = async () => {
    setBusy("trip");
    setTripRes(null);
    try {
      const fresh = await fetchCanary(program);
      if (!fresh) throw new Error("The canary is not initialized on this cluster.");
      if (fresh.tripped) {
        setTripRes({ kind: "bad", text: `Already tripped on ${dateTime(fresh.trippedAt)}.` });
        return;
      }
      const ix = await tripCanaryIx(program);
      if (!wallet.publicKey) {
        // No wallet to simulate with: compare balance and baseline directly.
        setTripRes(
          BigInt(fresh.balance) < fresh.baseline
            ? { kind: "bad", text: "The bounty is below its baseline: the canary can be tripped. Connect a wallet to trip it." }
            : { kind: "ok", text: `Intact. The bounty (${sol(fresh.balance)} SOL) has not moved below its baseline.` }
        );
        return;
      }
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
      const sim = await connection.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
      if (sim.value.err) {
        const logs = (sim.value.logs ?? []).join("\n");
        if (/NotTriggered/.test(logs)) setTripRes({ kind: "ok", text: `Intact. trip_canary refuses: the bounty (${sol(fresh.balance)} SOL) is not below its baseline (${sol(fresh.baseline)} SOL).` });
        else setTripRes({ kind: "warn", text: `Simulation failed: ${JSON.stringify(sim.value.err)}` });
        return;
      }
      const sig = await walletSend(connection, wallet, [ix]);
      setTripRes({ kind: "bad", text: "Tripped. The bounty moved: ed25519 can no longer be trusted. Keepers will now evacuate every linked wallet.", sigs: [sig] });
    } catch (e) {
      setTripRes({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="quantum canary // on-chain"
        title={
          <>
            The quantum <span className="inv">canary</span>
          </>
        }
        sub="A bounty sits on an ordinary ed25519 address whose private key nobody knows. The only way to move it is to break ed25519. If it ever moves, the canary trips and keepers evacuate every wallet linked through the Escape Hatch."
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] [&>*]:min-w-0">
        <Panel title={<span className="flex items-center gap-2"><Radar size={13} /> status</span>} lit right={c ? c.tripped ? <Pill kind="bad">tripped</Pill> : <Pill kind="ok">intact</Pill> : undefined}>
          <div className="p-4 sm:p-5">
            {err && <Note kind="bad">Could not read the canary: {err}</Note>}
            {c === undefined && !err && <div className="text-[12.5px] text-dim">loading…</div>}
            {c === null && <Note kind="warn">The canary is not initialized on this cluster yet.</Note>}
            {c && (
              <>
                <div className="mb-4 flex items-baseline gap-3">
                  <span className="font-display text-[40px] leading-none text-teal">{sol(c.balance)}</span>
                  <span className="text-mute">SOL bounty</span>
                </div>
                <Row k="watched address">
                  <Addr value={CANARY_ADDRESS.toBase58()} full />
                </Row>
                <Row k="baseline">{sol(c.baseline)} SOL</Row>
                <Row k="balance">{sol(c.balance)} SOL {BigInt(c.balance) < c.baseline && <span className="text-bad">(below baseline!)</span>}</Row>
                <Row k="tripped">{c.tripped ? <span className="text-bad">yes, {dateTime(c.trippedAt)}</span> : "no"}</Row>
                <Row k="canary account" mono>
                  <Addr value={canaryPda(program.programId).toBase58()} />
                </Row>
              </>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn outline" onClick={check} disabled={!!busy || !c}>
                {busy === "trip" ? "checking…" : "check / trip"}
              </button>
              <span className="text-[11.5px] text-dim">Anyone may call trip_canary. It only succeeds once the bounty has moved.</span>
            </div>
            <div className="mt-3">
              <Result r={tripRes} />
            </div>
          </div>
        </Panel>

        <Panel title="how it works">
          <div className="flex flex-col gap-3 p-4 text-[12.5px] text-mute sm:p-5">
            <p>
              <code className="text-teal">trip_canary</code> is permissionless and succeeds only when the watched balance is below the
              recorded <strong className="text-bone">baseline</strong>. Topping the bounty up raises the baseline
              (<code className="text-teal">raise_baseline</code>), never lowers it.
            </p>
            <p>
              Once tripped: <code className="text-teal">escape_token</code> works for every linked wallet without panic, keepers
              broadcast every stored SOL escape, and links can no longer be changed.
            </p>
            <p>
              Honest limits: whoever breaks ed25519 first might not touch this bounty, and an attacker who breaks one wallet key does
              not need to. The canary is a public alarm, not a guarantee. Panic on <Link href="/escape" className="text-teal">/escape</Link> does
              not wait for it.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="derivation · nobody holds this key">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <p className="text-[12.5px] text-mute">
            The address is a hash, not a generated key pair. Hash a fixed string with a counter until the result is a valid point on the
            ed25519 curve. A point found this way has no known private key: finding one would mean solving the discrete log problem.
          </p>
          <pre className="overflow-x-auto rounded border border-line bg-ink-2 p-3 text-[12px] text-bone">
{`P(i)   = SHA256("${CANARY_DOMAIN}" || u32le(i))
canary = P(i) for the first i where P(i) decodes to an ed25519 point
       → i = 0`}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn ghost" onClick={() => setDerived(deriveCanary())}>
              recompute in this browser
            </button>
            {derived && (derived.address.equals(CANARY_ADDRESS) ? <Pill kind="ok">matches</Pill> : <Pill kind="bad">does not match</Pill>)}
          </div>
          {derived && (
            <div className="rounded border border-line p-3">
              {derived.tries.map((t) => (
                <Row key={t.i} k={`i = ${t.i}`} mono>
                  <span className="break-all">{t.hex}</span> <span className={t.onCurve ? "text-teal" : "text-warn"}>{t.onCurve ? "on curve" : "not on curve"}</span>
                </Row>
              ))}
              <Row k="base58">
                <span className="break-all text-teal">{derived.address.toBase58()}</span>
              </Row>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="add to the bounty">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <p className="text-[12.5px] text-mute">
            A bigger bounty makes the alarm louder: breaking ed25519 and taking it becomes worth more. What you send here is gone for
            good, because nobody can sign for this address. One transaction sends the SOL and raises the baseline.
          </p>
          {!mounted ? null : !wallet.publicKey ? (
            <WalletButton className="self-start" />
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label className="mb-1.5">amount (SOL)</Label>
                <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <button className="btn shrink-0" disabled={!!busy || !c || c.tripped} onClick={fund}>
                {busy === "fund" ? "sending…" : "send + raise baseline"}
              </button>
            </div>
          )}
          {c && c.balance === 0 && <div className="text-[11.5px] text-dim">An empty address needs at least ~0.00089 SOL (rent minimum) on its first deposit.</div>}
          <Result r={fundRes} />
        </div>
      </Panel>
    </div>
  );
}
