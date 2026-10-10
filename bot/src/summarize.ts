import type { VersionedTransactionResponse } from "@solana/web3.js";
import type { Network } from "./config.js";

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  /** raw integer amount as a string */
  amount: string;
  decimals: number;
}

/** Plain, RPC-independent view of a transaction — easy to fake in tests. */
export interface TxView {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  accountKeys: string[];
  preBalances: number[];
  postBalances: number[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  /** Every program invoked, top-level and inner (CPI). */
  invokedPrograms: string[];
}

export interface TokenChange {
  mint: string;
  delta: bigint;
  decimals: number;
}

export interface TxSummary {
  signature: string;
  vault: string;
  succeeded: boolean;
  noxvault: boolean;
  /** lamports; positive = incoming */
  solDelta: bigint;
  vaultIsFeePayer: boolean;
  tokens: TokenChange[];
  blockTime: number | null;
}

interface TokenBalanceLike {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export function toTxView(signature: string, tx: VersionedTransactionResponse): TxView {
  const meta = tx.meta;
  const msg = tx.transaction.message;
  const keys = msg
    .getAccountKeys({ accountKeysFromLookups: meta?.loadedAddresses ?? undefined })
    .keySegments()
    .flat()
    .map((k) => k.toBase58());

  const programs = new Set<string>();
  for (const ix of msg.compiledInstructions) programs.add(keys[ix.programIdIndex]);
  for (const inner of meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) programs.add(keys[ix.programIdIndex]);
  }

  const tb = (list: TokenBalanceLike[] | null | undefined): TokenBalance[] =>
    (list ?? []).map((b) => ({
      accountIndex: b.accountIndex,
      mint: b.mint,
      owner: b.owner,
      amount: b.uiTokenAmount.amount,
      decimals: b.uiTokenAmount.decimals,
    }));

  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    err: meta?.err ?? null,
    accountKeys: keys,
    preBalances: meta?.preBalances ?? [],
    postBalances: meta?.postBalances ?? [],
    preTokenBalances: tb(meta?.preTokenBalances),
    postTokenBalances: tb(meta?.postTokenBalances),
    invokedPrograms: [...programs].filter(Boolean),
  };
}

export function summarize(view: TxView, vault: string, programId: string): TxSummary {
  const idx = view.accountKeys.indexOf(vault);
  let solDelta = 0n;
  if (idx >= 0 && view.preBalances[idx] !== undefined && view.postBalances[idx] !== undefined) {
    solDelta = BigInt(view.postBalances[idx]) - BigInt(view.preBalances[idx]);
  }

  // Token accounts owned by the vault, keyed by account index (a closed account has no post entry).
  const byIndex = new Map<number, { mint: string; decimals: number; pre: bigint; post: bigint }>();
  for (const [which, list] of [
    ["pre", view.preTokenBalances],
    ["post", view.postTokenBalances],
  ] as const) {
    for (const b of list) {
      if (b.owner !== vault) continue;
      const e = byIndex.get(b.accountIndex) ?? { mint: b.mint, decimals: b.decimals, pre: 0n, post: 0n };
      e[which] = BigInt(b.amount);
      byIndex.set(b.accountIndex, e);
    }
  }
  const perMint = new Map<string, TokenChange>();
  for (const e of byIndex.values()) {
    const c = perMint.get(e.mint) ?? { mint: e.mint, delta: 0n, decimals: e.decimals };
    c.delta += e.post - e.pre;
    perMint.set(e.mint, c);
  }

  return {
    signature: view.signature,
    vault,
    succeeded: view.err === null || view.err === undefined,
    noxvault: view.invokedPrograms.includes(programId),
    solDelta,
    vaultIsFeePayer: idx === 0,
    tokens: [...perMint.values()].filter((t) => t.delta !== 0n),
    blockTime: view.blockTime,
  };
}

export function short(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

/** Integer amount with `decimals` → decimal string without trailing zeros. */
export function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = decimals > 0 ? (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  const s = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${s}` : s;
}

export function solscanTx(signature: string, network: Network): string {
  return `https://solscan.io/tx/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram HTML message for one transaction. */
export function formatMessage(s: TxSummary, network: Network): string {
  const lines: string[] = [];
  if (s.noxvault) {
    lines.push(`<b>Noxvault action</b> — ${s.succeeded ? "✅ succeeded" : "❌ failed"}`);
  } else {
    lines.push(`<b>Activity</b>${s.succeeded ? "" : " — ❌ failed"}`);
  }
  lines.push(`Vault <code>${esc(short(s.vault))}</code>`);

  if (s.solDelta > 0n) {
    lines.push(`⬇️ Incoming: +${formatUnits(s.solDelta, 9)} SOL`);
  } else if (s.solDelta < 0n) {
    const fee = s.vaultIsFeePayer ? " (incl. fee)" : "";
    lines.push(`⬆️ Outgoing: ${formatUnits(-s.solDelta, 9)} SOL${fee}`);
  }
  for (const t of s.tokens) {
    const sign = t.delta > 0n ? "+" : "";
    lines.push(`🪙 Token <code>${esc(short(t.mint))}</code>: ${sign}${formatUnits(t.delta, t.decimals)}`);
  }
  if (s.solDelta === 0n && s.tokens.length === 0) lines.push("No balance change for this vault.");

  lines.push(`<a href="${solscanTx(s.signature, network)}">View on Solscan</a>`);
  return lines.join("\n");
}

/** Plain-text variant (dry-run / logs). */
export function stripHtml(html: string): string {
  return html
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "$2: $1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
