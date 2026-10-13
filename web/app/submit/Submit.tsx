"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { RECOVERY_TREE, SOL_MINT, actionDigest, buildSteps, completesApproval, mintTokenProgram, packSteps, remainingSteps, type SignedAction } from "@nox/sdk/client";
import { Copy, Label, Note, PageHead, Panel } from "@/components/ui";
import WalletButton from "@/components/WalletButton";
import { useNox } from "@/lib/hooks";
import { fetchRelayerInfo, relayAction, sendIxs, type RelayerInfo } from "@/lib/unlock";
import { explorerUrl } from "@/lib/config";
import { errMsg, fromBaseUnits, hex, short } from "@/lib/format";
import { PartCollector, SLOT_LABEL, actionMint, checkSigned, parseSubmitInput, prepareLeaves, summarize, type Check } from "@/lib/offline";
import { tokenInfo } from "@/lib/tokens";
import Summary from "../offline/Summary";
import Scanner from "./Scanner";

type Prepared = NonNullable<Awaited<ReturnType<typeof prepareLeaves>>>;

function Prepare() {
  const { program } = useNox();
  const [vault, setVault] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Prepared | null>(null);
  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const v = new PublicKey(vault.trim());
      const [p, r] = await Promise.all([prepareLeaves(program, v), fetchRelayerInfo().catch(() => null)]);
      if (!p) throw new Error("No v3 vault state found for this address on this network.");
      setRes(p);
      setRelayer(r);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now() / 1000;
  return (
    <Panel title="A // prepare an offline action">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <p className="text-[12.5px] text-mute">
          Before signing on your offline device, look up which one-time key to use. This reads only public data: the vault&apos;s
          used-key bitmap and every key that ever appeared in its history.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="field" value={vault} onChange={(e) => setVault(e.target.value)} placeholder="vault address" spellCheck={false} />
          <button className="btn shrink-0" onClick={go} disabled={busy || !vault.trim()}>
            {busy ? "reading…" : "look up"}
          </button>
        </div>
        {err && <div className="text-[12px] text-bad">✕ {err}</div>}
        {res && (
          <>
            <table className="tbl">
              <tbody>
                {res.slots.map((x) => (
                  <tr key={x.slot}>
                    <td className="w-48 text-dim">next leaf · {SLOT_LABEL(x.slot)} (slot {x.slot})</td>
                    <td className={x.slot === 0 ? "text-[15px] font-bold text-teal" : "text-bone"}>{x.next === -1 ? "none left" : `#${x.next}`}</td>
                  </tr>
                ))}
                <tr>
                  <td className="text-dim">rules</td>
                  <td>
                    {res.state.config.threshold} of {res.slots.filter((x) => x.slot < 3).length} signers must approve
                    {res.state.migrateTo ? ` · migrating to ${short(res.state.migrateTo.toBase58())}` : ""}
                  </td>
                </tr>
                <tr>
                  <td className="text-dim">balance</td>
                  <td>{fromBaseUnits(BigInt(res.balance), 9)} SOL</td>
                </tr>
                <tr>
                  <td className="text-dim">actions so far</td>
                  <td>{res.state.actions}</td>
                </tr>
                <tr>
                  <td className="text-dim">pending</td>
                  <td>
                    {res.state.pending
                      ? `${res.state.pending.kind === "migrate" ? "migration: " : ""}${res.state.pending.mint.equals(SOL_MINT) ? fromBaseUnits(res.state.pending.amount, 9) + " SOL" : res.state.pending.amount + " base units"} to ${short(res.state.pending.dest.toBase58())}, executable ${new Date(res.state.pending.executableAt * 1000).toLocaleString()}`
                      : "none"}
                  </td>
                </tr>
                {res.state.config.trees[RECOVERY_TREE].height > 0 && (
                  <tr>
                    <td className="text-dim">recovery full control</td>
                    <td>
                      {res.state.lastActive + Number(res.state.config.recoveryDelay) <= now
                        ? "open now"
                        : `from ${new Date((res.state.lastActive + Number(res.state.config.recoveryDelay)) * 1000).toLocaleString()}`}
                    </td>
                  </tr>
                )}
                {relayer && (
                  <tr>
                    <td className="text-dim">relayer</td>
                    <td className="break-all">
                      fee at least <span className="text-bone">{fromBaseUnits(BigInt(relayer.minFee), 9)} SOL</span> to{" "}
                      <span className="text-bone">{relayer.relayer}</span> <Copy value={relayer.relayer} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {res.slots.some((x) => x.seen.length > 0) && (
              <div className="text-[11.5px] text-dim">
                Keys seen in history (skipped):{" "}
                {res.slots
                  .filter((x) => x.seen.length)
                  .map((x) => `${SLOT_LABEL(x.slot)} ${x.seen.join(", ")}`)
                  .join(" · ")}
              </div>
            )}
            <Note kind="warn">
              Without your words this page cannot tell which messages <em>your</em> key signed. If you ever started an action that
              did not finish, open <Link href="/mine" className="text-teal">/mine</Link> with your words first: an unfinished key can
              only complete its own message.
            </Note>
          </>
        )}
      </div>
    </Panel>
  );
}

const icon = { ok: "✓", warn: "!", bad: "✕" } as const;
const tone = { ok: "text-teal", warn: "text-warn", bad: "text-bad" } as const;

export default function Submit() {
  const { program, connection, deployed, wallet } = useNox();
  const [input, setInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const collector = useRef(new PartCollector());
  const [scanned, setScanned] = useState<{ have: number; n: number; note?: string }>({ have: 0, n: 0 });

  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [decimals, setDecimals] = useState<number | undefined>(undefined);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<string[] | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return { ok: true as const, ...parseSubmitInput(input) };
    } catch (e) {
      return { ok: false as const, err: errMsg(e) };
    }
  }, [input]);
  const signed: SignedAction | null = parsed?.ok ? parsed.signed : null;

  useEffect(() => {
    setChecks(null);
    setSent(null);
    setSendErr(null);
    setDecimals(undefined);
    const mint = signed ? actionMint(signed.action) : null;
    if (!mint) return;
    let live = true;
    tokenInfo(connection, mint).then(async (t) => {
      if (t.known) return live && setDecimals(t.decimals);
      // no metadata: read decimals straight from the mint account
      const r = await connection.getParsedAccountInfo(mint).catch(() => null);
      const d = (r?.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined)?.parsed?.info?.decimals;
      if (live && typeof d === "number") setDecimals(d);
    });
    return () => {
      live = false;
    };
  }, [signed, connection]);

  const summary = signed ? summarize(signed.vault.toBase58(), signed.tree, signed.leaf, signed.action, decimals) : null;
  const digest = signed ? hex(actionDigest(program.programId, signed.vault, signed.tree, signed.leaf, signed.action)) : undefined;

  const onCode = (text: string) => {
    const c = collector.current;
    const r = c.add(text);
    if (r === "bad") {
      if (text.trim().startsWith("{")) {
        setInput(text);
        setScanning(false);
      }
      return;
    }
    if (r === "other") {
      setScanned((s) => ({ ...s, note: "That QR belongs to a different request. Reset to start over." }));
      return;
    }
    if (r === "new") setScanned({ have: c.parts.size, n: c.n });
    if (c.done) {
      try {
        setInput(c.text()!);
      } catch (e) {
        setScanned((s) => ({ ...s, note: errMsg(e) }));
        collector.current = new PartCollector();
      }
      setScanning(false);
    }
  };

  const resetScan = () => {
    collector.current = new PartCollector();
    setScanned({ have: 0, n: 0 });
  };

  const runChecks = async () => {
    if (!signed) return;
    setChecking(true);
    setChecks(null);
    try {
      const { checks } = await checkSigned(program, signed);
      setChecks(checks);
    } catch (e) {
      setChecks([{ level: "bad", text: `Checks failed: ${errMsg(e)}` }]);
    } finally {
      setChecking(false);
    }
  };

  const blocked = !checks || checks.some((c) => c.level === "bad");

  const viaRelayer = async () => {
    if (!signed) return;
    setSending("relayer");
    setSendErr(null);
    try {
      setSent(await relayAction(signed));
    } catch (e) {
      setSendErr(errMsg(e));
    } finally {
      setSending(null);
    }
  };

  const viaWallet = async () => {
    if (!signed || !wallet.publicKey) return;
    setSending("wallet");
    setSendErr(null);
    const sigs: string[] = [];
    try {
      const payer = wallet.publicKey;
      const tokenProgram =
        signed.action.kind === "withdraw" && !new PublicKey(signed.action.mint).equals(SOL_MINT)
          ? await mintTokenProgram(connection, new PublicKey(signed.action.mint))
          : undefined;
      // Execute only when this approval completes the vault's rules; otherwise it only records the approval.
      const status = await completesApproval(program, signed.vault, signed.tree, signed.action);
      const steps = await buildSteps(program, payer, signed, { tokenProgram, execute: status.willExecute, creator: status.creator ?? payer });
      const todo = await remainingSteps(program, payer, signed, steps);
      const txs = packSteps(payer, todo);
      for (let i = 0; i < txs.length; i++) {
        setSending(`wallet ${i + 1}/${txs.length}: ${txs[i].label}`);
        sigs.push(await sendIxs(connection, payer, wallet.sendTransaction, txs[i].instructions));
      }
      setSent(sigs);
    } catch (e) {
      if (sigs.length) setSent(sigs);
      setSendErr(`${errMsg(e)} — every step is safe to retry: press the button again.`);
    } finally {
      setSending(null);
    }
  };

  const feeToRelayer = signed && signed.action.fee > 0n;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="offline // submit"
        title={
          <>
            Submit a <span className="inv">signed</span> action
          </>
        }
        sub={
          <>
            Bring a request signed on <Link href="/offline" className="text-teal">/offline</Link>: paste the text or scan the QR codes.
            The request contains no secret and can only do what it says. This page checks it against the chain before sending.
          </>
        }
      />

      {deployed === false && <Note kind="warn">The Noxvault v3 program is not deployed on this network yet, so checks and sending will fail.</Note>}

      <Prepare />

      <Panel title="B // load the signed request">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <textarea
            className="field h-36 resize-y text-[11px] leading-snug"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"vault":"…","tree":0,"leaf":3,…}  or NOX1:… parts, one per line'
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-3">
            {!scanning ? (
              <button
                className="btn ghost sm"
                onClick={() => {
                  resetScan();
                  setScanning(true);
                }}
              >
                scan QR with camera
              </button>
            ) : (
              <span className="text-[12px] text-mute">
                {scanned.n ? (
                  <>
                    scanned <span className="text-teal">{scanned.have}</span> of {scanned.n} parts
                  </>
                ) : (
                  "point the camera at the first QR…"
                )}
              </span>
            )}
            {input && (
              <button className="btn ghost sm" onClick={() => setInput("")}>
                clear
              </button>
            )}
          </div>
          {scanning && (
            <>
              {scanned.note && <Note kind="warn">{scanned.note}</Note>}
              <div className="max-w-[420px]">
                <Scanner onCode={onCode} onClose={() => setScanning(false)} />
              </div>
            </>
          )}
          {parsed && !parsed.ok && <div className="text-[12px] text-bad">✕ {parsed.err}</div>}
        </div>
      </Panel>

      {signed && summary && (
        <Panel title="C // what this does" lit>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <Summary {...summary} digest={digest} />
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn" onClick={runChecks} disabled={checking}>
                {checking ? "checking…" : checks ? "check again" : "check against the chain"}
              </button>
              <span className="text-[11px] text-dim">root, leaf, balance and the vault&apos;s full history</span>
            </div>
            {checks && (
              <ul className="flex flex-col gap-1.5 text-[12.5px]">
                {checks.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={`w-4 shrink-0 font-bold ${tone[c.level]}`}>{icon[c.level]}</span>
                    <span className={c.level === "ok" ? "text-mute" : tone[c.level]}>{c.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      )}

      {signed && (
        <Panel title="D // send">
          <div className="grid gap-6 p-4 sm:p-5 md:grid-cols-2 [&>*]:min-w-0">
            <div className="flex flex-col gap-3">
              <Label>gasless, via the relayer</Label>
              <p className="text-[12.5px] text-mute">
                The relayer pays network fees and buffer rent and is repaid from the vault by the fee inside the signed action. It
                cannot change the action.
              </p>
              {!feeToRelayer && <Note kind="info">This action carries no fee, so the relayer will most likely refuse it. Use a wallet.</Note>}
              <button className="btn self-start" onClick={viaRelayer} disabled={blocked || !!sending}>
                {sending === "relayer" ? "relaying…" : "send via relayer"}
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <Label>with your own wallet</Label>
              <p className="text-[12.5px] text-mute">
                Your wallet pays network fees and temporary buffer rent (refunded at the end), in a few transactions. It has no
                power over the vault.
                {feeToRelayer && " The signed fee still goes to the fee payee named in the action."}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {wallet.publicKey ? (
                  <button className="btn outline" onClick={viaWallet} disabled={blocked || !!sending}>
                    {sending?.startsWith("wallet") ? sending : "send with wallet"}
                  </button>
                ) : (
                  <WalletButton />
                )}
              </div>
            </div>
            {blocked && (
              <div className="md:col-span-2 text-[11.5px] text-dim">
                {checks ? "Fix the errors above before sending." : "Run the checks first."}
              </div>
            )}
            {sendErr && <div className="md:col-span-2 text-[12px] text-bad">✕ {sendErr}</div>}
            {sent && (
              <div className="md:col-span-2">
                <Note kind="ok">
                  Sent in {sent.length} transaction{sent.length === 1 ? "" : "s"}:{" "}
                  {sent.map((s, i) => (
                    <a key={s} href={explorerUrl(s, "tx")} target="_blank" rel="noreferrer" className="mr-2 text-teal underline">
                      {i + 1}. {short(s, 6)}
                    </a>
                  ))}
                </Note>
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
