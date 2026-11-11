// Recent activity of a wallet: its last signatures, each read as "sent / received SOL or a token" from
// the balance changes the transaction caused for this owner (pre/post balances), like a simple Phantom
// history. Anything else (swaps, program calls) shows as "interaction" with the net SOL change.
import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";

export interface TokenDelta {
  mint: string;
  /** base units, signed decimal string */
  delta: string;
  decimals: number;
}

export interface WalletTx {
  sig: string;
  at: number | null;
  ok: boolean;
  kind: "sent" | "received" | "interaction" | "failed";
  /** lamports, signed; the network fee is not counted when this wallet paid it */
  solDelta: number;
  /** lamports this wallet paid as the transaction fee (0 when someone else paid) */
  fee: number;
  tokens: TokenDelta[];
  /** the other side of a simple transfer, when it is clear */
  counterparty?: string;
}

/** Pure: what one parsed transaction did to `owner`. */
export function parseWalletTx(sig: string, tx: ParsedTransactionWithMeta | null, owner: string, blockTime?: number | null): WalletTx {
  const base: WalletTx = { sig, at: tx?.blockTime ?? blockTime ?? null, ok: !!tx && !tx.meta?.err, kind: "interaction", solDelta: 0, fee: 0, tokens: [] };
  if (!tx || !tx.meta) return { ...base, ok: false, kind: "interaction" };
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : "pubkey" in k ? k.pubkey.toBase58() : String(k)));
  const i = keys.indexOf(owner);
  const feePayer = keys[0];
  const fee = feePayer === owner ? tx.meta.fee : 0;
  const solDelta = i >= 0 ? tx.meta.postBalances[i] - tx.meta.preBalances[i] + fee : 0;
  // token balance changes of accounts owned by `owner`
  const deltas = new Map<string, { d: bigint; decimals: number }>();
  const add = (list: typeof tx.meta.preTokenBalances, sign: 1n | -1n) => {
    for (const b of list ?? []) {
      if (b.owner !== owner) continue;
      const cur = deltas.get(b.mint) ?? { d: 0n, decimals: b.uiTokenAmount.decimals };
      cur.d += sign * BigInt(b.uiTokenAmount.amount);
      deltas.set(b.mint, cur);
    }
  };
  add(tx.meta.postTokenBalances, 1n);
  add(tx.meta.preTokenBalances, -1n);
  const tokens = [...deltas.entries()].filter(([, v]) => v.d !== 0n).map(([mint, v]) => ({ mint, delta: v.d.toString(), decimals: v.decimals }));
  if (tx.meta.err) return { ...base, ok: false, kind: "failed", solDelta: 0, fee, tokens: [] };

  // A plain transfer: one asset moved, in or out (ATA creation rent for the recipient also counts as sent).
  const solOnly = tokens.length === 0 && solDelta !== 0;
  const oneToken = tokens.length === 1;
  let kind: WalletTx["kind"] = "interaction";
  let counterparty: string | undefined;
  if (solOnly || oneToken) {
    const out = oneToken ? BigInt(tokens[0].delta) < 0n : solDelta < 0;
    kind = out ? "sent" : "received";
    counterparty = counterpartyOf(tx, owner, out);
  }
  return { ...base, kind, solDelta, fee, tokens, counterparty };
}

/** For a system / token transfer: the other wallet named in the instruction. */
function counterpartyOf(tx: ParsedTransactionWithMeta, owner: string, out: boolean): string | undefined {
  for (const ix of tx.transaction.message.instructions) {
    const p = (ix as { parsed?: { type?: string; info?: Record<string, string> } }).parsed;
    if (!p?.info) continue;
    if (p.type === "transfer" && p.info.source && p.info.destination && p.info.lamports !== undefined) return out ? p.info.destination : p.info.source;
    if ((p.type === "transfer" || p.type === "transferChecked") && (p.info.authority || p.info.multisigAuthority)) {
      if (!out) return p.info.authority ?? p.info.multisigAuthority;
      // the destination is a token account; its owner is in the post token balances
      const destIdx = tx.transaction.message.accountKeys.findIndex((k) => ("pubkey" in k ? k.pubkey.toBase58() : String(k)) === p.info!.destination);
      const owner2 = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === destIdx)?.owner;
      if (owner2 && owner2 !== owner) return owner2;
    }
  }
  return undefined;
}

/** The last `limit` transactions of a wallet, parsed. Sequential reads: public RPCs refuse big batches. */
export async function walletActivity(conn: Connection, owner: PublicKey, limit = 10): Promise<WalletTx[]> {
  const sigs = await conn.getSignaturesForAddress(owner, { limit }, "confirmed");
  const out: WalletTx[] = [];
  for (const s of sigs) {
    let tx: ParsedTransactionWithMeta | null = null;
    try {
      tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    } catch {
      /* show the signature without details */
    }
    const w = parseWalletTx(s.signature, tx, owner.toBase58(), s.blockTime);
    if (!tx) w.ok = !s.err;
    out.push(w);
  }
  return out;
}
