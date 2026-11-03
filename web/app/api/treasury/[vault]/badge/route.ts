import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "@/lib/config";
import { loadTreasury } from "@/lib/treasury";

export const runtime = "nodejs";
export const revalidate = 300;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Embeddable SVG: "noxvault treasury | 2-of-3 · 72h delay". */
function badge(label: string, value: string, color: string) {
  const w1 = Math.round(8 + label.length * 6.6);
  const w2 = Math.round(10 + value.length * 6.6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w1 + w2}" height="22" role="img" aria-label="${esc(label)}: ${esc(value)}">
<rect width="${w1}" height="22" fill="#03070a"/><rect x="${w1}" width="${w2}" height="22" fill="${color}"/>
<g font-family="JetBrains Mono,ui-monospace,monospace" font-size="11" font-weight="700">
<text x="6" y="15" fill="#8fe3d6">${esc(label)}</text><text x="${w1 + 5}" y="15" fill="#03070a">${esc(value)}</text></g></svg>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  const headers = { "content-type": "image/svg+xml", "cache-control": "public, s-maxage=300, stale-while-revalidate=900" };
  let key: PublicKey;
  try {
    key = new PublicKey(vault);
  } catch {
    return new Response(badge("noxvault", "invalid address", "#e06c6c"), { headers });
  }
  try {
    const t = await loadTreasury(new Connection(RPC_URL, "confirmed"), key);
    if (!t.initialized) return new Response(badge("noxvault", "not a vault", "#e06c6c"), { headers });
    const parts = [t.signers > 1 ? `${t.threshold}-of-${t.signers}` : "1 signer", `${t.score}/5 protections`];
    if (t.pending) parts.push("payout pending");
    const color = t.score >= 4 ? "#5fd3b5" : t.score >= 2 ? "#e8c35a" : "#e06c6c";
    return new Response(badge("noxvault treasury", parts.join(" · "), color), { headers });
  } catch {
    return new Response(badge("noxvault", "unavailable", "#6b7378"), { headers });
  }
}
