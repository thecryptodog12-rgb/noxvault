"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { recordPda, spentPda } from "@nox/sdk/client";
import { Copy, Empty, Label, Note, PageHead, Panel, Status } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { errMsg, short, sol, timeAgo } from "@/lib/format";
import { explorerUrl, NETWORK } from "@/lib/config";
import { vaultAssets, type VaultAssets } from "@/lib/unlock";

interface Rec {
  vault: PublicKey;
  createdAt: number;
}
interface Sp {
  vault: PublicKey;
  successor: PublicKey;
  mint: PublicKey;
  dest: PublicKey;
  amount: bigint;
  slot: number;
}

export default function Explorer() {
  const { connection, program, deployed } = useNox();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [spents, setSpents] = useState<Sp[] | null>(null);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [r, s] = await Promise.all([program.account.record.all(), program.account.spent.all()]);
        if (!live) return;
        const recs = r
          .map((x) => ({ vault: x.account.vault, createdAt: Number(x.account.createdAt.toString()) }))
          .sort((a, b) => b.createdAt - a.createdAt);
        const sps = s
          .map((x) => ({
            vault: x.account.vault,
            successor: x.account.successor,
            mint: x.account.mint,
            dest: x.account.dest,
            amount: BigInt(x.account.amount.toString()),
            slot: Number(x.account.slot.toString()),
          }))
          .sort((a, b) => b.slot - a.slot);
        setRecords(recs);
        setSpents(sps);
        const keys = recs.map((x) => x.vault);
        const m = new Map<string, number>();
        for (let i = 0; i < keys.length; i += 100) {
          const infos = await connection.getMultipleAccountsInfo(keys.slice(i, i + 100));
          infos.forEach((inf, k) => m.set(keys[i + k].toBase58(), inf?.lamports ?? 0));
        }
        if (live) setBalances(m);
      } catch (e) {
        if (!live) return;
        setErr(errMsg(e));
        setRecords([]);
        setSpents([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [program, connection]);

  const spentSet = useMemo(() => new Map((spents ?? []).map((s) => [s.vault.toBase58(), s])), [spents]);
  const locked = useMemo(
    () => (records ?? []).reduce((t, r) => t + (spentSet.has(r.vault.toBase58()) ? 0 : balances.get(r.vault.toBase58()) ?? 0), 0),
    [records, balances, spentSet]
  );
  const loading = records === null;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        kicker="03 // explorer"
        title={
          <>
            Vault <span className="inv">explorer</span>
          </>
        }
        sub="Vaults that chose to register, and every key that has been spent. Registering is optional, so this is not every Noxvault in existence."
      />

      <Lookup initial={q} />
      {q && <LookupResult key={q} q={q} />}

      <div className="grid [&>*]:min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
        <Tile k="listed vaults" v={loading ? "…" : String(records!.length)} />
        <Tile k="sol locked" v={loading ? "…" : sol(locked, 2)} />
        <Tile k="unlocks" v={loading ? "…" : String(spents!.length)} />
        <Tile k="network" v={NETWORK} />
      </div>

      {err && (
        <Note kind={deployed === false ? "warn" : "bad"}>
          {deployed === false
            ? `The Noxvault program is not deployed on ${NETWORK} yet, so there is nothing to list.`
            : `Could not load accounts: ${err}`}
        </Note>
      )}

      <div className="grid [&>*]:min-w-0 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="vaults">
          {loading ? (
            <Empty title="loading…" />
          ) : records!.length === 0 ? (
            <Empty title="no listed vaults">
              {deployed === false ? "Waiting for the program to go live." : "Nobody has registered a vault yet. Be the first from the create page."}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl min-w-[520px]">
                <thead>
                  <tr>
                    <th>vault</th>
                    <th>status</th>
                    <th className="!text-right">balance</th>
                    <th className="!text-right">listed</th>
                  </tr>
                </thead>
                <tbody>
                  {records!.map((r) => {
                    const a = r.vault.toBase58();
                    const s = spentSet.get(a);
                    return (
                      <tr key={a}>
                        <td>
                          <a href={`/vaults?q=${a}`} className="hover:text-teal">
                            {short(a, 6)}
                          </a>
                        </td>
                        <td>
                          <Status kind={s ? "spent" : "sealed"} />
                        </td>
                        <td className="text-right">{sol(balances.get(a) ?? 0)} SOL</td>
                        <td className="text-right text-dim">{timeAgo(r.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="recent unlocks">
          {loading ? (
            <Empty title="loading…" />
          ) : spents!.length === 0 ? (
            <Empty title="no unlocks yet">No key has been spent yet.</Empty>
          ) : (
            <ul className="divide-y divide-dashed divide-line">
              {spents!.slice(0, 20).map((s) => (
                <li key={s.vault.toBase58()} className="px-4 py-3 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <a href={`/vaults?q=${s.vault.toBase58()}`} className="hover:text-teal">
                      {short(s.vault.toBase58(), 5)}
                    </a>
                    <span className="text-dim">slot {s.slot.toLocaleString("en-US")}</span>
                  </div>
                  <div className="mt-1 text-dim">
                    {s.mint.equals(PublicKey.default) ? `${sol(s.amount)} SOL` : `${s.amount.toString()} units ${short(s.mint.toBase58(), 3)}`} →{" "}
                    {short(s.dest.toBase58(), 4)} · rest → {short(s.successor.toBase58(), 4)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <Panel className="p-4">
      <Label>{k}</Label>
      <div className="font-display mt-2 truncate text-[22px] uppercase">{v}</div>
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
      <input
        className="field flex-1"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="look up a vault address"
        spellCheck={false}
        aria-label="Vault address"
      />
      <button className="btn" type="submit">
        look up
      </button>
    </form>
  );
}

function LookupResult({ q }: { q: string }) {
  const { connection, program } = useNox();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "bad"; text: string }
    | { kind: "ok"; vault: PublicKey; assets: VaultAssets; listed: boolean; spent: Sp | null }
  >({ kind: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      let vault: PublicKey;
      try {
        vault = new PublicKey(q);
      } catch {
        setState({ kind: "bad", text: "That is not a valid Solana address." });
        return;
      }
      try {
        const [assets, rec, sp] = await Promise.all([
          vaultAssets(connection, vault),
          connection.getAccountInfo(recordPda(vault, program.programId)),
          program.account.spent.fetchNullable(spentPda(vault, program.programId)).catch(() => null),
        ]);
        if (!live) return;
        setState({
          kind: "ok",
          vault,
          assets,
          listed: !!rec,
          spent: sp
            ? {
                vault,
                successor: sp.successor,
                mint: sp.mint,
                dest: sp.dest,
                amount: BigInt(sp.amount.toString()),
                slot: Number(sp.slot.toString()),
              }
            : null,
        });
      } catch (e) {
        if (live) setState({ kind: "bad", text: errMsg(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [q, connection, program]);

  return (
    <Panel lit title={`lookup // ${short(q, 8)}`}>
      <div className="p-4 sm:p-5">
        {state.kind === "loading" ? (
          <div className="text-[13px] text-mute">
            reading the chain<span className="blink">…</span>
          </div>
        ) : state.kind === "bad" ? (
          <Note kind="bad">{state.text}</Note>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Status kind={state.spent ? "spent" : state.assets.lamports > 0 || state.assets.tokens.length ? "sealed" : "empty"} />
              <a href={explorerUrl(state.vault.toBase58())} target="_blank" rel="noreferrer" className="break-all text-[13px] hover:text-teal">
                {state.vault.toBase58()}
              </a>
              <Copy value={state.vault.toBase58()} />
            </div>
            <div className="grid [&>*]:min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label>sol</Label>
                <div className="font-display mt-1 text-[18px]">{sol(state.assets.lamports)}</div>
              </div>
              <div>
                <Label>token accounts</Label>
                <div className="font-display mt-1 text-[18px]">{state.assets.tokens.length}</div>
              </div>
              <div>
                <Label>listed</Label>
                <div className="font-display mt-1 text-[18px]">{state.listed ? "yes" : "no"}</div>
              </div>
              <div>
                <Label>key</Label>
                <div className="font-display mt-1 text-[18px]">{state.spent ? "spent" : "unused"}</div>
              </div>
            </div>
            {state.spent && (
              <div className="text-[12px] text-mute">
                Unlocked at slot {state.spent.slot.toLocaleString("en-US")}. Anything still here, or sent later, can be swept to{" "}
                <a className="text-bone hover:text-teal" href={`/vaults?q=${state.spent.successor.toBase58()}`}>
                  {short(state.spent.successor.toBase58(), 6)}
                </a>
                .
              </div>
            )}
            {!state.listed && !state.spent && (
              <p className="text-[11.5px] text-dim">
                Not registered. Any address can be looked up; only its owner&apos;s 24 words can tell whether it is a Noxvault.
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
