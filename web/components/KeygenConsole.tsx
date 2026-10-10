"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildTree, authPath, encodeAction, messageDigest, recoverRoot, sign, treeSeeds, equal } from "@nox/sdk/wots";
import { PROGRAM_ID, SOL_MINT, makeConfig, vaultOf } from "@nox/sdk/client";
import { randomBytes } from "@noble/hashes/utils";
import { Panel } from "./ui";
import { hex, short } from "@/lib/format";

type Line = { t: string; k?: "cmd" | "ok" | "dim" | "moon" };

const ms = (a: number, b: number) => `${(b - a).toFixed(1)} ms`;

function runDemo(): Line[] {
  const out: Line[] = [];
  out.push({ t: "$ nox keygen --demo --vault 0", k: "cmd" });
  const master = randomBytes(32);
  out.push({ t: `master  ${hex(master).slice(0, 16)}…  (32 random bytes, thrown away)`, k: "dim" });
  const seeds = treeSeeds(master, 0);
  // A real vault has 256 one-time keys (height 8); the demo builds 4 so it stays instant.
  const t0 = performance.now();
  const tree = buildTree(seeds, 2);
  const t1 = performance.now();
  const perLeaf = (t1 - t0) / 4;
  out.push({ t: `leaves  4 × (34 × 255) sha-256 .............. ${ms(t0, t1)}` });
  out.push({ t: `full    256 one-time keys ≈ ${((perLeaf * 256) / 1000).toFixed(1)} s, built once in a worker`, k: "dim" });
  out.push({ t: `root    ${hex(tree.root)}`, k: "moon" });
  const vault = vaultOf(makeConfig({ tree: 0, seeds, pub: tree }), PROGRAM_ID);
  out.push({ t: `vault   ${short(vault.toBase58(), 10)}  = PDA("vault", config)` });
  out.push({ t: "$ nox sign --key 0 withdraw 1 SOL", k: "cmd" });
  const action = encodeAction({ kind: "withdraw", mint: SOL_MINT.toBytes(), dest: randomBytes(32), amount: 1_000_000_000n, fee: 0n, feePayee: new Uint8Array(32) });
  const digest = messageDigest(PROGRAM_ID.toBytes(), vault.toBytes(), 0, 0, action);
  const t2 = performance.now();
  const sig = sign(seeds, 0, digest);
  const t3 = performance.now();
  out.push({ t: `sign    34 chains + auth path ............... ${ms(t2, t3)}` });
  const path = authPath(tree, 0);
  const t4 = performance.now();
  const ok = equal(recoverRoot(seeds.pkSeed, 0, digest, sig, path), tree.root);
  const t5 = performance.now();
  out.push({ t: `verify  rebuild leaf + Merkle root .......... ${ms(t4, t5)}` });
  out.push({ t: ok ? "result  root matches → ok" : "result  MISMATCH", k: ok ? "ok" : undefined });
  const bad = new Uint8Array(digest);
  bad[0] ^= 1;
  const okBad = equal(recoverRoot(seeds.pkSeed, 0, bad, sig, path), tree.root);
  out.push({ t: `tamper  flip 1 bit of the message → ${okBad ? "accepted?!" : "rejected"}`, k: okBad ? undefined : "ok" });
  return out;
}

export default function KeygenConsole({ bare = false }: { bare?: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [shown, setShown] = useState(0);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(() => {
    setRunning(true);
    setShown(0);
    if (timer.current) clearInterval(timer.current);
    // let the UI paint before hashing
    setTimeout(() => {
      const l = runDemo();
      setLines(l);
      let n = 0;
      timer.current = setInterval(() => {
        n++;
        setShown(n);
        if (n >= l.length) {
          if (timer.current) clearInterval(timer.current);
          setRunning(false);
        }
      }, 120);
    }, 60);
  }, []);

  useEffect(() => {
    run();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [run]);

  const color = (k?: Line["k"]) =>
    k === "cmd" ? "text-bone" : k === "ok" ? "text-teal" : k === "moon" ? "text-teal/90" : k === "dim" ? "text-dim" : "text-mute";

  const body = (
    <div className={`${bare ? "h-full min-h-[280px]" : "h-[312px]"} overflow-hidden px-4 py-3 text-[11.5px] leading-[1.75] sm:text-[12px]`}>
      {lines.slice(0, shown).map((l, i) => (
        <div key={i} className={`truncate ${color(l.k)}`}>
          {l.t}
        </div>
      ))}
      <div className="flex items-center justify-between text-bone">
        <span>
          {running ? "" : "$ "}
          <span className="blink">▍</span>
        </span>
        {bare && (
          <button className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-teal disabled:opacity-40" onClick={run} disabled={running}>
            [{running ? "running" : "run again"}]
          </button>
        )}
      </div>
    </div>
  );
  if (bare) return body;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-line-2" />
          <span className="inline-block h-2 w-2 rounded-full bg-line-2" />
          <span className="inline-block h-2 w-2 rounded-full bg-teal" />
          <span className="ml-2">console // runs in your browser</span>
        </span>
      }
      right={
        <button className="text-[10px] uppercase tracking-[0.18em] text-dim hover:text-teal disabled:opacity-40" onClick={run} disabled={running}>
          [{running ? "running" : "run again"}]
        </button>
      }
    >
      {body}
    </Panel>
  );
}
