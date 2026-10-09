// End-to-end check against a live cluster: fund a fresh vault, register it, unlock part of it.
import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { idl, newMasterSecret, planUnlock, recordPda, scanVaults, vaultKey, Noxvault } from "../sdk/client";

async function main() {
  // "confirmed" blockhashes: a "processed" one is often unknown to the node that simulates.
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(env.connection.rpcEndpoint, "confirmed"),
    env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  const program = new anchor.Program<Noxvault>(idl as Noxvault, provider);
  const payer = provider.wallet.publicKey;
  // Public RPCs sometimes simulate against a lagging node ("Blockhash not found"); every step is retry-safe.
  const send = async (tx: Transaction): Promise<string> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      } catch (e) {
        if (attempt >= 4 || !/Blockhash not found|block height exceeded/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  };
  const master = newMasterSecret();
  const k0 = vaultKey(master, 0);
  const k1 = vaultKey(master, 1);

  await send(new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: k0.vault, lamports: 0.05 * LAMPORTS_PER_SOL }),
    await program.methods.register(Array.from(k0.root)).accountsPartial({ payer, vault: k0.vault, record: recordPda(k0.vault) }).instruction()
  ));
  console.log("vault", k0.vault.toBase58(), "funded + registered");

  const plan = await planUnlock({ program, payer, key: k0, next: k1.vault, dest: payer, amount: BigInt(0.01 * LAMPORTS_PER_SOL) });
  for (const t of plan.transactions) console.log(t.label, await send(new Transaction().add(...t.instructions)));

  const { vaults } = await scanVaults(program, master);
  for (const v of vaults) console.log(`#${v.index} ${v.vault.toBase58()} ${v.lamports / LAMPORTS_PER_SOL} SOL ${v.spent ? "spent" : "sealed"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
