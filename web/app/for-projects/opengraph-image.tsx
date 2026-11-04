import { ImageResponse } from "next/og";
import { C, OG_SIZE, OgFrame, ogAssets } from "@/lib/og";

export const alt = "Noxvault for token projects: prove to your holders you can't dump the treasury";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  const { fonts, art } = await ogAssets();
  return new ImageResponse(
    (
      <OgFrame art={art} footer="nox-vault.com/for-projects  ·  devnet, unaudited">
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: C.dim }}>FOR TOKEN PROJECTS AND DAOS</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 12, fontSize: 64, fontWeight: 700, lineHeight: 1.06, letterSpacing: -1.5 }}>
          <div style={{ display: "flex" }}>Prove you can&apos;t</div>
          <div style={{ display: "flex" }}>
            dump the&nbsp;<span style={{ color: C.teal }}>treasury.</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: 24, lineHeight: 1.45, color: C.mute }}>
          <div style={{ display: "flex" }}>Multi-signer, public delays, vesting.</div>
          <div style={{ display: "flex" }}>Rules on-chain, checked live by holders.</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
          {["2 OF 3", "72 H DELAY", "BADGE"].map((t) => (
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
