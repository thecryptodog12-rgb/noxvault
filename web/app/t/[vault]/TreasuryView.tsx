"use client";
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { Copy, Empty, Label, Note, PageHead, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { errMsg, fromBaseUnits, short, sol } from "@/lib/format";
import { NETWORK, explorerUrl } from "@/lib/config";
import { loadTreasury, isSolMint, type Treasury } from "@/lib/treasury";
import { useTokenInfo } from "@/lib/tokens";
import { dateTime, duration, useNow } from "@/lib/time";

export default function TreasuryView({ vault }: { vault: string }) {
  const { connection } = useNox();
  const now = useNow();
  const [t, setT] = useState<Treasury | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("https://www.nox-vault.com");

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    let live = true;
    let key: PublicKey;
    try {
      key = new PublicKey(vault);
    } catch {
      setErr("That is not a valid Solana address.");
      return;
    }
    const load = () =>
      loadTreasury(connection, key)
        .then((x) => live && (setT(x), setErr(null)))
        .catch((e) => live && setErr(errMsg(e)));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [vault, connection]);

  const badgeUrl = `${origin}/api/treasury/${vault}/badge`;
  const pageUrl = `${origin}/t/${vault}`;
  const embed = `<a href="${pageUrl}"><img src="${badgeUrl}" alt="Noxvault treasury"></a>`;
  // Blink: dial.to renders the Action at /api/actions/fund/<vault> (app/actions.json maps /fund/* to it).
  const blinkUrl = `https://dial.to/?action=${encodeURIComponent(`solana-action:${origin}/api/actions/fund/${vault}`)}${NETWORK === "mainnet-beta" ? "" : `&cluster=${NETWORK === "testnet" ? "testnet" : "devnet"}`}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="treasury // public"
        title={
          <>
            Treasury <span className="inv">rules</span>
          </>
        }
        sub="What this treasury can and cannot do, read live from the chain. These rules are part of the vault address: nobody can change them, not even its signers."
      />

      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <a href={explorerUrl(vault)} target="_blank" rel="noreferrer" className="break-all hover:text-teal">
          {vault}
        </a>
        <Copy value={vault} />
      </div>

      {err && <Note kind="bad">{err}</Note>}
      {!t && !err && <Empty title="reading the chain…" />}

      {t && !t.initialized && <Note kind="warn">No Noxvault at this address. A treasury page only shows rules that a Noxvault enforces.</Note>}

      {t?.initialized && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 [&>*]:min-w-0">
            <Tile k="protections" v={`${t.score} / 5`} tone={t.score >= 4 ? "text-teal" : t.score >= 2 ? "text-warn" : "text-bad"} />
            <Tile k="signers" v={t.signers > 1 ? `${t.threshold} of ${t.signers}` : "1"} />
            <Tile k="sol" v={sol(t.lamports, 2)} />
            <Tile k="staked" v={sol(t.stakedLamports, 2)} />
          </div>

          {t.pending && (
            <Note kind="warn">
              Pending payout: {isSolMint(t.pending.mint) ? `${sol(BigInt(t.pending.amount), 4)} SOL` : `${t.pending.amount} units of ${short(t.pending.mint, 4)}`} →{" "}
              {short(t.pending.dest, 4)}, {now >= t.pending.executableAt ? "executable now" : `executable in ${duration(t.pending.executableAt - now)}`}. Holders can see it coming;
              the recovery key can still cancel it.
            </Note>
          )}

          <Panel title="enforced on-chain">
            <ul className="flex flex-col gap-2.5 p-4 text-[13.5px] sm:p-5">
              {t.rules.map((r) => (
                <li key={r} className="flex gap-2.5">
                  <span className="text-teal">✓</span>
                  <span>{r}</span>
                </li>
              ))}
              {t.caveats.map((r) => (
                <li key={r} className="flex gap-2.5 text-warn">
                  <span>!</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Panel>

          {t.tokens.length > 0 && (
            <Panel title="tokens">
              <div className="flex flex-col divide-y divide-line">
                {t.tokens.map((x) => (
                  <TokenRow key={x.mint} mint={x.mint} amount={x.amount} decimals={x.decimals} />
                ))}
              </div>
            </Panel>
          )}

          {t.schedules.length > 0 && (
            <Panel title="scheduled payouts (vesting)">
              <div className="overflow-x-auto">
                <table className="tbl min-w-[620px] whitespace-nowrap">
                  <thead>
                    <tr>
                      <th>to</th>
                      <th className="!text-right">amount</th>
                      <th>every</th>
                      <th className="!text-right">left</th>
                      <th className="!text-right">next</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.schedules.map((s, i) => (
                      <tr key={i}>
                        <td>{short(s.dest, 4)}</td>
                        <td className="text-right">{isSolMint(s.mint) ? `${sol(BigInt(s.amount))} SOL` : `${s.amount} · ${short(s.mint, 3)}`}</td>
                        <td>{duration(s.everySecs)}</td>
                        <td className="text-right">{s.remaining}</td>
                        <td className="text-right">{s.nextAt <= now ? "due" : dateTime(s.nextAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <div className="grid gap-1 text-[12.5px] text-mute">
            <span>
              Created {dateTime(t.createdAt)} · last signer activity {dateTime(t.lastActive)} · {t.actions} actions
            </span>
          </div>

          <Panel title="share as blink">
            <div className="flex flex-col gap-2 p-4 text-[12.5px] text-mute sm:p-5">
              <span>A link that shows a &quot;Fund this Noxvault&quot; card with these rules in Blink-aware wallets and on dial.to. Funding is a plain SOL transfer.</span>
              <div className="flex items-start gap-2">
                <a href={blinkUrl} target="_blank" rel="noreferrer" className="block flex-1 break-all rounded border border-line p-2 text-[11.5px] hover:text-teal">
                  {blinkUrl}
                </a>
                <Copy value={blinkUrl} />
              </div>
            </div>
          </Panel>

          <Panel title="put this on your site">
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/treasury/${vault}/badge`} alt="Noxvault treasury badge" className="h-[22px] w-auto self-start" />
              <Label>embed</Label>
              <div className="flex items-start gap-2">
                <code className="block flex-1 break-all rounded border border-line p-2 text-[11.5px] text-mute">{embed}</code>
                <Copy value={embed} />
              </div>
              <Label>json</Label>
              <div className="flex items-start gap-2">
                <code className="block flex-1 break-all rounded border border-line p-2 text-[11.5px] text-mute">{`${origin}/api/treasury/${vault}`}</code>
                <Copy value={`${origin}/api/treasury/${vault}`} />
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function TokenRow({ mint, amount, decimals }: { mint: string; amount: string; decimals: number }) {
  const { connection } = useNox();
  const info = useTokenInfo(connection, mint);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
      <span className="truncate">{info?.known ? `${info.symbol} · ${info.name}` : short(mint, 4)}</span>
      <span className="text-right">{fromBaseUnits(BigInt(amount), decimals)}</span>
    </div>
  );
}

function Tile({ k, v, tone = "" }: { k: string; v: string; tone?: string }) {
  return (
    <Panel className="p-4">
      <Label>{k}</Label>
      <div className={`mt-2 truncate text-[22px] font-bold ${tone}`}>{v}</div>
    </Panel>
  );
}
