"use client";
import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { fetchState, findVaultsFor, inSlot, withRetry, type Signer, type VaultStateView } from "@nox/sdk/client";
import { equal } from "@nox/sdk/wots";
import { Empty, Label, Note, PageHead, Panel } from "@/components/ui";
import SecretInput from "@/components/SecretInput";
import TreeProgress from "@/components/vault/TreeProgress";
import VaultView from "@/components/vault/VaultView";
import { useNox } from "@/lib/hooks";
import { getSigner } from "@/lib/trees";
import { errMsg } from "@/lib/format";
import { forgetWords } from "@/lib/secret";
import { NETWORK } from "@/lib/config";

interface Found {
  n: number;
  signer: Signer;
  state: VaultStateView;
}

const MAX_NUMBERS = 16;

export default function MyVaults() {
  const { program, deployed } = useNox();
  const [master, setMaster] = useState<Uint8Array | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [progress, setProgress] = useState<{ n: number; done: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);

  const scan = useCallback(
    async (m: Uint8Array) => {
      setScanning(true);
      setScanErr(null);
      setScanned(false);
      setFound([]);
      const out: Found[] = [];
      try {
        for (let n = 0; n < MAX_NUMBERS; n++) {
          const signer = await getSigner(m, n, 0, (done, total) => setProgress({ n, done, total }));
          const states = await withRetry(() => findVaultsFor(program, signer));
          if (!states.length) break;
          for (const { state, slot } of states) out.push({ n, signer: inSlot(signer, slot), state });
          setFound([...out]);
        }
        setScanned(true);
      } catch (e) {
        setScanErr(errMsg(e));
      } finally {
        setProgress(null);
        setScanning(false);
      }
    },
    [program]
  );

  const start = (m: Uint8Array) => {
    setMaster(m);
    scan(m);
  };

  return (
    <div>
      <PageHead
        kicker="02 // my vaults"
        title={
          <>
            My <span className="inv">vaults</span>
          </>
        }
        sub="Your phrase finds your vaults: the browser builds the one-time key tree for vault number 0, 1, 2… and asks the chain which vaults use it, as owner or as a co-signer."
      />

      {!master ? (
        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
          <Panel title="enter your 24 words">
            <div className="p-4 sm:p-5">
              <SecretInput cta="find my vaults" onSecret={(m) => start(m)} />
            </div>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel title="how it works" className="text-[12.5px]">
              <p className="p-4 text-mute">
                A vault has one fixed address and 256 one-time keys per signer, arranged in a Merkle tree. Building that tree takes a few
                seconds the first time; only its public part is cached on this device. Before any action, the app reads the
                vault&apos;s whole history; if a key ever published part of a signature, only that same action can be completed with
                it.
              </p>
            </Panel>
            <Note>
              No vault yet? <Link href="/create" className="underline">Create one</Link>. Holding someone&apos;s recovery phrase? Use{" "}
              <Link href="/recovery" className="underline">recovery</Link>.
            </Note>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {deployed === false && <Note kind="warn">The Noxvault program is not deployed on {NETWORK}; nothing can be found or signed.</Note>}

          <Panel
            title="search"
            right={
              <div className="flex gap-4">
                <button className="text-[10.5px] uppercase tracking-[0.14em] text-dim hover:text-teal disabled:opacity-40" disabled={scanning} onClick={() => scan(master)}>
                  [{scanning ? "scanning" : "rescan"}]
                </button>
                <button
                  className="text-[10.5px] uppercase tracking-[0.14em] text-dim hover:text-bad"
                  onClick={() => {
                    forgetWords();
                    setMaster(null);
                    setFound([]);
                  }}
                >
                  [lock & forget]
                </button>
              </div>
            }
          >
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              {progress && <TreeProgress label={`vault number ${progress.n}`} done={progress.done} total={progress.total} />}
              {scanning && !progress && (
                <div className="text-[12.5px] text-mute">
                  asking the chain<span className="blink">…</span>
                </div>
              )}
              {scanErr && (
                <div className="flex flex-col gap-3">
                  <Note kind="warn">
                    Could not search the chain ({scanErr}). Searching needs an RPC that allows getProgramAccounts. You can still open a
                    vault by its address.
                  </Note>
                </div>
              )}
              {scanned && found.length === 0 && (
                <Empty title="no vaults found">
                  These words have no initialized vaults on {NETWORK}. <Link href="/create" className="underline">Create one</Link>, or open
                  one by its address below.
                </Empty>
              )}
              {(scanErr || scanned) && <OpenByAddress master={master} onFound={(f) => setFound((x) => (x.some((y) => y.state.vault.equals(f.state.vault)) ? x : [...x, f]))} />}
            </div>
          </Panel>

          {found.map((f) => (
            <VaultView key={f.state.vault.toBase58()} vault={f.state.vault} initialState={f.state} signer={f.signer} title={`VAULT #${f.n}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function OpenByAddress({ master, onFound }: { master: Uint8Array; onFound: (f: Found) => void }) {
  const { program } = useNox();
  const [addr, setAddr] = useState("");
  const [n, setN] = useState("0");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      let vault: PublicKey;
      try {
        vault = new PublicKey(addr.trim());
      } catch {
        throw new Error("Not a valid address");
      }
      const num = Number(n);
      if (!Number.isInteger(num) || num < 0 || num > 10000) throw new Error("Vault number must be 0 or more");
      const state = await withRetry(() => fetchState(program, vault));
      if (!state) throw new Error("No initialized Noxvault at this address");
      const tree = await getSigner(master, num, 0, (done, total) => setProgress({ done, total }));
      const slot = [0, 1, 2].find((t) => equal(state.config.trees[t].root, tree.pub.root));
      if (slot === undefined) throw new Error(`These words (vault number ${num}) are not a signer of this vault`);
      onFound({ n: num, signer: inSlot(tree, slot), state });
      setAddr("");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line pt-4">
      <Label>open by vault address</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" placeholder="vault address" value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} />
        <input className="field sm:w-28" placeholder="number" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} aria-label="Vault number" />
        <button className="btn" type="submit" disabled={busy || !addr}>
          {busy ? "checking…" : "open"}
        </button>
      </div>
      {progress && <TreeProgress label={`vault number ${n}`} done={progress.done} total={progress.total} />}
      {err && <div className="text-[12px] text-bad">✕ {err}</div>}
    </form>
  );
}
