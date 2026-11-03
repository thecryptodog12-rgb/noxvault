// Relayer: sends a user's already-signed action as fee payer and is repaid by the vault
// (docs/SPEC.md §7). It never sees a secret and cannot change the action: it is signed.
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import type { Noxvault } from "./idl/noxvault";
import {
  DURESS_TREE,
  SignedAction,
  SOL_MINT,
  treeOf,
  TIER_SENTINEL,
  fetchProtocol,
  vaultTier,
  actionDigest,
  completesApproval,
  buildSteps,
  fetchState,
  leafUsed,
  mintTokenProgram,
  packSteps,
  remainingSteps,
} from "./client";
import { Action, KIND_TAGS, LEN, N, encodeAction, equal, recoverRoot } from "./wots";

/** JSON shape of a relay request: bytes as hex, keys as base58, amounts as decimal strings. */
export interface RelayRequest {
  vault: string;
  tree: number;
  leaf: number;
  pkSeed: string;
  authPath: string[];
  signature: string[];
  action: Record<string, string | number> & { kind: Action["kind"] };
}

export interface RelayPolicy {
  /** Lowest fee accepted, in lamports. Covers a few transaction fees with a margin. */
  minFee: bigint;
  /** Relay Sentinel-tier vaults ($NOX held in the vault) for free. Default true. */
  sentinelFree?: boolean;
}

const fromHex = (h: string, len?: number) => {
  if (!/^[0-9a-f]*$/i.test(h) || h.length % 2 || (len && h.length !== len * 2)) throw new Error("bad hex");
  return Uint8Array.from(Buffer.from(h, "hex"));
};

const KEY_FIELDS = new Set(["mint", "dest", "vote", "session", "newVault", "feePayee"]);
const BIG_FIELDS = new Set(["amount", "interval", "start", "limit", "period", "expires", "fee"]);
const NUM_FIELDS = new Set(["seed", "id", "count"]);

export function encodeRelayRequest(s: SignedAction): RelayRequest {
  const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
  const a: Record<string, string | number> = { kind: s.action.kind };
  for (const [k, v] of Object.entries(s.action)) {
    if (k === "kind") continue;
    a[k] = v instanceof Uint8Array ? new PublicKey(v).toBase58() : typeof v === "bigint" ? v.toString() : (v as number);
  }
  return {
    vault: s.vault.toBase58(),
    tree: s.tree,
    leaf: s.leaf,
    pkSeed: hex(s.pkSeed),
    authPath: s.authPath.map(hex),
    signature: s.signature.map(hex),
    action: a as RelayRequest["action"],
  };
}

export function decodeRelayRequest(r: RelayRequest): SignedAction {
  if (!r.action || !KIND_TAGS.includes(r.action.kind)) throw new Error("unknown action");
  const action: Record<string, unknown> = { kind: r.action.kind };
  for (const [k, v] of Object.entries(r.action)) {
    if (k === "kind") continue;
    if (KEY_FIELDS.has(k)) action[k] = new PublicKey(String(v)).toBytes();
    else if (BIG_FIELDS.has(k)) {
      if (!/^-?\d+$/.test(String(v))) throw new Error(`bad ${k}`);
      action[k] = BigInt(String(v));
    } else if (NUM_FIELDS.has(k)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`bad ${k}`);
      action[k] = n;
    } else throw new Error(`unexpected field ${k}`);
  }
  encodeAction(action as Action); // throws if a field is missing
  if (!Number.isInteger(r.tree) || r.tree < 0 || r.tree > DURESS_TREE) throw new Error("bad tree");
  if (!Number.isInteger(r.leaf) || r.leaf < 0 || r.leaf > 255) throw new Error("bad leaf");
  if (!Array.isArray(r.signature) || r.signature.length !== LEN) throw new Error("bad signature");
  if (!Array.isArray(r.authPath) || r.authPath.length > 8) throw new Error("bad auth path");
  return {
    vault: new PublicKey(r.vault),
    tree: r.tree,
    leaf: r.leaf,
    pkSeed: fromHex(r.pkSeed, N),
    authPath: r.authPath.map((h) => fromHex(h, N)),
    signature: r.signature.map((h) => fromHex(h, N)),
    action: action as Action,
  };
}

/**
 * Checks a signed action off-chain before spending anything on it. Returns the reason it would
 * be refused, or null. Everything here is re-checked on chain; this only protects the relayer.
 */
export async function checkRelay(program: Program<Noxvault>, relayer: PublicKey, s: SignedAction, policy: RelayPolicy): Promise<string | null> {
  const conn = program.provider.connection;
  const state = await fetchState(program, s.vault);
  if (!state) return "vault not initialized";
  if (s.tree < 0 || s.tree > DURESS_TREE) return "wrong tree";
  const { root, height } = treeOf(state.config, s.tree);
  if (!height || s.authPath.length !== height) return "wrong tree";
  if (leafUsed(state, s.tree, s.leaf)) return "one-time key already used";
  const digest = actionDigest(program.programId, s.vault, s.tree, s.leaf, s.action);
  if (!equal(recoverRoot(s.pkSeed, s.leaf, digest, s.signature, s.authPath), root)) return "signature does not match this vault";

  const free = await relaysFree(program, s.vault, policy);
  if (!free) {
    if (!equal(s.action.feePayee, relayer.toBytes())) return `fee must be paid to ${relayer.toBase58()}`;
    if (s.action.fee < policy.minFee) return `fee must be at least ${policy.minFee} lamports`;
  }
  const lamports = BigInt(await conn.getBalance(s.vault, "confirmed"));
  // A duress withdrawal is capped on chain, so its amount is not checked here.
  const solOut = s.action.fee + (s.tree !== DURESS_TREE && s.action.kind === "withdraw" && new PublicKey(s.action.mint).equals(SOL_MINT) ? s.action.amount : 0n);
  if (solOut > lamports) return "vault cannot pay this";
  return null;
}

/** Sentinel-tier vaults relay for free (docs/SPEC.md §10); tiers come from $NOX held in the vault. */
async function relaysFree(program: Program<Noxvault>, vault: PublicKey, policy: RelayPolicy): Promise<boolean> {
  if (policy.sentinelFree === false) return false;
  const p = await fetchProtocol(program);
  if (!p || p.noxMint.equals(PublicKey.default)) return false;
  return (await vaultTier(program, vault, p)).tier === TIER_SENTINEL;
}

/** Checks, then sends the action as fee payer. Safe to call again with the same request. */
export async function relay(program: Program<Noxvault>, relayer: Keypair, s: SignedAction, policy: RelayPolicy): Promise<string[]> {
  const why = await checkRelay(program, relayer.publicKey, s, policy);
  if (why) throw new Error(why);
  const conn = program.provider.connection;
  const tokenProgram =
    s.action.kind === "withdraw" && !new PublicKey(s.action.mint).equals(SOL_MINT)
      ? await mintTokenProgram(conn, new PublicKey(s.action.mint))
      : undefined;
  const tokenProgramFor = tokenProgram;
  const status = await completesApproval(program, s.vault, s.tree, s.action);
  const steps = await buildSteps(program, relayer.publicKey, s, { tokenProgram: tokenProgramFor, execute: status.willExecute, creator: status.creator ?? relayer.publicKey });
  const todo = await remainingSteps(program, relayer.publicKey, s, steps);
  const sigs: string[] = [];
  for (const t of packSteps(relayer.publicKey, todo)) {
    for (let attempt = 1; ; attempt++) {
      try {
        const tx = new Transaction().add(...t.instructions);
        tx.feePayer = relayer.publicKey;
        sigs.push(await sendAndConfirmTransaction(conn, tx, [relayer], { commitment: "confirmed" }));
        break;
      } catch (e) {
        if (attempt >= 4 || !/Blockhash not found|block height exceeded/.test(String(e))) throw e;
      }
    }
  }
  return sigs;
}
