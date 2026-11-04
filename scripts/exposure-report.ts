// Solana Quantum Exposure Report: snapshot of how much value on Solana MAINNET is controlled by a
// single ed25519 key. Every number written comes from an RPC response; a metric whose calls fail
// is dropped (and listed under `failures`), never estimated.
//
// Usage (from the repo root):
//   pnpm exec tsx scripts/exposure-report.ts
// Env:
//   REPORT_RPC_URL        primary RPC (default https://api.mainnet-beta.solana.com)
//   REPORT_RPC_FALLBACKS  comma-separated fallbacks, tried in order when the primary refuses a call
//                         (the public mainnet-beta endpoint rate-limits getLargestAccounts and
//                         getTokenLargestAccounts hard). Default: https://public.rpc.solanavibestation.com
// Output: web/content/exposure-report.json
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  classifyControl,
  redactRpc,
  splitByControl,
  STAKE_PROGRAM,
  VOTE_PROGRAM,
  type ExposureReport,
  type SolHolder,
  type TokenHolder,
  type TokenReport,
  type VoteReport,
} from "../web/lib/report";

const PRIMARY = process.env.REPORT_RPC_URL || "https://api.mainnet-beta.solana.com";
const FALLBACKS = (process.env.REPORT_RPC_FALLBACKS ?? "https://public.rpc.solanavibestation.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ENDPOINTS = [PRIMARY, ...FALLBACKS.filter((f) => f !== PRIMARY)];
const OUT = join(__dirname, "..", "web", "content", "exposure-report.json");

// Major SPL tokens (classic SPL Token program). Each mint is checked on chain: the decimals and
// supply in the report come from getTokenSupply, so a wrong mint would show up, not hide.
const TOKENS: { symbol: string; mint: string }[] = [
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  { symbol: "JUP", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { symbol: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "PYTH", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "RAY", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "JitoSOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 600; // between calls: be polite to free endpoints

let lastCall = 0;
class RpcError extends Error {}

async function callOnce(url: string, method: string, params: unknown[]): Promise<unknown> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let body: { result?: unknown; error?: { code?: number; message?: string } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new RpcError(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  if (body.error) throw new RpcError(`${body.error.code}: ${body.error.message}`);
  if (!res.ok) throw new RpcError(`HTTP ${res.status}`);
  return body.result;
}

const sources: Record<string, string> = {};
const failures: string[] = [];

/** Try each endpoint (with a couple of retries on rate limits) until one answers. */
async function rpc<T>(metric: string, method: string, params: unknown[] = []): Promise<T> {
  const errors: string[] = [];
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = (await callOnce(url, method, params)) as T;
        const host = redactRpc(url);
        sources[metric] = sources[metric] && !sources[metric].includes(host) ? `${sources[metric]}, ${host}` : host;
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${redactRpc(url)} ${method}: ${msg}`);
        // Disabled / blocked / not-supported: no point retrying this endpoint.
        if (!/429|Too many|timeout|timed out|fetch failed|HTTP 5/i.test(msg)) break;
        await sleep(2000 * (attempt + 1));
      }
    }
  }
  throw new RpcError(errors.slice(-3).join(" | "));
}

type Parsed = { parsed?: { type?: string; info?: Record<string, any> } } | [string, string];
interface AccountInfo {
  lamports: number;
  owner: string;
  data: Parsed;
}

async function accounts(metric: string, keys: string[]): Promise<(AccountInfo | null)[]> {
  const out: (AccountInfo | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const r = await rpc<{ value: (AccountInfo | null)[] }>(metric, "getMultipleAccounts", [keys.slice(i, i + 100), { encoding: "jsonParsed", commitment: "confirmed" }]);
    out.push(...r.value);
  }
  return out;
}

const info = (a: AccountInfo | null) => (a && !Array.isArray(a.data) ? a.data.parsed?.info : undefined);
const withdrawerOf = (a: AccountInfo | null): string | null => {
  if (!a) return null;
  if (a.owner === STAKE_PROGRAM) return info(a)?.meta?.authorized?.withdrawer ?? null;
  if (a.owner === VOTE_PROGRAM) return info(a)?.authorizedWithdrawer ?? null;
  return null;
};

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  process.stdout.write(`· ${name} … `);
  try {
    const r = await fn();
    console.log("ok");
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`FAILED (${msg})`);
    failures.push(`${name}: ${msg}`);
    return null;
  }
}

async function main() {
  console.log(`exposure report · endpoints: ${ENDPOINTS.map(redactRpc).join(" → ")}`);

  const slot = (await step("slot", () => rpc<number>("slot", "getSlot", [{ commitment: "confirmed" }]))) ?? 0;

  const supply = await step("supply", async () => {
    const r = await rpc<{ value: { total: number; circulating: number; nonCirculating: number } }>("supply", "getSupply", [
      { commitment: "confirmed", excludeNonCirculatingAccountsList: true },
    ]);
    return { totalLamports: r.value.total, circulatingLamports: r.value.circulating, nonCirculatingLamports: r.value.nonCirculating };
  });

  const largestSol = await step("largest SOL accounts", async () => {
    const r = await rpc<{ value: { address: string; lamports: number }[] }>("largestSol", "getLargestAccounts", [{ commitment: "confirmed" }]);
    const infos = await accounts("largestSol", r.value.map((v) => v.address));
    const holders: SolHolder[] = r.value.map((v, i) => {
      const a = infos[i];
      const c = classifyControl({ address: v.address, programOwner: a?.owner ?? null, withdrawer: withdrawerOf(a) });
      return { address: v.address, lamports: v.lamports, programOwner: a?.owner ?? null, control: c.control, label: c.label };
    });
    const s = splitByControl(holders, (h) => h.control, (h) => h.lamports);
    return { holders, totalLamports: s.total, keyLamports: s.key, programLamports: s.program, unknownLamports: s.unknown };
  });

  const tokens: TokenReport[] = [];
  for (const t of TOKENS) {
    const rep = await step(`token ${t.symbol}`, async () => {
      const sup = await rpc<{ value: { decimals: number; uiAmount: number | null; uiAmountString: string } }>(`token:${t.symbol}`, "getTokenSupply", [t.mint]);
      const big = await rpc<{ value: { address: string; amount: string; decimals: number; uiAmount: number | null; uiAmountString: string }[] }>(
        `token:${t.symbol}`,
        "getTokenLargestAccounts",
        [t.mint, { commitment: "confirmed" }]
      );
      const tokenAccts = await accounts(`token:${t.symbol}`, big.value.map((v) => v.address));
      const owners = tokenAccts.map((a) => (info(a)?.owner as string | undefined) ?? null);
      const uniqueOwners = [...new Set(owners.filter((o): o is string => !!o))];
      const ownerInfos = await accounts(`token:${t.symbol}`, uniqueOwners);
      const ownerMap = new Map(uniqueOwners.map((o, i) => [o, ownerInfos[i]]));
      const holders: TokenHolder[] = big.value.map((v, i) => {
        const owner = owners[i];
        const oa = owner ? ownerMap.get(owner) ?? null : null;
        const c = owner ? classifyControl({ address: owner, programOwner: oa?.owner ?? null, withdrawer: withdrawerOf(oa) }) : { control: "unknown" as const, label: "unknown owner" };
        return {
          account: v.address,
          amount: v.amount,
          ui: Number(v.uiAmountString),
          owner,
          ownerProgram: oa?.owner ?? null,
          control: c.control,
          label: c.label,
        };
      });
      const s = splitByControl(holders, (h) => h.control, (h) => h.ui);
      return {
        symbol: t.symbol,
        mint: t.mint,
        decimals: sup.value.decimals,
        supply: Number(sup.value.uiAmountString),
        holders,
        topTotal: s.total,
        topKey: s.key,
        topProgram: s.program,
        topUnknown: s.unknown,
      } satisfies TokenReport;
    });
    if (rep) tokens.push(rep);
  }

  const votes = await step("validator vote accounts", async (): Promise<VoteReport> => {
    const r = await rpc<{ current: { votePubkey: string; activatedStake: number }[]; delinquent: { votePubkey: string; activatedStake: number }[] }>(
      "votes",
      "getVoteAccounts",
      [{ commitment: "confirmed" }]
    );
    const all = [...r.current, ...r.delinquent];
    const infos = await accounts("votes", all.map((v) => v.votePubkey));
    const v: VoteReport = { accounts: all.length, keyWithdrawer: 0, programWithdrawer: 0, unknown: 0, lamports: 0, lamportsKey: 0, activatedStake: 0 };
    all.forEach((acc, i) => {
      const a = infos[i];
      const c = classifyControl({ address: acc.votePubkey, programOwner: a?.owner ?? null, withdrawer: withdrawerOf(a) });
      v.activatedStake += acc.activatedStake;
      v.lamports += a?.lamports ?? 0;
      if (c.control === "key") {
        v.keyWithdrawer++;
        v.lamportsKey += a?.lamports ?? 0;
      } else if (c.control === "program") v.programWithdrawer++;
      else v.unknown++;
    });
    return v;
  });

  const report: ExposureReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    slot,
    sources,
    method: [
      "Supply: getSupply (total, circulating, non-circulating lamports).",
      "Largest SOL accounts: getLargestAccounts (the 20 largest accounts by lamports; the RPC node may cache this list), then getMultipleAccounts (jsonParsed) for each account's owning program and, for stake and vote accounts, the withdraw authority.",
      "Tokens: getTokenSupply and getTokenLargestAccounts (the 20 largest token accounts per mint), then getMultipleAccounts for each token account's owner and for the owner's own account.",
      "Validators: getVoteAccounts (current + delinquent), then getMultipleAccounts for each vote account's authorized withdrawer and balance.",
      "Classification: 'single ed25519 key' = the address that can move the funds is on the ed25519 curve (a plain wallet), or the account is a stake/vote account whose withdraw authority is such a wallet. 'Program-controlled' = the controlling address is off the curve (a PDA) or the account is owned by a program other than System; no private key exists for that address, but the program's own signers may still be ed25519 keys (multisigs, admin keys).",
      "Not counted: prices. Amounts are shown in SOL or token units as read; no USD values are estimated.",
    ],
    supply,
    largestSol,
    tokens,
    votes,
    failures,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);
  if (largestSol) console.log(`largest ${largestSol.holders.length} SOL accounts: ${(largestSol.keyLamports / 1e9).toFixed(0)} of ${(largestSol.totalLamports / 1e9).toFixed(0)} SOL behind one ed25519 key`);
  for (const t of tokens) console.log(`${t.symbol}: top ${t.holders.length} hold ${t.topTotal.toFixed(0)}; single key ${t.topKey.toFixed(0)} (${((t.topKey / (t.topTotal || 1)) * 100).toFixed(1)}%)`);
  if (votes) console.log(`vote accounts: ${votes.keyWithdrawer}/${votes.accounts} withdrawable by one ed25519 key`);
  if (failures.length) console.log(`failures:\n  ${failures.join("\n  ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
