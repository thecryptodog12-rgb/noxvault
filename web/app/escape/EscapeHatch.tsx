"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { ShieldAlert, Siren } from "lucide-react";
import {
  applyLinkChangeIx,
  buildEscapeSolTx,
  createNonceIxs,
  escapePda,
  escapeTokenIx,
  fetchCanary,
  fetchLink,
  fetchState,
  linkPda,
  registerLinkIx,
  requestLinkChangeIx,
  setEscapeTxIx,
  setPanicIx,
  type CanaryView,
  type LinkView,
  type VaultStateView,
} from "@nox/sdk/client";
import { Label, Note, PageHead, Panel } from "@/components/ui";
import WalletButton from "@/components/WalletButton";
import { useMounted, useNox } from "@/lib/hooks";
import { dateTime, duration, useNow } from "@/lib/time";
import { errMsg, sol } from "@/lib/format";
import {
  approveBatches,
  broadcastEscape,
  escapeTxStatus,
  heldTokens,
  isCovered,
  packIxs,
  walletSend,
  walletSendAll,
  type EscapeTxStatus,
  type HeldToken,
} from "@/lib/escape";
import { Addr, Pill, Result, Row, StepHead, TokenAmount, TokenName, type ResultMsg } from "./parts";

interface Loaded {
  link: LinkView | null;
  linkedState: VaultStateView | null;
  tokens: HeldToken[];
  esc: EscapeTxStatus | null;
  canary: CanaryView | null;
  lamports: number;
}

const parseKey = (s: string): PublicKey | null => {
  try {
    return new PublicKey(s.trim());
  } catch {
    return null;
  }
};

export default function EscapeHatch() {
  const { connection, program, wallet, deployed } = useNox();
  const mounted = useMounted();
  const now = useNow(5000);
  const me = wallet.publicKey;
  const meKey = me?.toBase58() ?? "";

  const [data, setData] = useState<Loaded | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Record<string, ResultMsg | null>>({});
  const say = (k: string, r: ResultMsg | null) => setRes((x) => ({ ...x, [k]: r }));

  const refresh = useCallback(async () => {
    if (!me) return setData(null);
    setLoadErr(null);
    try {
      const [link, tokens, canary, lamports] = await Promise.all([
        fetchLink(program, me),
        heldTokens(connection, me),
        fetchCanary(program).catch(() => null),
        connection.getBalance(me, "confirmed"),
      ]);
      const [linkedState, esc] = link ? await Promise.all([fetchState(program, link.vault), escapeTxStatus(connection, program, link)]) : [null, null];
      setData({ link, linkedState, tokens, esc, canary, lamports });
    } catch (e) {
      setLoadErr(errMsg(e));
    }
  }, [connection, program, me]);

  useEffect(() => {
    void refresh();
  }, [meKey, refresh]);

  /** Runs a wallet flow under a busy label; reports into result slot `slot`. */
  const act = async (slot: string, label: string, fn: () => Promise<ResultMsg>) => {
    setBusy(label);
    say(slot, null);
    try {
      say(slot, await fn());
    } catch (e) {
      say(slot, { kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const link = data?.link ?? null;
  const tokens = useMemo(() => (me ? (data?.tokens ?? []).filter((t) => t.owner.equals(me)) : []), [data, me]);
  const covered = me ? tokens.filter((t) => isCovered(t, me, program.programId)) : [];
  const delegated = me ? tokens.filter((t) => t.delegate?.equals(escapePda(me, program.programId)) && t.delegatedAmount > 0n) : [];
  const tripped = !!data?.canary?.tripped;
  const triggered = !!link?.panic || tripped;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="escape hatch // ed25519 wallets"
        title={
          <>
            Escape <span className="inv">Hatch</span>
          </>
        }
        sub="Your ordinary wallet (Phantom, Solflare…) is one ed25519 key. If that key is ever broken, by a quantum computer or anything else, this gives you the first move: your SOL and tokens are pushed into your Noxvault vault, which no ed25519 key can open."
      />

      <Note kind="warn">
        This protects the moment it is triggered, nothing before. It is a <strong>race</strong> against whoever breaks this
        wallet&apos;s key: the escape moves first only if it is broadcast first. Keep most of your funds in the vault itself and
        treat this as a fire exit for what stays in the wallet.
      </Note>

      {!mounted ? null : !me ? (
        <Panel title="connect" className="p-5">
          <div className="flex flex-col items-start gap-4 p-1">
            <p className="text-[13px] text-mute">Connect the wallet you want to protect. Everything below is signed by that wallet.</p>
            <WalletButton />
          </div>
        </Panel>
      ) : (
        <>
          {deployed === false && <Note kind="bad">The Noxvault program is not deployed on this cluster.</Note>}
          {loadErr && <Note kind="bad">Could not read the chain: {loadErr}</Note>}

          <StatusPanel data={data} now={now} covered={covered.length} total={tokens.length} />

          {/* 1. link */}
          <Panel title={<StepHead n="01" title="link · registry entry" done={!!link} />} lit={!link}>
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <p className="text-[12.5px] text-mute">
                Links this wallet to one Noxvault vault: the only place the Escape Hatch can ever send its funds. The link is also a
                <strong className="text-bone"> timestamped on-chain registry entry</strong>, signed by this wallet while ed25519 is
                still safe, proving that this wallet belongs to that vault. That proof keeps its value after the key falls.
              </p>
              {link ? (
                <LinkDetails
                  link={link}
                  state={data?.linkedState ?? null}
                  now={now}
                  tripped={tripped}
                  busy={busy}
                  onRequest={(v) =>
                    act("link", "request", async () => {
                      const st = await fetchState(program, v);
                      if (!st) throw new Error("That address is not an initialized Noxvault v3 vault.");
                      const sig = await walletSend(connection, wallet, [await requestLinkChangeIx(program, me, v)]);
                      return { kind: "ok", text: "Change requested. It can be applied after 30 days.", sigs: [sig] };
                    })
                  }
                  onApply={() =>
                    act("link", "apply", async () => {
                      const sig = await walletSend(connection, wallet, [await applyLinkChangeIx(program, me)]);
                      return { kind: "ok", text: "The link now points at the new vault. Re-arm the SOL escape.", sigs: [sig] };
                    })
                  }
                />
              ) : (
                <RegisterForm
                  busy={busy}
                  onLink={(v) =>
                    act("link", "link", async () => {
                      const sig = await walletSend(connection, wallet, [await registerLinkIx(program, me, v)]);
                      return { kind: "ok", text: "Linked. This wallet's registry entry is on chain.", sigs: [sig] };
                    })
                  }
                />
              )}
              <Result r={res.link ?? null} />
            </div>
          </Panel>

          {/* 2. tokens */}
          <Panel
            title={<StepHead n="02" title="tokens · delegate" done={!!link && tokens.length > 0 && covered.length === tokens.length} />}
            right={<span className="text-[10.5px] text-dim">{covered.length}/{tokens.length} covered</span>}
          >
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <p className="text-[12.5px] text-mute">
                Each token account approves the Escape Hatch address (<code className="text-teal">PDA[&quot;escape&quot;, wallet]</code>) as
                its delegate. The program lets it move a balance only into your linked vault, and only after you press panic or the
                canary trips. Approving replaces any other delegate on that account. Tokens you receive later need approving again.
              </p>
              {tokens.length === 0 ? (
                <div className="text-[12.5px] text-dim">This wallet holds no tokens (SPL or Token-2022).</div>
              ) : (
                <div className="overflow-x-auto rounded border border-line">
                  <table className="tbl min-w-[520px]">
                    <thead>
                      <tr>
                        <th>token</th>
                        <th>balance</th>
                        <th>program</th>
                        <th>escape</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokens.map((t) => (
                        <tr key={t.address.toBase58()}>
                          <td>
                            <TokenName conn={connection} mint={t.mint.toBase58()} />
                          </td>
                          <td>
                            <TokenAmount conn={connection} mint={t.mint.toBase58()} amount={t.amount} />
                          </td>
                          <td className="text-dim">{t.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : "spl-token"}</td>
                          <td>
                            {isCovered(t, me, program.programId) ? (
                              <Pill kind="ok">covered</Pill>
                            ) : t.delegate ? (
                              <Pill kind="warn">other delegate</Pill>
                            ) : (
                              <Pill kind="dim">not covered</Pill>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tokens.length > covered.length && (
                <ApproveButton
                  disabled={!link || !!busy}
                  count={tokens.length - covered.length}
                  txs={approveBatches(me, tokens, program.programId).length}
                  oneprompt={!!wallet.signAllTransactions}
                  busy={busy === "approve"}
                  onClick={() =>
                    act("tokens", "approve", async () => {
                      const batches = approveBatches(me, tokens, program.programId);
                      const sigs = await walletSendAll(connection, wallet, batches);
                      return { kind: "ok", text: `Approved the Escape Hatch on ${tokens.length - covered.length} account(s).`, sigs };
                    })
                  }
                />
              )}
              {!link && tokens.length > 0 && <div className="text-[11.5px] text-dim">Link a vault first (step 01).</div>}
              <Result r={res.tokens ?? null} />
            </div>
          </Panel>

          {/* 3. SOL */}
          <Panel title={<StepHead n="03" title="sol · pre-signed escape" done={!!data?.esc?.armed} />}>
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <p className="text-[12.5px] text-mute">
                SOL cannot be delegated, so this wallet signs one transaction <strong className="text-bone">in advance</strong> that
                moves all of its SOL into its own vault, and stores it on chain in the link. It uses a{" "}
                <strong className="text-bone">durable nonce</strong> instead of a recent blockhash, so it never expires.
              </p>
              <ul className="flex flex-col gap-1.5 text-[12.5px] text-mute">
                <li>
                  <span className="text-teal">›</span> Anyone can broadcast it, at any time. It can only ever move this wallet&apos;s
                  SOL into this wallet&apos;s own vault; the worst a stranger can do is send it early.
                </li>
                <li>
                  <span className="text-teal">›</span> Using this wallet&apos;s nonce account for anything else, or changing the link,
                  voids it. The status above shows when it needs re-arming.
                </li>
                <li>
                  <span className="text-teal">›</span> Three wallet prompts: create the nonce account (~0.0015 SOL rent, stays yours),
                  sign the escape (sign only, nothing is sent), store it.
                </li>
              </ul>
              <div className="rounded border border-line p-3">
                <Row k="escape tx">
                  {!link ? (
                    <span className="text-dim">link a vault first</span>
                  ) : !data?.esc?.stored ? (
                    <Pill kind="dim">not armed</Pill>
                  ) : data.esc.armed ? (
                    <Pill kind="ok">armed</Pill>
                  ) : (
                    <span className="flex flex-col gap-1">
                      <Pill kind="warn">re-arm needed</Pill>
                      <span className="text-[12px] text-warn">{data.esc.problem}</span>
                    </span>
                  )}
                </Row>
                {data?.esc?.nonce && (
                  <Row k="nonce account" mono>
                    <Addr value={data.esc.nonce.toBase58()} />
                  </Row>
                )}
                <Row k="wallet SOL" mono>
                  {sol(data?.lamports ?? 0)} SOL
                </Row>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn"
                  disabled={!link || !!busy || !wallet.signTransaction}
                  onClick={() =>
                    act("sol", "arm", async () => {
                      if (!link || !wallet.signTransaction) throw new Error("This wallet cannot sign without sending.");
                      // Reuse this wallet's existing nonce account when there is one.
                      let nonce = data?.esc?.nonce ?? null;
                      const sigs: string[] = [];
                      if (nonce && !(await connection.getAccountInfo(nonce, "confirmed"))) nonce = null;
                      if (!nonce) {
                        const kp = Keypair.generate();
                        sigs.push(await walletSend(connection, wallet, await createNonceIxs(connection, me, kp.publicKey), [kp]));
                        nonce = kp.publicKey;
                      }
                      const tx = await buildEscapeSolTx(program, me, link.vault, nonce);
                      const signed = await wallet.signTransaction(tx);
                      if (!signed.verifySignatures()) throw new Error("The wallet returned an unsigned transaction.");
                      const raw = signed.serialize();
                      if (raw.length > 1100) throw new Error("The wallet changed the transaction too much to store it.");
                      sigs.push(await walletSend(connection, wallet, [await setEscapeTxIx(program, me, raw)]));
                      return { kind: "ok", text: "Armed. The escape transaction is stored in your link.", sigs };
                    })
                  }
                >
                  {busy === "arm" ? "arming…" : data?.esc?.stored ? "re-arm SOL escape" : "arm SOL escape"}
                </button>
              </div>
              <Result r={res.sol ?? null} />
            </div>
          </Panel>

          {/* panic */}
          <PanicPanel
            link={link}
            tripped={tripped}
            busy={busy}
            delegated={delegated.length}
            armed={!!data?.esc?.armed}
            result={res.panic ?? null}
            onPanic={(on) =>
              act("panic", on ? "panic" : "unpanic", async () => {
                const sig = await walletSend(connection, wallet, [await setPanicIx(program, me, on)]);
                return on
                  ? { kind: "warn", text: "Panic is on. Anyone (keepers included) may now move your delegated tokens into the vault.", sigs: [sig] }
                  : { kind: "ok", text: "Panic is off. Delegated tokens stay where they are.", sigs: [sig] };
              })
            }
            onEvacuate={() =>
              act("panic", "evacuate", async () => {
                if (!link) throw new Error("No link");
                const sigs: string[] = [];
                const groups = [];
                for (const t of delegated) groups.push([await escapeTokenIx(program, me, link, t.address, t.mint, t.tokenProgram)]);
                // Tokens first: the wallet pays their fees. The SOL escape empties the wallet, so it goes last.
                sigs.push(...(await walletSendAll(connection, wallet, packIxs(me, groups, 3))));
                let solNote = "No armed SOL escape to broadcast.";
                if (link.escapeTx.length && data?.esc?.armed) {
                  sigs.push(await broadcastEscape(connection, link.escapeTx));
                  solNote = "SOL escape broadcast.";
                }
                return { kind: "ok", text: `Moved ${delegated.length} token account(s) into the vault. ${solNote}`, sigs };
              })
            }
            triggered={triggered}
          />
        </>
      )}
    </div>
  );
}

function StatusPanel({ data, now, covered, total }: { data: Loaded | null; now: number; covered: number; total: number }) {
  const l = data?.link;
  const c = data?.canary;
  return (
    <Panel title="status" right={l?.panic ? <Pill kind="bad">panic</Pill> : undefined}>
      <div className="grid gap-x-6 p-4 sm:p-5 md:grid-cols-2">
        <div>
          <Row k="link">
            {!data ? <span className="text-dim">loading…</span> : l ? <Addr value={l.vault.toBase58()} /> : <Pill kind="dim">none</Pill>}
          </Row>
          {l && <Row k="registered">{dateTime(l.createdAt)} · {duration(now - l.createdAt)} ago</Row>}
          {l?.change && <Row k="pending change"><span className="text-warn">→ {l.change.vault.toBase58().slice(0, 8)}… {now >= l.change.at ? "ready" : `in ${duration(l.change.at - now)}`}</span></Row>}
        </div>
        <div>
          <Row k="token delegates">
            {data ? <Pill kind={total === 0 ? "dim" : covered === total ? "ok" : "warn"}>{covered}/{total} covered</Pill> : "…"}
          </Row>
          <Row k="SOL escape">
            {!l ? <Pill kind="dim">—</Pill> : data?.esc?.armed ? <Pill kind="ok">armed</Pill> : data?.esc?.stored ? <Pill kind="warn">re-arm needed</Pill> : <Pill kind="dim">not armed</Pill>}
          </Row>
          <Row k="canary">
            {!c ? (
              <Pill kind="dim">not initialized</Pill>
            ) : c.tripped ? (
              <Pill kind="bad">tripped {dateTime(c.trippedAt)}</Pill>
            ) : (
              <span className="flex items-center gap-2">
                <Pill kind="ok">intact</Pill>
                <Link href="/canary" className="text-[11px] text-dim hover:text-teal">
                  {sol(c.balance)} SOL bounty →
                </Link>
              </span>
            )}
          </Row>
        </div>
      </div>
    </Panel>
  );
}

function RegisterForm({ busy, onLink }: { busy: string | null; onLink: (v: PublicKey) => void }) {
  const { program } = useNox();
  const [input, setInput] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; text: string; state?: VaultStateView } | null>(null);
  const v = parseKey(input);
  useEffect(() => {
    setCheck(null);
    if (!v) return;
    let live = true;
    fetchState(program, v)
      .then((st) => live && setCheck(st ? { ok: true, text: `Noxvault v3 vault · created ${dateTime(st.createdAt)} · ${st.config.trees.filter((t, i) => i < 3 && t.height).length} signer tree(s), threshold ${st.config.threshold}`, state: st } : { ok: false, text: "Not an initialized Noxvault v3 vault. Create one first, or paste the vault address (not a wallet or an invoice address)." }))
      .catch((e) => live && setCheck({ ok: false, text: errMsg(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, program]);
  return (
    <div className="flex flex-col gap-3">
      <Label>your vault address</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" placeholder="vault address (base58)" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
        <button className="btn shrink-0" disabled={!check?.ok || !!busy} onClick={() => v && onLink(v)}>
          {busy === "link" ? "linking…" : "link wallet → vault"}
        </button>
      </div>
      {input && !v && <div className="text-[12px] text-bad">Not a valid address.</div>}
      {check && <div className={`text-[12px] ${check.ok ? "text-teal" : "text-warn"}`}>{check.text}</div>}
      <div className="text-[11.5px] text-dim">
        No vault yet? <Link href="/create" className="text-teal hover:underline">Create one</Link>. Find yours on{" "}
        <Link href="/mine" className="text-teal hover:underline">my vaults</Link>.
      </div>
    </div>
  );
}

function LinkDetails({
  link,
  state,
  now,
  tripped,
  busy,
  onRequest,
  onApply,
}: {
  link: LinkView;
  state: VaultStateView | null;
  now: number;
  tripped: boolean;
  busy: string | null;
  onRequest: (v: PublicKey) => void;
  onApply: () => void;
}) {
  const { program } = useNox();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const v = parseKey(input);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-line p-3">
        <Row k="linked vault">
          <Addr value={link.vault.toBase58()} full />
        </Row>
        <Row k="vault state">{state ? <Pill kind="ok">initialized</Pill> : <Pill kind="bad">not found</Pill>}</Row>
        <Row k="registered">{dateTime(link.createdAt)}</Row>
        <Row k="registry entry" mono>
          <Addr value={linkPda(link.wallet, program.programId).toBase58()} />
        </Row>
        {link.change && (
          <Row k="pending change">
            <span className="flex flex-col gap-1">
              <span>
                → <Addr value={link.change.vault.toBase58()} />
              </span>
              <span className="text-[12px] text-mute">
                {now >= link.change.at ? "ready to apply" : `applies after ${dateTime(link.change.at)} (in ${duration(link.change.at - now)})`}
              </span>
            </span>
          </Row>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {link.change && (
          <button className="btn sm" disabled={now < link.change.at || tripped || !!busy} onClick={onApply}>
            {busy === "apply" ? "applying…" : "apply change"}
          </button>
        )}
        {!open && (
          <button className="btn ghost sm" disabled={tripped} onClick={() => setOpen(true)}>
            {link.change ? "request another vault" : "change linked vault"}
          </button>
        )}
      </div>
      {tripped && <div className="text-[12px] text-bad">The canary has tripped: the link can no longer be changed.</div>}
      {open && (
        <div className="flex flex-col gap-2 border border-dashed border-line p-3">
          <div className="text-[12px] text-mute">
            Changing the vault takes <strong className="text-bone">30 days</strong>, so someone who steals this wallet&apos;s key cannot
            quickly point the escape at their own vault. It is impossible once the canary trips.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="field flex-1" placeholder="new vault address" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
            <button className="btn sm shrink-0" disabled={!v || !!busy} onClick={() => v && onRequest(v)}>
              {busy === "request" ? "requesting…" : "request change"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApproveButton({ disabled, count, txs, oneprompt, busy, onClick }: { disabled: boolean; count: number; txs: number; oneprompt: boolean; busy: boolean; onClick: () => void }) {
  const prompts = oneprompt ? 1 : txs;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn" disabled={disabled} onClick={onClick}>
        {busy ? "approving…" : `approve ${count} account${count === 1 ? "" : "s"}`}
      </button>
      <span className="text-[11.5px] text-dim">
        {txs} transaction{txs === 1 ? "" : "s"} · {prompts} wallet prompt{prompts === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function PanicPanel({
  link,
  tripped,
  triggered,
  busy,
  delegated,
  armed,
  result,
  onPanic,
  onEvacuate,
}: {
  link: LinkView | null;
  tripped: boolean;
  triggered: boolean;
  busy: string | null;
  delegated: number;
  armed: boolean;
  result: ResultMsg | null;
  onPanic: (on: boolean) => void;
  onEvacuate: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Panel title={<span className="flex items-center gap-2 text-bad"><Siren size={13} /> panic</span>} className={link?.panic ? "!border-bad/60" : ""}>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <p className="text-[12.5px] text-mute">
          Think this wallet&apos;s key is compromised? Panic tells the program that the Escape Hatch may run for this wallet now,
          without waiting for the canary. Keepers then move every delegated token account into your vault and broadcast the stored
          SOL escape. You can also do it yourself right here.
        </p>
        {!link ? (
          <div className="text-[12px] text-dim">Link a vault first.</div>
        ) : !link.panic ? (
          !confirm ? (
            <button className="btn self-start !border-bad !bg-transparent !text-bad hover:!bg-bad/10" disabled={!!busy} onClick={() => setConfirm(true)}>
              <ShieldAlert size={15} /> panic
            </button>
          ) : (
            <div className="flex flex-col gap-3 rounded border border-bad/50 p-3">
              <div className="text-[12.5px] text-bone">
                After this, anyone can move this wallet&apos;s delegated tokens into <Addr value={link.vault.toBase58()} />. Getting them
                out again needs your vault&apos;s hash signature. Continue?
              </div>
              <div className="flex flex-wrap gap-3">
                <button className="btn !border-bad !bg-bad !text-ink" disabled={!!busy} onClick={() => { setConfirm(false); onPanic(true); }}>
                  {busy === "panic" ? "sending…" : "yes, panic"}
                </button>
                <button className="btn ghost" onClick={() => setConfirm(false)}>
                  cancel
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <Note kind="warn">Panic is ON for this wallet: the Escape Hatch may run for it now.</Note>
            <div className="flex flex-wrap gap-3">
              <button className="btn !border-bad !bg-bad !text-ink" disabled={!!busy || (!delegated && !armed)} onClick={onEvacuate}>
                {busy === "evacuate" ? "evacuating…" : `evacuate now (${delegated} token account${delegated === 1 ? "" : "s"}${armed ? " + SOL" : ""})`}
              </button>
              <button className="btn ghost" disabled={!!busy} onClick={() => onPanic(false)}>
                {busy === "unpanic" ? "sending…" : "turn panic off"}
              </button>
            </div>
          </div>
        )}
        {tripped && !link?.panic && link && (
          <Note kind="bad">The canary has tripped: the Escape Hatch is active for every linked wallet, panic or not.</Note>
        )}
        {triggered && link && !link.panic && (
          <button className="btn self-start !border-bad !bg-bad !text-ink" disabled={!!busy || (!delegated && !armed)} onClick={onEvacuate}>
            evacuate now
          </button>
        )}
        <Result r={result} />
      </div>
    </Panel>
  );
}
