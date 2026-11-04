import { ImageResponse } from "next/og";
import { C, OG_SIZE, OgFrame, ogAssets } from "@/lib/og";

export const alt = "Crack this vault: everything public except the phrase";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const { fonts, art } = await ogAssets();
  return new ImageResponse(
    (
      <OgFrame art={art} footer="nox-vault.com/challenge  ·  opens after the external audit">
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: C.dim }}>CHALLENGE // PROOF OF SECURITY</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 12, fontSize: 76, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2 }}>
          <div style={{ display: "flex" }}>Crack this</div>
          <div style={{ display: "flex", color: C.teal }}>vault.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: 25, lineHeight: 1.45, color: C.mute }}>
          <div style={{ display: "flex" }}>Address, config, Merkle roots and every</div>
          <div style={{ display: "flex" }}>signature are public. Only the phrase is not.</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
          {["DRAIN IT", "KEEP IT"].map((t) => (
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
