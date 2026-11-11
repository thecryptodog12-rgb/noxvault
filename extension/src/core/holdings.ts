// Holdings of an ordinary wallet, like Phantom's home: SOL plus every SPL and Token-2022 balance, with
// names / symbols / logos and, on mainnet only, USD prices and the 24 h change.
//
// Sources, in order: the bundled list of well-known mainnet tokens (src/lib/knownTokens.json), the
// cache in chrome.storage.local, Jupiter's token search (mainnet), and on-chain metadata (Metaplex
// metadata accounts, the Token-2022 metadata extension). Off-chain metadata URIs are never fetched (a
// spam token could use one to log your IP); tokens without a known logo get a letter avatar.
// Prices: Jupiter price API v3 (lite-api.jup.ag/price/v3), mainnet mints only. Both Jupiter calls send
// the list of mints you hold to Jupiter (README privacy section). No key, no address is sent there.
import { PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { TokenMetaCache } from "../lib/store";
import type { WalletCluster } from "../lib/types";
import known from "../lib/knownTokens.json";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const JUP = "https://lite-api.jup.ag";
const KNOWN = known as Record<string, { name: string; symbol: string; logo: string }>;

export interface Holding {
  mint: string;
  name: string;
  symbol: string;
  logo?: string;
  decimals: number;
  /** base units, decimal string */
  raw: string;
  /** "sol" for native SOL */
  program: "sol" | "spl" | "2022";
  /** the token account (empty for SOL): the biggest one when a mint has several */
  account: string;
  /** base units in `account`: what one send can move */
  accountRaw: string;
  /** another key may move this balance (approve / delegate) */
  delegated: boolean;
  price?: number;
  change24h?: number;
  usd?: number;
  spam: boolean;
}

// ---------- amounts ----------

/** Exact decimal string of base units, with thousands separators and at most `maxFrac` decimals (cut, not rounded). */
export function fmtUnits(raw: bigint | string, decimals: number, maxFrac = decimals): string {
  const v = BigInt(raw);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (a / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = decimals ? (a % base).toString().padStart(decimals, "0").slice(0, Math.max(0, maxFrac)) : "";
  frac = frac.replace(/0+$/, "");
  if (!frac && a > 0n && a < base && maxFrac < decimals && whole === "0") {
    // too small to show at this precision
    return `${neg ? "-" : ""}<0.${"0".repeat(Math.max(0, maxFrac - 1))}1`;
  }
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Display precision for a token amount: more decimals for small balances. */
export const shownDecimals = (decimals: number) => Math.min(decimals, 6);

/** Plain decimal string (no separators) of base units, for inputs. */
export function unitsToInput(raw: bigint | string, decimals: number): string {
  return fmtUnits(raw, decimals).replace(/,/g, "");
}

/** Parses "1.25" → base units; refuses more decimals than the token has, negatives and junk. */
export function parseUnits(input: string, decimals: number): bigint {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error("Enter an amount");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`This token has ${decimals} decimals at most`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function fmtUsd(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n > 0 && n < 0.01) return "<$0.01";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(p: number | undefined | null): string {
  if (p == null || !Number.isFinite(p)) return "";
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

// ---------- metadata ----------

/** Metaplex token metadata (name, symbol) from the raw account data. null when it does not parse. */
export function decodeMetaplex(data: Uint8Array): { name: string; symbol: string } | null {
  try {
    // key u8, update_authority 32, mint 32, then borsh strings name, symbol, uri
    let o = 1 + 32 + 32;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const str = () => {
      const len = view.getUint32(o, true);
      if (len > 200) throw new Error("bad length");
      o += 4;
      const s = new TextDecoder().decode(data.subarray(o, o + len));
      o += len;
      return s.replace(/\0/g, "").trim();
    };
    const name = str();
    const symbol = str();
    return { name, symbol };
  } catch {
    return null;
  }
}

export const metadataPda = (mint: string) => PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), METAPLEX.toBytes(), new PublicKey(mint).toBytes()], METAPLEX)[0];

/** Removes control characters, caps the length: names come from anyone. */
const clean = (s: string, n: number) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n);

const SPAM_WORDS = /(https?:|www\.|\.com\b|\.io\b|\.xyz\b|\.net\b|claim|airdrop|visit|reward|voucher|\bgift\b|t\.me)/i;

/** Likely spam / dust: zero, or (mainnet) no price and not a known token, or a name that advertises a site. */
export function isSpam(h: Pick<Holding, "raw" | "name" | "symbol" | "price" | "mint" | "program">, cluster: WalletCluster, pricesKnown = true): boolean {
  if (h.program === "sol") return false;
  if (BigInt(h.raw) === 0n) return true;
  if (SPAM_WORDS.test(`${h.name} ${h.symbol}`)) return true;
  if (cluster === "mainnet-beta" && pricesKnown && h.price == null && !KNOWN[h.mint]) return true;
  return false;
}

type Fetch = typeof fetch;

/** GET JSON; one retry after a short wait on 429 / 5xx / network errors (Jupiter rate-limits bursts). */
async function getJson<T>(f: Fetch, url: string, ms = 8000): Promise<T> {
  try {
    return await getJsonOnce<T>(f, url, ms);
  } catch (e) {
    if (/ 4\d\d$/.test(String((e as Error)?.message)) && !/ 429$/.test(String((e as Error)?.message))) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    return getJsonOnce<T>(f, url, ms);
  }
}

async function getJsonOnce<T>(f: Fetch, url: string, ms: number): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await f(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface Price {
  usdPrice: number;
  priceChange24h?: number;
}

const priceCache = new Map<string, { p: Price | null; at: number }>();

/** Jupiter price API v3, ≤ 50 mints per request, cached 60 s. Mainnet mints only. */
export async function fetchPrices(mints: string[], f: Fetch = fetch): Promise<Record<string, Price>> {
  const out: Record<string, Price> = {};
  const need: string[] = [];
  // well-known mints first: if a later batch is rate-limited, the big balances are still priced
  const ordered = [...new Set(mints)].sort((a, b) => Number(!KNOWN[a]) - Number(!KNOWN[b]));
  for (const m of ordered) {
    const c = priceCache.get(m);
    if (c && Date.now() - c.at < 60_000) {
      if (c.p) out[m] = c.p;
    } else need.push(m);
  }
  let failed: unknown = null;
  let ok = 0;
  for (let i = 0; i < need.length; i += 50) {
    const ids = need.slice(i, i + 50);
    let j: Record<string, { usdPrice?: number; priceChange24h?: number } | null>;
    try {
      j = await getJson(f, `${JUP}/price/v3?ids=${ids.join(",")}`);
      ok++;
    } catch (e) {
      failed = e;
      continue; // not cached: retried next time
    }
    for (const m of ids) {
      const x = j[m];
      const p = x && typeof x.usdPrice === "number" && Number.isFinite(x.usdPrice) ? { usdPrice: x.usdPrice, priceChange24h: typeof x.priceChange24h === "number" ? x.priceChange24h : undefined } : null;
      priceCache.set(m, { p, at: Date.now() });
      if (p) out[m] = p;
    }
  }
  if (failed && !ok) throw failed instanceof Error ? failed : new Error(String(failed));
  return out;
}

/** Jupiter token search for names / symbols / icons (mainnet), ≤ 20 mints per request. */
async function jupiterMeta(mints: string[], f: Fetch): Promise<Record<string, TokenMetaCache>> {
  const out: Record<string, TokenMetaCache> = {};
  for (let i = 0; i < mints.length; i += 20) {
    const ids = mints.slice(i, i + 20);
    const list = await getJson<{ id: string; name?: string; symbol?: string; icon?: string }[]>(f, `${JUP}/tokens/v2/search?query=${ids.join(",")}`).catch(() => []);
    for (const t of Array.isArray(list) ? list : []) {
      if (!ids.includes(t.id)) continue;
      out[t.id] = { name: clean(t.name ?? "", 40), symbol: clean(t.symbol ?? "", 12), logo: /^https:\/\//.test(t.icon ?? "") ? t.icon : undefined, at: Math.floor(Date.now() / 1000) };
    }
  }
  return out;
}

/** On-chain names: Metaplex metadata accounts, then the Token-2022 metadata extension. */
async function onchainMeta(conn: Connection, mints: { mint: string; program: Holding["program"] }[]): Promise<Record<string, TokenMetaCache>> {
  const out: Record<string, TokenMetaCache> = {};
  const at = Math.floor(Date.now() / 1000);
  for (let i = 0; i < mints.length; i += 100) {
    const part = mints.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(part.map((m) => metadataPda(m.mint)), "confirmed").catch(() => []);
    part.forEach((m, k) => {
      const d = infos[k]?.data;
      const md = d ? decodeMetaplex(new Uint8Array(d)) : null;
      if (md && (md.name || md.symbol)) out[m.mint] = { name: clean(md.name, 40), symbol: clean(md.symbol, 12), at };
    });
  }
  const t22 = mints.filter((m) => m.program === "2022" && !out[m.mint]);
  for (let i = 0; i < t22.length; i += 100) {
    const part = t22.slice(i, i + 100);
    const res = await conn.getMultipleParsedAccounts(part.map((m) => new PublicKey(m.mint)), { commitment: "confirmed" }).catch(() => null);
    res?.value.forEach((acc, k) => {
      const exts = (acc?.data as { parsed?: { info?: { extensions?: { extension: string; state?: { name?: string; symbol?: string } }[] } } } | undefined)?.parsed?.info?.extensions ?? [];
      const md = exts.find((e) => e.extension === "tokenMetadata")?.state;
      if (md && (md.name || md.symbol)) out[part[k].mint] = { name: clean(md.name ?? "", 40), symbol: clean(md.symbol ?? "", 12), at };
    });
  }
  return out;
}

export interface HoldingsResult {
  lamports: number;
  holdings: Holding[];
  /** new cache entries to persist, keyed `${cluster}:${mint}` */
  metaUpdates: Record<string, TokenMetaCache>;
  /** prices failed (network, rate limit): values are missing, not zero */
  priceError?: string;
  totalUsd: number | null;
  /** weighted 24 h change of the priced part, % */
  change24h: number | null;
}

interface RawAccount {
  mint: string;
  raw: string;
  decimals: number;
  program: "spl" | "2022";
  account: string;
  delegated: boolean;
}

export async function tokenAccounts(conn: Connection, owner: PublicKey): Promise<RawAccount[]> {
  const out: RawAccount[] = [];
  for (const [programId, program] of [
    [TOKEN_PROGRAM_ID, "spl"],
    [TOKEN_2022_PROGRAM_ID, "2022"],
  ] as const) {
    const res = await conn.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    for (const { pubkey, account } of res.value) {
      const info = (account.data as { parsed?: { info?: { mint: string; delegate?: string; tokenAmount: { amount: string; decimals: number } } } }).parsed?.info;
      if (!info) continue;
      out.push({ mint: info.mint, raw: info.tokenAmount.amount, decimals: info.tokenAmount.decimals, program, account: pubkey.toBase58(), delegated: !!info.delegate });
    }
  }
  return out;
}

/** Reads SOL + token balances and fills names, logos and (mainnet) prices. */
export async function readHoldings(conn: Connection, owner: PublicKey, cluster: WalletCluster, cache: Record<string, TokenMetaCache>, f: Fetch = fetch): Promise<HoldingsResult> {
  const [lamports, accounts] = await Promise.all([conn.getBalance(owner, "confirmed"), tokenAccounts(conn, owner)]);
  // one row per mint (several accounts of one mint are added up; the biggest account is the one used to send)
  const byMint = new Map<string, RawAccount & { total: bigint; biggest: bigint }>();
  for (const a of accounts) {
    const cur = byMint.get(a.mint);
    const v = BigInt(a.raw);
    if (!cur) byMint.set(a.mint, { ...a, total: v, biggest: v });
    else {
      cur.total += v;
      cur.delegated ||= a.delegated;
      if (v > cur.biggest) Object.assign(cur, { account: a.account, biggest: v, program: a.program });
    }
  }
  const mints = [...byMint.values()];
  const key = (m: string) => `${cluster}:${m}`;
  const week = 7 * 86400;
  const nowS = Math.floor(Date.now() / 1000);
  const meta: Record<string, TokenMetaCache> = {};
  const updates: Record<string, TokenMetaCache> = {};
  // Prices first (mainnet): a mint Jupiter cannot price is treated as spam and gets no name lookup at
  // all, which keeps big, airdrop-spammed wallets to a handful of requests.
  let prices: Record<string, Price> = {};
  let priceError: string | undefined;
  if (cluster === "mainnet-beta") {
    try {
      prices = await fetchPrices([SOL_MINT, ...mints.filter((m) => m.total > 0n).map((m) => m.mint)], f);
    } catch (e) {
      priceError = e instanceof Error ? e.message : String(e);
    }
  }
  const missing: typeof mints = [];
  for (const m of mints) {
    const k = cluster === "mainnet-beta" ? KNOWN[m.mint] : undefined;
    const c = cache[key(m.mint)];
    if (k) meta[m.mint] = { ...k, at: nowS };
    else if (c && nowS - c.at < week) meta[m.mint] = c;
    else if (cluster === "devnet" || prices[m.mint] || priceError) missing.push(m);
  }
  if (missing.length) {
    const lookup = missing.slice(0, 200);
    const jup = cluster === "mainnet-beta" ? await jupiterMeta(lookup.map((m) => m.mint), f).catch(() => ({}) as Record<string, TokenMetaCache>) : {};
    const still = lookup.filter((m) => !jup[m.mint]);
    const chain = still.length ? await onchainMeta(conn, still).catch(() => ({}) as Record<string, TokenMetaCache>) : {};
    for (const m of lookup) {
      const got = (jup as Record<string, TokenMetaCache>)[m.mint] ?? chain[m.mint] ?? { name: "", symbol: "", at: nowS };
      meta[m.mint] = got;
      updates[key(m.mint)] = got;
    }
  }
  const sol: Holding = {
    mint: SOL_MINT,
    name: "Solana",
    symbol: "SOL",
    logo: KNOWN[SOL_MINT]?.logo,
    decimals: 9,
    raw: String(lamports),
    program: "sol",
    account: "",
    accountRaw: String(lamports),
    delegated: false,
    spam: false,
  };
  const rows: Holding[] = [sol];
  for (const m of mints) {
    const md = meta[m.mint];
    rows.push({
      mint: m.mint,
      name: md?.name || "Unknown token",
      symbol: md?.symbol || m.mint.slice(0, 4),
      logo: md?.logo,
      decimals: m.decimals,
      raw: m.total.toString(),
      program: m.program,
      account: m.account,
      accountRaw: m.biggest.toString(),
      delegated: m.delegated,
      spam: false,
    });
  }
  let total = 0;
  let priced = 0;
  let weighted = 0;
  for (const h of rows) {
    const p = prices[h.mint];
    if (p) {
      h.price = p.usdPrice;
      h.change24h = p.priceChange24h;
      h.usd = (Number(BigInt(h.raw)) / 10 ** h.decimals) * p.usdPrice;
      total += h.usd;
      if (p.priceChange24h != null && h.usd > 0) {
        priced += h.usd;
        weighted += h.usd * p.priceChange24h;
      }
    }
    h.spam = isSpam(h, cluster, !priceError);
  }
  rows.sort((a, b) => (a.program === "sol" ? -1 : b.program === "sol" ? 1 : (b.usd ?? -1) - (a.usd ?? -1) || Number(BigInt(b.raw) > BigInt(a.raw)) - Number(BigInt(b.raw) < BigInt(a.raw))));
  return {
    lamports,
    holdings: rows,
    metaUpdates: updates,
    priceError,
    totalUsd: cluster === "mainnet-beta" && !priceError ? total : null,
    change24h: priced > 0 ? weighted / priced : null,
  };
}
