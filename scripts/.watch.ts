import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { idl, Noxvault, fetchState, vaultStakes } from "../sdk/client";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const program = new anchor.Program<Noxvault>(idl as Noxvault, new anchor.AnchorProvider(conn, new anchor.Wallet(Keypair.generate()), {}));
const vault = new PublicKey(process.argv[2]);
(async () => {
  const st = await fetchState(program, vault);
  console.log("balance:", (await conn.getBalance(vault)) / 1e9, "SOL");
  if (!st) { console.log("state: NOT initialized"); }
  else {
    const used = [...st.usedPrimary].reduce((n, b) => n + b.toString(2).split("1").length - 1, 0);
    console.log("state: initialized", new Date(st.createdAt * 1000).toISOString(), "| actions", st.actions, "| keys used", used,
      "| recovery", st.config.recoveryHeight ? `yes (delay ${Number(st.config.recoveryDelay) / 86400} d)` : "no",
      "| whitelist", st.config.whitelist.map((k) => new PublicKey(k).toBase58()).join(",") || "none",
      "| slow delay", Number(st.config.slowDelay), "s | pending", st.pending ? `${Number(st.pending.amount) / 1e9} → ${st.pending.dest.toBase58()} at ${new Date(st.pending.executableAt * 1000).toISOString()}` : "none");
    console.log("stakes:", (await vaultStakes(program, vault)).filter(Boolean).map((s) => `#${s!.seed} ${s!.lamports / 1e9}`).join(", ") || "none");
  }
  const sigs = await conn.getSignaturesForAddress(vault, { limit: 8 });
  for (const s of sigs) console.log(new Date((s.blockTime ?? 0) * 1000).toISOString().slice(11, 19), s.err ? "FAILED" : "ok    ", s.signature.slice(0, 20) + "…");
})();
