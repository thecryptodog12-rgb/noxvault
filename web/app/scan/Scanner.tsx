"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, ScanSearch, ShieldCheck, ShieldAlert } from "lucide-react";
import { escapePda, fetchCanary, fetchLink, fetchState, type CanaryView, type LinkView, type VaultStateView } from "@nox/sdk/client";
import { Copy, Note, PageHead, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { NETWORK } from "@/lib/config";
import { tokenInfo, type TokenInfo } from "@/lib/tokens";
import { dateTime } from "@/lib/time";
import { errMsg, fromBaseUnits, sol } from "@/lib/format";
import { escapeTxStatus, heldTokens, isCovered, type EscapeTxStatus, type HeldToken } from "@/lib/escape";
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

export default function Scanner() {
  const { connection, program } = useNox();
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("a") ?? "";
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
        const [info, tokens, vault, link, canary] = await Promise.all([
          connection.getAccountInfo(address, "confirmed"),
          heldTokens(connection, address),
          fetchState(program, address).catch(() => null),
          fetchLink(program, address).catch(() => null),
          fetchCanary(program).catch(() => null),
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
        sub="Paste any Solana address. Everything held by an ordinary wallet sits behind one ed25519 key, which a large enough quantum computer could break. See how much, and whether the Escape Hatch covers it."
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
      {scan && <Report s={scan} />}
    </div>
  );
}

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
  const solValue = solPrice !== undefined ? (s.lamports / 1e9) * solPrice : null;
  const total = (solValue ?? 0) + rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const priced = solValue !== null || rows.some((r) => r.value !== null);
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/scan?a=${addr}` : `/scan?a=${addr}`;

  const coveredTokens = s.link ? s.tokens.filter((t) => isCovered(t, s.address, program.programId)) : [];
  const kind: "vault" | "pda" | "wallet" = s.vault ? "vault" : !s.onCurve ? "pda" : "wallet";
  const empty = s.lamports === 0 && s.tokens.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* verdict */}
      <Panel className={kind === "wallet" && !empty ? "!border-warn/50" : ""} lit={kind === "vault"}>
        <div className="flex flex-col gap-5 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {kind === "vault" ? <ShieldCheck className="mt-1 shrink-0 text-teal" size={30} /> : <ShieldAlert className={`mt-1 shrink-0 ${kind === "pda" ? "text-mute" : "text-warn"}`} size={30} />}
            <div className="min-w-0">
              <div className="label mb-1">{kind === "vault" ? "protected" : kind === "pda" ? "no private key" : empty ? "ed25519 wallet · empty" : "exposed"}</div>
              {kind === "vault" ? (
                <div className="font-display text-[22px] sm:text-[28px]">This is a Noxvault vault.</div>
              ) : kind === "pda" ? (
                <div className="font-display text-[22px] sm:text-[28px]">A program address, not a key.</div>
              ) : (
                <div className="font-display text-[22px] sm:text-[28px]">
                  {priced ? usd(total) : `${sol(s.lamports)} SOL${s.tokens.length ? ` + ${s.tokens.length} token${s.tokens.length === 1 ? "" : "s"}` : ""}`}{" "}
                  <span className="text-warn">on one ed25519 key</span>
                </div>
              )}
              <p className="mt-2 max-w-2xl text-[12.5px] text-mute">
                {kind === "vault"
                  ? "Nothing here can be moved with an ed25519 signature. Withdrawals need a hash-based (WOTS+) one-time signature checked on chain, which quantum computers are not known to break."
                  : kind === "pda"
                    ? `This address is off the ed25519 curve, so no private key exists for it. Whatever controls it is the program that owns it${s.owner ? ` (${s.owner.slice(0, 8)}…)` : ""}, with that program's rules.`
                    : "Exposed once quantum computers can break ed25519: whoever derives this key from its public address can move all of it. Today that is not possible; the question is whether you have a way out before it is."}
              </p>
              <div className="mt-2 break-all text-[11.5px] text-dim">
                <Addr value={addr} full />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
            {kind !== "vault" && (
              <Link href="/create" className="btn">
                Create a vault <ArrowRight size={15} />
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

      <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] [&>*]:min-w-0">
        <Panel title="holdings" right={s.prices === null ? <span className="text-[10.5px] text-dim">prices unavailable</span> : undefined}>
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
                  <td className="tabular-nums text-mute">{solValue !== null ? usd(solValue) : "—"}</td>
                  {kind === "wallet" && <td>{s.esc?.armed ? <Pill kind="ok">armed</Pill> : <Pill kind="dim">no</Pill>}</td>}
                </tr>
                {rows.map(({ t, m, value }) => (
                  <tr key={t.address.toBase58()}>
                    <td>
                      <TokenName conn={connection} mint={m} />
                    </td>
                    <td className="tabular-nums">{s.infos[m] ? fromBaseUnits(t.amount, s.infos[m].decimals) : t.amount.toString()}</td>
                    <td className="tabular-nums text-mute">{value !== null ? usd(value) : "—"}</td>
                    {kind === "wallet" && (
                      <td>{s.link && isCovered(t, s.address, program.programId) ? <Pill kind="ok">covered</Pill> : t.delegate?.equals(escapePda(s.address, program.programId)) ? <Pill kind="warn">partial</Pill> : <Pill kind="dim">no</Pill>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!s.exists && <div className="border-t border-line px-4 py-3 text-[12px] text-dim">This address has never held SOL (no account on chain).</div>}
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

      <Panel>
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="label mb-1">share this result</div>
            <div className="truncate text-[12px] text-mute">{shareUrl}</div>
          </div>
          <Copy value={shareUrl} />
        </div>
      </Panel>
    </div>
  );
}
