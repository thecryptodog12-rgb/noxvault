"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, KeyRound, ScanSearch, ShieldCheck, ShieldAlert } from "lucide-react";
import { escapePda, fetchCanary, fetchLink, fetchState, type CanaryView, type LinkView, type VaultStateView } from "@nox/sdk/client";
import { Copy, Note, PageHead, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { NETWORK } from "@/lib/config";
import { tokenInfo, type TokenInfo } from "@/lib/tokens";
import { dateTime } from "@/lib/time";
import { errMsg, fromBaseUnits, sol } from "@/lib/format";
import { escapeTxStatus, heldTokens, isCovered, type EscapeTxStatus, type HeldToken } from "@/lib/escape";
import { readActivity, readStakes, riskOf, type Activity, type RiskLevel, type StakeView } from "@/lib/exposure";
import { Addr, Pill, Row, TokenName } from "../escape/parts";

const WSOL = "So11111111111111111111111111111111111111112";

interface Scan {
  address: PublicKey;
  onCurve: boolean;
  exists: boolean;
  owner: string | null;
  lamports: number;
  tokens: HeldToken[];
  infos: Record<string, TokenInfo>;
  prices: Record<string, number> | null;
  vault: VaultStateView | null;
  link: LinkView | null;
  esc: EscapeTxStatus | null;
  canary: CanaryView | null;
  activity: Activity | null;
  activityErr: string | null;
  stakes: StakeView[] | null;
  stakesErr: string | null;
}

/**
 * USD prices from Jupiter's price API (v3; the v2 the brief named now answers 404, kept as a
 * fallback). Returns null when it fails. Off mainnet there are no prices: test SOL is worth
 * nothing, and mainnet prices for devnet balances would mislead.
 */
async function jupPrices(mints: string[]): Promise<Record<string, number> | null> {
  if (NETWORK !== "mainnet-beta") return null;
  const get = async (url: string) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(t);
    }
  };
  const out: Record<string, number> = {};
  try {
    for (let i = 0; i < mints.length; i += 50) {
      const ids = mints.slice(i, i + 50).join(",");
      let j: Record<string, unknown>;
      try {
        j = await get(`https://lite-api.jup.ag/price/v3?ids=${ids}`);
        for (const [m, v] of Object.entries(j)) {
          const p = Number((v as { usdPrice?: number } | null)?.usdPrice);
          if (Number.isFinite(p)) out[m] = p;
        }
      } catch {
        j = await get(`https://lite-api.jup.ag/price/v2?ids=${ids}`);
        for (const [m, v] of Object.entries((j.data ?? {}) as Record<string, { price?: string } | null>)) {
          const p = Number(v?.price);
          if (v?.price && Number.isFinite(p)) out[m] = p;
        }
      }
    }
    return out;
  } catch {
    return null;
  }
}

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 4 : 2 });

/** `address` set: the page is /exposure/<address>; otherwise /scan?a=<address>. */
export default function Scanner({ address }: { address?: string } = {}) {
  const { connection, program } = useNox();
  const params = useSearchParams();
  const router = useRouter();
  const initial = address ?? params.get("a") ?? "";
  const [input, setInput] = useState(initial);
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(
    async (raw: string) => {
      setErr(null);
      setScan(null);
      let address: PublicKey;
      try {
        address = new PublicKey(raw.trim());
      } catch {
        setErr("That is not a Solana address.");
        return;
      }
      setBusy(true);
      try {
        const [info, tokens, vault, link, canary, activity, stakes] = await Promise.all([
          connection.getAccountInfo(address, "confirmed"),
          heldTokens(connection, address),
          fetchState(program, address).catch(() => null),
          fetchLink(program, address).catch(() => null),
          fetchCanary(program).catch(() => null),
          readActivity(connection, address).then(
            (a) => ({ a, e: null }),
            (e) => ({ a: null, e: errMsg(e) })
          ),
          readStakes(connection, address).then(
            (s) => ({ s, e: null }),
            (e) => ({ s: null, e: errMsg(e) })
          ),
        ]);
        const mints = [...new Set(tokens.map((t) => t.mint.toBase58()))];
        const [infos, prices, esc] = await Promise.all([
          Promise.all(mints.map((m) => tokenInfo(connection, m))).then((l) => Object.fromEntries(l.map((i) => [i.mint, i]))),
          jupPrices([WSOL, ...mints]),
          link ? escapeTxStatus(connection, program, link) : Promise.resolve(null),
        ]);
        setScan({
          address,
          onCurve: PublicKey.isOnCurve(address.toBytes()),
          exists: !!info,
          owner: info?.owner.toBase58() ?? null,
          lamports: info?.lamports ?? 0,
          tokens,
          infos,
          prices,
          vault,
          link,
          esc,
          canary,
          activity: activity.a,
          activityErr: activity.e,
          stakes: stakes.s,
          stakesErr: stakes.e,
        });
      } catch (e) {
        setErr(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [connection, program]
  );

  useEffect(() => {
    if (initial) {
      setInput(initial);
      void run(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const submit = () => {
    const a = input.trim();
    if (!a) return;
    if (a === initial) void run(a);
    else if (address !== undefined) router.push(`/exposure/${encodeURIComponent(a)}`);
    else router.replace(`/scan?a=${encodeURIComponent(a)}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="scanner // quantum exposure"
        title={
          <>
            Quantum exposure <span className="inv">scanner</span>
          </>
        }
        sub="Paste any Solana address. On Solana the address is the ed25519 public key itself, so every wallet's key is public by design. See how much value sits behind that one key, which a large enough quantum computer could one day derive the private key from, and what you can do about it. Only public chain data is read, from this browser."
      />

      <Panel lit>
        <form
          className="flex flex-col gap-2 p-4 sm:flex-row sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input className="field flex-1" placeholder="wallet or vault address" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
          <button className="btn shrink-0" disabled={busy || !input.trim()}>
            <ScanSearch size={15} /> {busy ? "scanning…" : "scan"}
          </button>
        </form>
      </Panel>

      {err && <Note kind="bad">{err}</Note>}
      {busy && !scan && <div className="text-[12.5px] text-dim">reading balances, tokens, stake accounts and history<span className="blink">…</span></div>}
      {scan && <Report s={scan} />}
      {!scan && !busy && <Why />}
    </div>
  );
}

/** Why every ed25519 address is exposed: the honest version. */
function Why() {
  return (
    <Panel title="why every wallet is exposed // the short version">
      <div className="grid gap-5 p-4 text-[12.5px] leading-6 text-mute sm:p-5 md:grid-cols-3 [&>*]:min-w-0">
        <div>
          <div className="mb-1 flex items-center gap-2 font-bold text-bone">
            <KeyRound size={15} className="text-teal" /> The address is the key
          </div>
          A Solana address is the 32-byte ed25519 public key, written in base58. There is no hash in between, unlike some Bitcoin address
          types. So the public key of every wallet is public from the day the address exists. That is how the system is meant to work, and
          nothing secret leaks.
        </div>
        <div>
          <div className="mb-1 font-bold text-bone">What changes with quantum computers</div>
          ed25519 is safe against today&apos;s computers. A large, error-corrected quantum computer running Shor&apos;s algorithm could
          compute the private key from the public key. Nobody can do that today, and nobody knows when or whether it will happen. If it
          does, every address&apos;s key is equally derivable.
        </div>
        <div>
          <div className="mb-1 font-bold text-bone">So the question is value</div>
          Exposure is measured by what one key controls: SOL, tokens, stake it can withdraw, delegations it granted. A Noxvault holds funds
          behind hash-based one-time signatures instead, which Shor&apos;s algorithm does not break. The Escape Hatch gives an existing
          wallet a way out.
        </div>
      </div>
    </Panel>
  );
}

const LEVEL: Record<RiskLevel, { label: string; kind: "ok" | "warn" | "bad" | "dim" }> = {
  none: { label: "no ed25519 exposure", kind: "ok" },
  low: { label: "low", kind: "dim" },
  medium: { label: "medium", kind: "warn" },
  high: { label: "high", kind: "bad" },
};

function Report({ s }: { s: Scan }) {
  const { connection, program } = useNox();
  const addr = s.address.toBase58();
  const solPrice = s.prices?.[WSOL];
  const rows = s.tokens.map((t) => {
    const m = t.mint.toBase58();
    const info = s.infos[m];
    const ui = info ? Number(fromBaseUnits(t.amount, info.decimals).replace(/,/g, "")) : null;
    const price = s.prices?.[m];
    return { t, m, info, value: ui !== null && price !== undefined ? ui * price : null };
  });
  const stakes = s.stakes ?? [];
  const withdrawable = stakes.filter((x) => x.role !== "staker");
  const stakeLamports = withdrawable.reduce((a, x) => a + x.lamports, 0);
  const solValue = solPrice !== undefined ? ((s.lamports + stakeLamports) / 1e9) * solPrice : null;
  const total = (solValue ?? 0) + rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const priced = solValue !== null || rows.some((r) => r.value !== null);
  const sharePath = `/exposure/${addr}`;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${sharePath}` : sharePath;

  const escapeKey = escapePda(s.address, program.programId);
  const delegated = s.tokens.filter((t) => t.delegate && t.delegatedAmount > 0n);
  const thirdParty = delegated.filter((t) => !t.delegate!.equals(escapeKey));
  const coveredTokens = s.link ? s.tokens.filter((t) => isCovered(t, s.address, program.programId)) : [];
  const kind: "vault" | "pda" | "wallet" = s.vault ? "vault" : !s.onCurve ? "pda" : "wallet";
  const empty = s.lamports === 0 && s.tokens.length === 0 && stakeLamports === 0;
  const risk = riskOf({
    kind,
    lamports: s.lamports,
    stakeWithdrawable: stakeLamports,
    stakeStakerOnly: stakes.length - withdrawable.length,
    tokens: s.tokens.length,
    usd: priced ? total : null,
    delegations: thirdParty.length,
    escapeArmed: !!s.esc?.armed,
    activity: s.activity,
  });
  const lvl = LEVEL[risk.level];

  return (
    <div className="flex flex-col gap-6">
      {/* verdict */}
      <Panel className={kind === "wallet" && !empty ? "!border-warn/50" : ""} lit={kind === "vault"}>
        <div className="flex flex-col gap-5 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {kind === "vault" ? <ShieldCheck className="mt-1 shrink-0 text-teal" size={30} /> : <ShieldAlert className={`mt-1 shrink-0 ${kind === "pda" ? "text-mute" : "text-warn"}`} size={30} />}
            <div className="min-w-0">
              <div className="label mb-1">{kind === "vault" ? "protected" : kind === "pda" ? "no private key" : empty ? "ed25519 wallet · empty" : "exposed by design"}</div>
              {kind === "vault" ? (
                <div className="font-display text-[22px] sm:text-[28px]">This is a Noxvault vault.</div>
              ) : kind === "pda" ? (
                <div className="font-display text-[22px] sm:text-[28px]">A program address, not a key.</div>
              ) : (
                <div className="font-display text-[22px] sm:text-[28px]">
                  {priced
                    ? usd(total)
                    : `${sol(s.lamports + stakeLamports)} SOL${s.tokens.length ? ` + ${s.tokens.length} token${s.tokens.length === 1 ? "" : "s"}` : ""}`}{" "}
                  <span className="text-warn">on one ed25519 key</span>
                </div>
              )}
              <p className="mt-2 max-w-2xl text-[12.5px] text-mute">
                {kind === "vault"
                  ? "Nothing here can be moved with an ed25519 signature. Withdrawals need a hash-based (WOTS+) one-time signature checked on chain, which quantum computers are not known to break."
                  : kind === "pda"
                    ? `This address is off the ed25519 curve, so no private key exists for it. Whatever controls it is the program that owns it${s.owner ? ` (${s.owner.slice(0, 8)}…)` : ""}, with that program's rules.`
                    : "This address is this wallet's public key, visible to everyone; that is normal. If quantum computers ever break ed25519, whoever derives the private key from it can move everything listed below. Today that is not possible; the point is to have a way out before it is."}
              </p>
              <div className="mt-2 break-all text-[11.5px] text-dim">
                <Addr value={addr} full />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
            {kind !== "vault" && (
              <Link href="/create" className="btn">
                Move it into a Noxvault <ArrowRight size={15} />
              </Link>
            )}
            {kind === "wallet" && (
              <Link href="/escape" className="btn outline">
                Escape Hatch <ArrowRight size={15} />
              </Link>
            )}
          </div>
        </div>
      </Panel>

      {/* risk summary */}
      <Panel title="risk summary" right={<Pill kind={lvl.kind}>{lvl.label}</Pill>}>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="text-[15px] font-bold text-bone">{risk.headline}</div>
          <ul className="flex flex-col gap-1.5 text-[12.5px] text-mute">
            {risk.points.map((p) => (
              <li key={p} className="flex gap-2">
                <span className="shrink-0 text-teal">›</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {kind === "wallet" && (
            <p className="text-[12px] text-dim">
              What to do: hold long-term value in a <Link href="/create" className="text-teal">Noxvault</Link>, where withdrawals need a
              hash-based one-time signature. For what stays in this wallet, the <Link href="/escape" className="text-teal">Escape Hatch</Link> pre-signs
              a move into your vault that anyone can broadcast if the public canary key is ever broken.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] [&>*]:min-w-0">
        <Panel title="value at risk" right={s.prices === null ? <span className="text-[10.5px] text-dim">{NETWORK === "mainnet-beta" ? "prices unavailable" : `${NETWORK}: no prices`}</span> : undefined}>
          <div className="overflow-x-auto">
            <table className="tbl min-w-[480px]">
              <thead>
                <tr>
                  <th>asset</th>
                  <th>balance</th>
                  <th>usd</th>
                  {kind === "wallet" && <th>escape</th>}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>SOL</td>
                  <td className="tabular-nums">{sol(s.lamports, 6)}</td>
                  <td className="tabular-nums text-mute">{solPrice !== undefined ? usd((s.lamports / 1e9) * solPrice) : "—"}</td>
                  {kind === "wallet" && <td>{s.esc?.armed ? <Pill kind="ok">armed</Pill> : <Pill kind="dim">no</Pill>}</td>}
                </tr>
                {stakeLamports > 0 && (
                  <tr>
                    <td>
                      SOL <span className="text-dim">staked ({withdrawable.length})</span>
                    </td>
                    <td className="tabular-nums">{sol(stakeLamports, 6)}</td>
                    <td className="tabular-nums text-mute">{solPrice !== undefined ? usd((stakeLamports / 1e9) * solPrice) : "—"}</td>
                    {kind === "wallet" && (
                      <td>
                        <Pill kind="dim">no</Pill>
                      </td>
                    )}
                  </tr>
                )}
                {rows.map(({ t, m, value }) => (
                  <tr key={t.address.toBase58()}>
                    <td>
                      <TokenName conn={connection} mint={m} />
                    </td>
                    <td className="tabular-nums">{s.infos[m] ? fromBaseUnits(t.amount, s.infos[m].decimals) : t.amount.toString()}</td>
                    <td className="tabular-nums text-mute">{value !== null ? usd(value) : "—"}</td>
                    {kind === "wallet" && (
                      <td>{s.link && isCovered(t, s.address, program.programId) ? <Pill kind="ok">covered</Pill> : t.delegate?.equals(escapeKey) ? <Pill kind="warn">partial</Pill> : <Pill kind="dim">no</Pill>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!s.exists && <div className="border-t border-line px-4 py-3 text-[12px] text-dim">This address has never held SOL (no account on chain).</div>}
        </Panel>

        <Panel title="age & activity">
          <div className="p-4 sm:p-5">
            {s.activity ? (
              <>
                <Row k="transactions">
                  {s.activity.capped ? `${s.activity.count.toLocaleString("en-US")}+ (first ${s.activity.count.toLocaleString("en-US")} read)` : s.activity.count.toLocaleString("en-US")}
                  {s.activity.failed > 0 && <span className="text-dim"> · {s.activity.failed} failed</span>}
                </Row>
                <Row k="last active">{s.activity.last ? dateTime(s.activity.last) : "—"}</Row>
                <Row k={s.activity.capped ? "oldest read" : "first seen"}>{s.activity.first ? dateTime(s.activity.first) : "—"}</Row>
                <p className="mt-3 text-[11.5px] text-dim">
                  {s.activity.capped
                    ? "Very active address: only the newest transactions were read, so the true first one is older."
                    : "The key was public from the first moment this address was shared, even before its first transaction."}
                </p>
              </>
            ) : (
              <p className="text-[12.5px] text-dim">History unavailable on this RPC{s.activityErr ? ` (${s.activityErr})` : ""}.</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] [&>*]:min-w-0">
        <Panel title="authorities this key holds or granted">
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div>
              <div className="label mb-2">stake accounts</div>
              {s.stakes === null ? (
                <p className="text-[12.5px] text-dim">Stake lookup unavailable on this RPC{s.stakesErr ? ` (${s.stakesErr})` : ""}.</p>
              ) : stakes.length === 0 ? (
                <p className="text-[12.5px] text-mute">None: this key is not staker or withdrawer of any stake account.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="tbl min-w-[440px]">
                    <thead>
                      <tr>
                        <th>stake account</th>
                        <th>SOL</th>
                        <th>state</th>
                        <th>this key is</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stakes.map((x) => (
                        <tr key={x.address}>
                          <td>
                            <Addr value={x.address} />
                          </td>
                          <td className="tabular-nums">{sol(x.lamports, 4)}</td>
                          <td className="text-mute">{x.state}</td>
                          <td>{x.role === "staker" ? <Pill kind="dim">staker</Pill> : <Pill kind="warn">{x.role === "both" ? "staker + withdrawer" : "withdrawer"}</Pill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <div className="label mb-2">token delegations</div>
              {delegated.length === 0 ? (
                <p className="text-[12.5px] text-mute">None: no other key may move this wallet&apos;s tokens.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-[12.5px]">
                  {delegated.map((t) => {
                    const m = t.mint.toBase58();
                    const isEscape = t.delegate!.equals(escapeKey);
                    return (
                      <li key={t.address.toBase58()} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <TokenName conn={connection} mint={m} />
                        <span className="text-dim">up to {s.infos[m] ? fromBaseUnits(t.delegatedAmount, s.infos[m].decimals) : t.delegatedAmount.toString()} by</span>
                        {isEscape ? <Pill kind="ok">Escape Hatch</Pill> : <Addr value={t.delegate!.toBase58()} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="noxvault">
          <div className="p-4 sm:p-5">
            {kind === "vault" && s.vault ? (
              <>
                <Row k="status"><Pill kind="ok">protected</Pill></Row>
                <Row k="created">{dateTime(s.vault.createdAt)}</Row>
                <Row k="signers">{s.vault.config.trees.filter((t, i) => i < 3 && t.height).length}, threshold {s.vault.config.threshold}</Row>
                <Row k="recovery">{s.vault.config.trees[3].height ? "yes" : "none"}</Row>
                <Row k="testament">{s.vault.config.heirs.length ? `${s.vault.config.heirs.length} heir(s)` : "off"}</Row>
              </>
            ) : kind === "wallet" ? (
              <>
                <Row k="registry link">
                  {s.link ? (
                    <span className="flex flex-col">
                      <Addr value={s.link.vault.toBase58()} />
                      <span className="text-[11.5px] text-dim">since {dateTime(s.link.createdAt)}</span>
                    </span>
                  ) : (
                    <Pill kind="dim">none</Pill>
                  )}
                </Row>
                <Row k="tokens covered">{s.link ? `${coveredTokens.length}/${s.tokens.length}` : "—"}</Row>
                <Row k="SOL escape">{!s.link ? "—" : s.esc?.armed ? <Pill kind="ok">armed</Pill> : s.esc?.stored ? <Pill kind="warn">re-arm needed</Pill> : <Pill kind="dim">not armed</Pill>}</Row>
                <Row k="panic">{s.link ? (s.link.panic ? <Pill kind="bad">on</Pill> : "off") : "—"}</Row>
                <Row k="canary">{!s.canary ? "—" : s.canary.tripped ? <Pill kind="bad">tripped</Pill> : <Pill kind="ok">intact</Pill>}</Row>
                {!s.link && <p className="mt-3 text-[12px] text-mute">No Escape Hatch: if this key falls, nothing moves these funds first.</p>}
              </>
            ) : (
              <p className="text-[12.5px] text-mute">Not a Noxvault vault and not an ed25519 wallet.</p>
            )}
          </div>
        </Panel>
      </div>

      <Why />

      <Panel>
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="label mb-1">share this result (with a preview card)</div>
            <div className="truncate text-[12px] text-mute">{shareUrl}</div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link href={sharePath} className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-teal">
              [open]
            </Link>
            <a
              href={`https://x.com/intent/post?${new URLSearchParams({
                text:
                  kind === "vault"
                    ? "This Solana address is a Noxvault: withdrawals need a hash-based one-time signature, not one ed25519 key. Check yours:"
                    : priced && total > 0
                      ? `$${Math.round(total).toLocaleString("en-US")} in this Solana wallet sits behind one ed25519 key. How exposed is yours?`
                      : "On Solana the address is the public key. How exposed is your wallet?",
                url: shareUrl,
                via: "noxvaultHQ",
              })}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-teal"
            >
              [post on x]
            </a>
            <Copy value={shareUrl} />
          </div>
        </div>
      </Panel>
    </div>
  );
}
