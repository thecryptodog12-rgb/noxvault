import { ImageResponse } from "next/og";
import { C, OG_SIZE, OgFrame, ogAssets } from "@/lib/og";

export const alt = "Noxvault: the safer, quantum-proof wallet for Solana";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const { fonts, art } = await ogAssets();
  return new ImageResponse(
    (
      <OgFrame art={art} footer="nox-vault.com  ·  devnet, unaudited">
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2 }}>
          <div style={{ display: "flex" }}>The safer wallet</div>
          <div style={{ display: "flex" }}>
            for&nbsp;<span style={{ color: C.teal }}>Solana.</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 30, fontSize: 25, lineHeight: 1.45, color: C.mute }}>
          <div style={{ display: "flex" }}>Hash-based one-time keys, recovery,</div>
          <div style={{ display: "flex" }}>inheritance and limits, on-chain.</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 34 }}>
          {["WOTS+", "SHA-256", "1 KEY = 1 USE"].map((t) => (
            <div key={t} style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 16px", fontSize: 19, color: C.bone }}>
              {t}
            </div>
          ))}
        </div>
      </OgFrame>
    ),
    { ...size, fonts }
  );
}
