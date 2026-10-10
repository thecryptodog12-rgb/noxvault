"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { RECOVERY_TREE, decodeState, fetchState, keysLeft, vaultSchedules, vaultStakes, withRetry, type VaultStateView } from "@nox/sdk/client";
import { Copy, Empty, Label, Note, PageHead, Panel, Status } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { errMsg, fromBaseUnits, short, sol, timeAgo } from "@/lib/format";
import { explorerUrl, NETWORK } from "@/lib/config";
import { isSol, vaultAssets, type VaultAssets } from "@/lib/unlock";
import { TIER_NAMES, loadProtocol, tiersFor, useVaultTier } from "@/lib/nox";
import TierBadge from "@/components/vault/TierBadge";
import { dateTime, duration, useNow } from "@/lib/time";

const signersOf = (s: VaultStateView) => [0, 1, 2].filter((t) => s.config.trees[t].height > 0).length;

export default function Explorer() {
  const { connection, program, deployed } = useNox();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [states, setStates] = useState<VaultStateView[] | null>(null);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [tiers, setTiers] = useState<Map<string, { tier: number; held: bigint }>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const accts = await withRetry(() => connection.getProgramAccounts(program.programId, {
          commitment: "confirmed",
          filters: [{ memcmp: program.coder.accounts.memcmp("vaultState") }],
        }));
        const list: VaultStateView[] = [];
        for (const a of accts) {
          try {
            list.push(decodeState(program, a.account.data));
          } catch {
            /* an account from an older program version */
          }
        }
        list.sort((a, b) => b.createdAt - a.createdAt);
        if (!live) return;
        setStates(list);
        const keys = list.map((s) => s.vault);
        const m = new Map<string, number>();
        for (let i = 0; i < keys.length; i += 100) {
          const infos = await withRetry(() => connection.getMultipleAccountsInfo(keys.slice(i, i + 100), "confirmed"));
          infos.forEach((inf, k) => m.set(keys[i + k].toBase58(), inf?.lamports ?? 0));
        }
        if (live) setBalances(m);
        const p = await loadProtocol(program).catch(() => null);
        const t = await tiersFor(connection, keys, p).catch(() => new Map());
        if (live) setTiers(t);
      } catch (e) {
        if (!live) return;
        setErr(errMsg(e));
        setStates([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [program, connection]);

  const loading = states === null;
  const totals = useMemo(() => {
    const s = states ?? [];
    return {
      vaults: s.length,
      sol: s.reduce((t, x) => t + (balances.get(x.vault.toBase58()) ?? 0), 0),
      actions: s.reduce((t, x) => t + x.actions, 0),
      pending: s.filter((x) => x.pending).length,
    };
  }, [states, balances]);

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="03 // explorer"
        title={
          <>
            Vault <span className="inv">explorer</span>
          </>
        }
        sub="Every initialized Noxvault on this network: balance, signers, pending actions, recovery and testament. Configs are public; phrases are not."
      />

      <Lookup initial={q} />
      {q && <LookupResult key={q} q={q} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 [&>*]:min-w-0">
        <Tile k="vaults" v={loading ? "…" : String(totals.vaults)} />
        <Tile k="sol locked" v={loading ? "…" : sol(totals.sol, 2)} />
        <Tile k="actions" v={loading ? "…" : String(totals.actions)} />
        <Tile k="pending" v={loading ? "…" : String(totals.pending)} />
      </div>

      {err && <Note kind={deployed === false ? "warn" : "bad"}>{deployed === false ? `The Noxvault program is not deployed on ${NETWORK} yet.` : `Could not load vaults: ${err}`}</Note>}

      <Panel title="vaults">
        {loading ? (
          <Empty title="loading…" />
        ) : states!.length === 0 ? (
          <Empty title="no vaults yet">
            {deployed === false ? "Waiting for the program to go live." : <>Nobody has initialized a v3 vault yet. <Link href="/create" className="underline">Create one</Link>.</>}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[940px] whitespace-nowrap">
              <thead>
                <tr>
                  <th>vault</th>
                  <th className="!text-right">balance</th>
                  <th className="!text-right">actions</th>
                  <th>tier</th>
                  <th>signers</th>
                  <th>keys left</th>
                  <th>pending</th>
                  <th>recovery</th>
                  <th>heirs</th>
                  <th className="!text-right">created</th>
                </tr>
              </thead>
              <tbody>
                {states!.map((s) => {
                  const a = s.vault.toBase58();
                  return (
                    <tr key={a}>
                      <td>
                        <Link href={`/vaults?q=${a}`} className="hover:text-teal">
                          {short(a, 6)}
                        </Link>
                      </td>
                      <td className="text-right">{sol(balances.get(a) ?? 0)} SOL</td>
                      <td className="text-right">{s.actions}</td>
                      <td>
                        <TierCell t={tiers.get(a)} />
                      </td>
                      <td className="text-mute">
                        {s.config.threshold} of {signersOf(s)}
                      </td>
                      <td className="text-mute">{keysLeft(s, 0)}/256</td>
                      <td>{s.pending ? <Status kind="pending" /> : s.migrateTo ? <span className="text-warn">migrating</span> : <span className="text-dim">—</span>}</td>
                      <td className="text-mute">{s.config.trees[RECOVERY_TREE].height ? "yes" : "no"}</td>
                      <td className="text-mute">{s.config.heirs.length || "—"}</td>
                      <td className="text-right text-dim">{timeAgo(s.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function TierCell({ t }: { t?: { tier: number } }) {
  if (!t) return <span className="text-dim">…</span>;
  const tone = ["text-mute", "text-teal", "text-warn"][t.tier];
  return <span className={`text-[11.5px] font-bold uppercase tracking-[0.1em] ${tone}`}>{TIER_NAMES[t.tier]}</span>;
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <Panel className="p-4">
      <Label>{k}</Label>
      <div className="mt-2 truncate text-[22px] font-bold">{v}</div>
    </Panel>
  );
}

function Lookup({ initial }: { initial: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(v.trim() ? `/vaults?q=${encodeURIComponent(v.trim())}` : "/vaults");
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <input className="field flex-1" value={v} onChange={(e) => setV(e.target.value)} placeholder="look up a vault address" spellCheck={false} aria-label="Vault address" />
      <button className="btn" type="submit">
        look up
      </button>
    </form>
  );
}

function LookupResult({ q }: { q: string }) {
  const { connection, program } = useNox();
  const now = useNow();
  const [st, setSt] = useState<
    | { kind: "loading" }
    | { kind: "bad"; text: string }
    | { kind: "ok"; vault: PublicKey; state: VaultStateView | null; assets: VaultAssets; staked: number; schedules: number | null }
  >({ kind: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      let vault: PublicKey;
      try {
        vault = new PublicKey(q);
      } catch {
        setSt({ kind: "bad", text: "That is not a valid Solana address." });
        return;
      }
      try {
        const [state, assets, stakes] = await Promise.all([fetchState(program, vault), vaultAssets(connection, vault), vaultStakes(program, vault)]);
        const schedules = state ? await vaultSchedules(program, vault).then((l) => l.length).catch(() => null) : null;
        if (live) setSt({ kind: "ok", vault, state, assets, staked: stakes.reduce((t, s) => t + (s?.lamports ?? 0), 0), schedules });
      } catch (e) {
        if (live) setSt({ kind: "bad", text: errMsg(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [q, connection, program]);

  return (
    <Panel lit title={`lookup // ${short(q, 8)}`}>
      <div className="p-4 sm:p-5">
        {st.kind === "loading" ? (
          <div className="text-[13px] text-mute">
            reading the chain<span className="blink">…</span>
          </div>
        ) : st.kind === "bad" ? (
          <Note kind="bad">{st.text}</Note>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Status kind={st.state ? "sealed" : "empty"} />
              <a href={explorerUrl(st.vault.toBase58())} target="_blank" rel="noreferrer" className="break-all text-[13px] hover:text-teal">
                {st.vault.toBase58()}
              </a>
              <Copy value={st.vault.toBase58()} />
              <LookupTier vault={st.vault} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 [&>*]:min-w-0">
              <Fact k="sol" v={sol(st.assets.lamports)} />
              <Fact k="staked" v={sol(st.staked)} />
              <Fact k="actions" v={st.state ? String(st.state.actions) : "—"} />
              <Fact k="signers" v={st.state ? `${st.state.config.threshold} of ${signersOf(st.state)}` : "—"} />
            </div>
            {st.assets.tokens.filter((t) => t.amount > 0n).length > 0 && (
              <div className="text-[12.5px] text-mute">
                Tokens:{" "}
                {st.assets.tokens
                  .filter((t) => t.amount > 0n)
                  .map((t) => `${fromBaseUnits(t.amount, t.decimals)} ${short(t.mint.toBase58(), 3)}`)
                  .join(" · ")}
              </div>
            )}
            {st.state ? (
              <div className="grid gap-2 text-[12.5px] text-mute">
                <span>
                  Created {dateTime(st.state.createdAt)} · last owner activity {dateTime(st.state.lastActive)}
                </span>
                <span>
                  Recovery:{" "}
                  {st.state.config.trees[RECOVERY_TREE].height
                    ? `yes, full control after ${duration(Number(st.state.config.recoveryDelay))} of inactivity`
                    : "none"}
                  {" · "}Testament:{" "}
                  {st.state.config.heirs.length
                    ? `${st.state.config.heirs.length} heir(s) after ${duration(Number(st.state.config.testamentDelay))}`
                    : "none"}
                  {st.schedules !== null && ` · ${st.schedules} schedule(s)`}
                </span>
                <span>
                  Whitelist: {st.state.config.whitelist.length ? st.state.config.whitelist.map((k) => short(new PublicKey(k).toBase58(), 4)).join(", ") : "none"}
                  {(st.state.config.whitelist.length > 0 || st.state.config.instantLimit > 0n) &&
                    ` · others ${st.state.config.instantLimit > 0n ? `${sol(st.state.config.instantLimit)} SOL/24 h instant, then ` : ""}${
                      st.state.config.slowDelay === 0n ? "refused" : `wait ${duration(Number(st.state.config.slowDelay))}`
                    }`}
                </span>
                {st.state.migrateTo && <span className="text-warn">Migrating to {short(st.state.migrateTo.toBase58(), 5)}</span>}
                {st.state.pending && (
                  <span className="text-warn">
                    Pending {st.state.pending.kind}: {isSol(st.state.pending.mint) ? `${sol(st.state.pending.amount, 9)} SOL` : `${st.state.pending.amount} units`} →{" "}
                    {short(st.state.pending.dest.toBase58(), 4)},{" "}
                    {now >= st.state.pending.executableAt ? "executable now" : `executable in ${duration(st.state.pending.executableAt - now)}`}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-dim">No Noxvault state at this address (not a vault, or not initialized yet).</p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <Label>{k}</Label>
      <div className="mt-1 text-[18px] font-bold">{v}</div>
    </div>
  );
}

function LookupTier({ vault }: { vault: PublicKey }) {
  const { tier, protocol } = useVaultTier(vault);
  return <TierBadge tier={tier} protocol={protocol} />;
}
