import { ImageResponse } from "next/og";
import { compact, headlines } from "@/lib/report";
import { loadReport } from "@/lib/reportData";
import { C, OG_SIZE, OgFrame, ogAssets } from "@/lib/og";

export const runtime = "nodejs";
export const alt = "Solana Quantum Exposure Report: value on Solana mainnet behind a single ed25519 key";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const [{ fonts, art }, r] = await Promise.all([ogAssets(), loadReport()]);
  const h = r ? headlines(r) : null;
  return new ImageResponse(
    (
      <OgFrame art={art} footer={`nox-vault.com/report${r ? `  ·  snapshot ${r.generatedAt.slice(0, 10)}, slot ${r.slot}` : ""}`}>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: C.dim }}>SOLANA QUANTUM EXPOSURE REPORT</div>
        {h ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 6, fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>
              {h.solKeyPct}%
            </div>
            <div style={{ display: "flex", fontSize: 30, lineHeight: 1.35, color: C.bone, maxWidth: 660 }}>
              of the SOL in the 20 largest accounts ({compact(h.solKey)} SOL) moves on one ed25519 signature.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20, maxWidth: 660 }}>
              {[
                `${compact(h.stableKey)} USDC+USDT among top holders behind single keys (${h.stableKeyPct}%)`,
                `${h.votesKey} of ${h.votes} validator vote accounts withdrawable by one key`,
              ].map((f) => (
                <div key={f} style={{ display: "flex", gap: 12, fontSize: 21, lineHeight: 1.35, color: C.mute }}>
                  <span style={{ color: C.teal }}>›</span>
                  <span style={{ display: "flex" }}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", marginTop: 18, marginBottom: 6, fontSize: 17, color: C.warn }}>No quantum computer can break ed25519 today. This measures exposure.</div>
          </div>
        ) : (
          <div style={{ display: "flex", marginTop: 14, fontSize: 60, fontWeight: 700, letterSpacing: -1.5 }}>How much of Solana sits behind one key?</div>
        )}
      </OgFrame>
    ),
    { ...size, fonts }
  );
}
