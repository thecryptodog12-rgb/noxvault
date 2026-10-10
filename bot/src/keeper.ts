// Long-running Noxvault keeper: runs one keeper pass (web/lib/keeper.ts) every
// KEEPER_INTERVAL_SECONDS (default 60). Bundled by scripts/build-keeper.mjs into dist/keeper.cjs,
// because it shares its logic with the web app's /api/keeper cron.
//   KEEPER_SECRET_KEY=... RPC_URL=... pnpm keeper          (add -- --once for a single pass)
import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { idl, type Noxvault } from "@nox/sdk/client";
import { runKeeper } from "../../web/lib/keeper";
import { loadKeeperConfig } from "./keeper-config";

function keypairWallet(kp: Keypair): Wallet {
  const signOne = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => signOne(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs.map(signOne),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = loadKeeperConfig();
  const payer = Keypair.fromSecretKey(cfg.secretKey);
  const conn = new Connection(cfg.rpcUrl, { commitment: "confirmed" });
  const theIdl = cfg.programId ? { ...(idl as object), address: new PublicKey(cfg.programId).toBase58() } : idl;
  const program = new Program<Noxvault>(theIdl as unknown as Noxvault, new AnchorProvider(conn, keypairWallet(payer), { commitment: "confirmed" }));
  console.log(`[keeper] ${payer.publicKey.toBase58()} on ${cfg.rpcUrl}, program ${program.programId.toBase58()}, every ${cfg.intervalSeconds}s`);

  let stop = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      console.log(`[keeper] ${sig}: stopping after this pass`);
      stop = true;
    });

  while (!stop) {
    const started = Date.now();
    try {
      const balance = await conn.getBalance(payer.publicKey, "confirmed");
      if (balance < 10_000_000) console.warn(`[keeper] low balance: ${balance / 1e9} SOL`);
      const r = await runKeeper(program, payer, { maxTx: cfg.maxTx, log: (l) => console.log(`[keeper] ${l}`) });
      const ok = r.steps.filter((s) => s.ok).length;
      console.log(
        `[keeper] pass ${r.ms}ms: canary ${r.canary ? (r.canary.tripped ? "TRIPPED" : "intact") : "n/a"}, ${r.links} links, ${r.vaults} vaults, ${ok}/${r.steps.length} tx ok${r.truncated ? " (truncated)" : ""}`
      );
      for (const e of r.errors) console.warn(`[keeper] error: ${e}`);
    } catch (e) {
      console.error(`[keeper] pass failed: ${(e as Error)?.message ?? e}`);
    }
    if (cfg.once) break;
    const wait = cfg.intervalSeconds * 1000 - (Date.now() - started);
    for (let t = 0; t < wait && !stop; t += 1000) await sleep(Math.min(1000, wait - t));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
