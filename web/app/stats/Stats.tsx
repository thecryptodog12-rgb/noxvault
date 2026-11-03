"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { vaultStakes, withRetry } from "@nox/sdk/client";
import { loadVaultRows } from "@/lib/stats";
import { loadProtocol, tiersFor } from "@/lib/nox";
import { Empty, Note, PageHead, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { NETWORK } from "@/lib/config";
import { errMsg, sol } from "@/lib/format";

const STAKE_SCAN = 50;
const DAYS = 30;

interface Data {
  vaults: number;
  solLocked: number;
  actions: number;
  withRecovery: number;
  withWhitelist: number;
  multisig: number;
  tiers: [number, number, number] | null;
  withHeirs: number;
  migrating: number;
  schedules: number | null;
  budgets: number | null;
  pending: number;
  staked: number;
  stakeScanned: number;
  perDay: { day: string; n: number }[];
  at: Date;
}

async function loadStats(program: ReturnType<typeof useNox>["program"]): Promise<Data> {
  const conn = program.provider.connection;
  const rows = await loadVaultRows(program);
  const protocol = await loadProtocol(program).catch(() => null);
  const tierMap = await tiersFor(conn, rows.map((r) => r.vault), protocol).catch(() => null);
  const tiers: [number, number, number] | null = tierMap ? [0, 0, 0] : null;
  if (tiers && tierMap) for (const t of tierMap.values()) tiers[t.tier]++;
  const [schedules, budgets] = await Promise.all([
    withRetry(() => program.account.schedule.all()).then((l) => l.length).catch(() => null),
    withRetry(() => program.account.budget.all()).then((l) => l.length).catch(() => null),
  ]);

  // Stake accounts: only the largest vaults, to keep this to a handful of RPC calls.
  const top = [...rows].sort((a, b) => b.lamports - a.lamports).slice(0, STAKE_SCAN);
  let staked = 0;
  const stakes: Awaited<ReturnType<typeof vaultStakes>>[] = [];
  for (let i = 0; i < top.length; i += 5)
    stakes.push(...(await Promise.all(top.slice(i, i + 5).map((r) => withRetry(() => vaultStakes(program, r.vault)).catch(() => [])))));
  for (const list of stakes) for (const s of list) staked += s?.lamports ?? 0;

  const today = Math.floor(Date.now() / 86400_000);
  const perDay = Array.from({ length: DAYS }, (_, i) => {
    const d = today - (DAYS - 1 - i);
    return { day: new Date(d * 86400_000).toISOString().slice(0, 10), n: 0 };
  });
  for (const r of rows) {
    const idx = Math.floor(r.createdAt / 86400) - (today - (DAYS - 1));
    if (idx >= 0 && idx < DAYS) perDay[idx].n++;
  }

  return {
    vaults: rows.length,
    solLocked: rows.reduce((s, r) => s + r.lamports, 0),
    actions: rows.reduce((s, r) => s + r.actions, 0),
    withRecovery: rows.filter((r) => r.recovery).length,
    withWhitelist: rows.filter((r) => r.whitelist).length,
    multisig: rows.filter((r) => r.multisig).length,
    tiers,
    withHeirs: rows.filter((r) => r.heirs).length,
    migrating: rows.filter((r) => r.migrating).length,
    schedules,
    budgets,
    pending: rows.filter((r) => r.pending).length,
    staked,
    stakeScanned: top.length,
    perDay,
    at: new Date(),
  };
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <Panel>
      <div className="flex flex-col gap-1 p-4">
        <div className="label">{k}</div>
        <div className="font-display text-[26px] text-bone">{v}</div>
        {sub && <div className="text-[11px] text-dim">{sub}</div>}
      </div>
    </Panel>
  );
}

function Bars({ data }: { data: { day: string; n: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const W = 1000;
  const H = 200;
  const pad = { l: 30, r: 4, t: 10, b: 22 };
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (n: number) => pad.t + (H - pad.t - pad.b) * (1 - n / max);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Vaults created per day, last 30 days">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={11} fill="var(--color-dim)">
            {t}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const h = y(0) - y(d.n);
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.n} vault${d.n === 1 ? "" : "s"}`}</title>
            <rect x={pad.l + i * bw + 1.5} y={y(d.n)} width={Math.max(1, bw - 3)} height={Math.max(0, h)} rx={1.5} fill="var(--color-teal)" opacity={d.n ? 0.85 : 0} />
            <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
          </g>
        );
      })}
      {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
        <text key={i} x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-dim)">
          {data[i].day.slice(5)}
        </text>
      ))}
    </svg>
  );
}

export default function Stats() {
  const { program, deployed } = useNox();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await loadStats(program));
    } catch (e) {
      setData(null);
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [program]);

  useEffect(() => {
    if (deployed) load();
  }, [deployed, load]);

  const head = (
    <PageHead
      kicker="network // stats"
      title={
        <>
          Protocol <span className="inv">stats</span>
        </>
      }
      sub={`Live numbers for every Noxvault vault on ${NETWORK}, read straight from the program's accounts. No indexer, no backend.`}
    />
  );

  if (deployed === null || (deployed && busy && !data && !err))
    return (
      <div>
        {head}
        <Panel>
          <Empty title="Reading the chain…">Fetching every vault account and its balance.</Empty>
        </Panel>
      </div>
    );

  if (deployed === false)
    return (
      <div>
        {head}
        <Panel>
          <Empty title="Not live on this network yet">
            The Noxvault program is not deployed on {NETWORK}. Stats appear here as soon as it is.
          </Empty>
        </Panel>
      </div>
    );

  if (err)
    return (
      <div className="flex flex-col gap-4">
        {head}
        <Panel>
          <Empty title="No vault data to show">
            The program on {NETWORK} did not return vault accounts (it may still run an older version, or the RPC refused the
            query). <span className="text-mute">Details: {err.slice(0, 160)}</span>
          </Empty>
          <div className="flex justify-center pb-8">
            <button className="btn ghost sm" onClick={load} disabled={busy}>
              {busy ? "retrying…" : "try again"}
            </button>
          </div>
        </Panel>
      </div>
    );

  if (!data) return head;

  return (
    <div className="flex flex-col gap-6">
      {head}
      {data.vaults === 0 ? (
        <Panel>
          <Empty title="No vaults yet">
            Nobody has initialized a vault on {NETWORK} so far. <Link href="/create" className="text-teal">Create the first one</Link>.
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 [&>*]:min-w-0">
            <Tile k="vaults" v={data.vaults.toLocaleString("en-US")} />
            <Tile k="SOL locked" v={sol(data.solLocked, 2)} sub="native SOL in vault addresses" />
            <Tile k="actions" v={data.actions.toLocaleString("en-US")} sub="executed one-time signatures" />
            <Tile k="SOL staked" v={sol(data.staked, 2)} sub={`stake accounts of the ${data.stakeScanned} largest vaults`} />
            <Tile k="with recovery key" v={data.withRecovery.toLocaleString("en-US")} sub={`${Math.round((100 * data.withRecovery) / data.vaults)}% of vaults`} />
            <Tile k="with whitelist" v={data.withWhitelist.toLocaleString("en-US")} sub={`${Math.round((100 * data.withWhitelist) / data.vaults)}% of vaults`} />
            <Tile k="tiers" v={data.tiers ? `${data.tiers[0]} · ${data.tiers[1]} · ${data.tiers[2]}` : "–"} sub="Free · Guardian · Sentinel ($NOX in vault)" />
            <Tile k="multi-signer" v={data.multisig.toLocaleString("en-US")} sub="vaults with co-signers" />
            <Tile k="with testament" v={data.withHeirs.toLocaleString("en-US")} sub="heirs set" />
            <Tile k="schedules · budgets" v={`${data.schedules ?? "–"} · ${data.budgets ?? "–"}`} sub="active on chain" />
            <Tile k="pending · migrating" v={`${data.pending} · ${data.migrating}`} sub="waiting out a delay / moving" />
            <Tile k="updated" v={data.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} sub={NETWORK} />
          </div>
          <Panel title={`vaults created per day // last ${DAYS} days`}>
            <div className="p-4 sm:p-5">
              <Bars data={data.perDay} />
            </div>
          </Panel>
        </>
      )}
      <div className="flex items-center gap-3">
        <button className="btn ghost sm" onClick={load} disabled={busy}>
          {busy ? "refreshing…" : "refresh"}
        </button>
        <Note kind="info">Token balances are not included. Staked SOL is counted for at most {STAKE_SCAN} vaults.</Note>
      </div>
    </div>
  );
}
