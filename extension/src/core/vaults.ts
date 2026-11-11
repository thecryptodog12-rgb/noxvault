// Vault-level chain operations for the wallet UI: find a phrase's vaults (port of web/app/mine/
// MyVaults.tsx `scan`), initialize a vault (SetupVault `initAndDeposit` without the deposit, paid by
// the fee account), execute a due pending payout (the site's useRunner + sdk executePendingIx), and
// recent activity. Everything signed here is signed by the fee account, never by a WOTS key.
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import {
  DURESS_TREE,
  SOL_MINT,
  executePendingIx,
  fetchState,
  findVaultsFor,
  initVaultIx,
  inSlot,
  mintTokenProgram,
  withRetry,
  type Config,
  type Noxvault,
  type Signer,
  type VaultStateView,
} from "../../../sdk/client";
import { sendIxs } from "../../../web/lib/unlock";
import { keypairSender } from "./feeAccount";

export interface Found {
  n: number;
  signer: Signer;
  state: VaultStateView;
}

const MAX_NUMBERS = 16;

/** MyVaults `scan`: vault numbers 0, 1, 2… until one has no vault; a phrase with none may be a duress phrase. */
export async function discoverVaults(program: Program<Noxvault>, signerFor: (n: number, slot: number) => Promise<Signer>, onNumber?: (n: number) => void): Promise<Found[]> {
  const out: Found[] = [];
  for (let n = 0; n < MAX_NUMBERS; n++) {
    onNumber?.(n);
    const signer = await signerFor(n, 0);
    const states = await withRetry(() => findVaultsFor(program, signer));
    if (!states.length) break;
    for (const { state, slot } of states) out.push({ n, signer: inSlot(signer, slot), state });
  }
  if (!out.length) {
    const d = await signerFor(0, DURESS_TREE);
    const states = await withRetry(() => findVaultsFor(program, d));
    for (const { state } of states) out.push({ n: 0, signer: d, state });
  }
  return out;
}

/** One transaction from the fee account: initialize the vault (pays rent, and the creation fee on the Free tier). */
export async function initWithFeeAccount(program: Program<Noxvault>, fee: Keypair, config: Config): Promise<string> {
  const conn = program.provider.connection;
  return sendIxs(conn, fee.publicKey, keypairSender(fee), [await initVaultIx(program, fee.publicKey, config)]);
}

/** Executes a due pending withdrawal / migration (permissionless; the fee account pays the network fee). */
export async function executePending(program: Program<Noxvault>, fee: Keypair, vault: PublicKey): Promise<string> {
  const conn = program.provider.connection;
  const state = await fetchState(program, vault);
  if (!state?.pending) throw new Error("Nothing is pending");
  if (Math.floor(Date.now() / 1000) < state.pending.executableAt) throw new Error("It is not due yet");
  const p = state.pending;
  const tp = p.kind === "withdraw" && !p.mint.equals(SOL_MINT) ? await mintTokenProgram(conn, p.mint) : undefined;
  return sendIxs(conn, fee.publicKey, keypairSender(fee), [await executePendingIx(program, fee.publicKey, vault, state, tp)]);
}

export interface Activity {
  sig: string;
  at: number | null;
  ok: boolean;
}

export async function recentActivity(conn: Connection, vault: PublicKey, limit = 8): Promise<Activity[]> {
  const sigs = await withRetry(() => conn.getSignaturesForAddress(vault, { limit }, "confirmed"));
  return sigs.map((s) => ({ sig: s.signature, at: s.blockTime ?? null, ok: !s.err }));
}
