// $NOX buyback-and-burn counter for /token (read by app/api/burns). Framework-free.
//
// How "burned" is counted, and why:
// - The headline number is the sum of SPL `burn` / `burnChecked` instructions on the $NOX mint
//   whose authority is the published burn wallet. That attributes exactly what the flywheel burned,
//   and every row links to its transaction, so anyone can re-add the numbers.
// - We read the signature history of the burn wallet's $NOX token account (its ATA), not of the
//   wallet itself: bought $NOX lands there and is burned from there, and it skips the wallet's
//   unrelated traffic (fee receipts, swaps in SOL). Burns from any other token account of the
//   wallet are not counted. The scan is capped (MAX_SIGNATURES); if the cap is hit the total
//   is reported as a lower bound (`complete: false`).
// - Mint supply is read too (one getTokenSupply call). Supply decrease since launch is exact and
//   cannot miss a page, but it counts burns by anyone, so it is shown only as a cross-check, and only
//   when NEXT_PUBLIC_NOX_INITIAL_SUPPLY is configured (we do not assume a launch supply).
import { Connection, PublicKey, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export interface Burn {
  signature: string;
  /** unix seconds, 0 when the RPC did not return a block time */
  time: number;
  /** base units */
  amount: string;
}

export interface BurnReport {
  configured: true;
  mint: string;
  wallet: string;
  decimals: number;
  /** sum of burns by the wallet, base units */
  total: string;
  count: number;
  /** false when the history scan hit its cap: total is then a lower bound */
  complete: boolean;
  /** newest first */
  recent: Burn[];
  /** current mint supply, base units */
  supply: string;
  checkedAt: number;
}

export type BurnResponse = BurnReport | { configured: false; missing: ("mint" | "wallet")[] } | { configured: true; error: string };

const SPL_PROGRAMS = new Set(["spl-token", "spl-token-2022"]);
export const MAX_SIGNATURES = 1000;

type AnyIx = ParsedInstruction | PartiallyDecodedInstruction;

/** Burn amount (base units) a parsed instruction burns from `mint` with `wallet` as authority, else null. */
export function burnAmountOf(ix: AnyIx, mint: string, wallet: string): bigint | null {
  if (!("parsed" in ix) || !SPL_PROGRAMS.has(ix.program)) return null;
  const p = ix.parsed as { type?: string; info?: Record<string, unknown> } | undefined;
  if (!p || (p.type !== "burn" && p.type !== "burnChecked") || !p.info) return null;
  const info = p.info;
  if (info.mint !== mint) return null;
  const authority = (info.authority ?? info.multisigAuthority) as string | undefined;
  if (authority !== wallet) return null;
  const raw = p.type === "burnChecked" ? (info.tokenAmount as { amount?: string } | undefined)?.amount : (info.amount as string | undefined);
  if (raw === undefined) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Total burned by `wallet` from `mint` in one transaction (outer and inner instructions). Failed transactions burn nothing. */
export function burnedInTx(tx: ParsedTransactionWithMeta | null, mint: string, wallet: string): bigint {
  if (!tx || tx.meta?.err) return 0n;
  const all: AnyIx[] = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)];
  let sum = 0n;
  for (const ix of all) sum += burnAmountOf(ix, mint, wallet) ?? 0n;
  return sum;
}

export async function loadBurns(conn: Connection, mintAddr: string, walletAddr: string, recentN = 10): Promise<BurnReport> {
  const mint = new PublicKey(mintAddr);
  const wallet = new PublicKey(walletAddr);
  const mintInfo = await conn.getAccountInfo(mint, "confirmed");
  if (!mintInfo) throw new Error("mint not found on this RPC");
  const ata = getAssociatedTokenAddressSync(mint, wallet, true, mintInfo.owner);
  const supply = await conn.getTokenSupply(mint, "confirmed");

  // signature history of the burn wallet's $NOX account, newest first, paged up to the cap
  const sigs: { signature: string; blockTime?: number | null; err: unknown }[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await conn.getSignaturesForAddress(ata, { before, limit: 1000 }, "confirmed");
    sigs.push(...page);
    if (page.length < 1000 || sigs.length >= MAX_SIGNATURES) break;
    before = page[page.length - 1].signature;
  }
  const complete = sigs.length < MAX_SIGNATURES;
  const ok = sigs.slice(0, MAX_SIGNATURES).filter((s) => !s.err);

  const burns: Burn[] = [];
  let total = 0n;
  for (let i = 0; i < ok.length; i += 25) {
    const chunk = ok.slice(i, i + 25);
    const txs = await conn.getParsedTransactions(
      chunk.map((s) => s.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
    );
    txs.forEach((tx, k) => {
      const amt = burnedInTx(tx, mint.toBase58(), wallet.toBase58());
      if (amt > 0n) {
        total += amt;
        burns.push({ signature: chunk[k].signature, time: tx?.blockTime ?? chunk[k].blockTime ?? 0, amount: amt.toString() });
      }
    });
  }

  return {
    configured: true,
    mint: mint.toBase58(),
    wallet: wallet.toBase58(),
    decimals: supply.value.decimals,
    total: total.toString(),
    count: burns.length,
    complete,
    recent: burns.slice(0, recentN),
    supply: supply.value.amount,
    checkedAt: Math.floor(Date.now() / 1000),
  };
}
