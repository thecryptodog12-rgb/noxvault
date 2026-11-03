import { ImageResponse } from "next/og";
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "@/lib/config";
import { loadTreasury, type Treasury } from "@/lib/treasury";
import { C, OG_SIZE, OgFrame, ogAssets } from "@/lib/og";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "Noxvault treasury: rules enforced on-chain, checked live";
export const size = OG_SIZE;
export const contentType = "image/png";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function load(vault: string): Promise<Treasury | null> {
  try {
    const key = new PublicKey(vault);
    return await Promise.race([
      loadTreasury(new Connection(RPC_URL, "confirmed"), key),
      new Promise<null>((r) => setTimeout(() => r(null), 6000)),
    ]);
  } catch {
    return null; // bad address or RPC failure: draw the generic card
  }
}

export default async function Image({ params }: { params: Promise<{ vault: string }> }) {
  const { vault } = await params;
  const [{ fonts, art }, t] = await Promise.all([ogAssets(), load(vault)]);
  const ok = !!t?.initialized;
  // first rule is always "every action needs a one-time signature"; show the specific ones
  const rules = ok ? (t!.rules.length > 1 ? t!.rules.slice(1) : t!.rules).slice(0, 3) : [];
  const score = t?.score ?? 0;

  return new ImageResponse(
    (
      <OgFrame art={art} footer={`nox-vault.com/t/${short(vault)}  ·  read live from the chain`}>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: C.dim }}>TREASURY {short(vault)}</div>
        <div style={{ display: "flex", marginTop: 10, fontSize: 64, fontWeight: 700, letterSpacing: -1.5 }}>Noxvault treasury</div>
        {ok ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 24 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    style={{ display: "flex", width: 30, height: 30, borderRadius: 4, border: `2px solid ${i < score ? C.teal : C.line}`, background: i < score ? C.teal : "transparent" }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: score >= 4 ? C.teal : score >= 2 ? C.warn : C.mute }}>{score} / 5 protections</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 26, maxWidth: 600 }}>
              {rules.map((r) => (
                <div key={r} style={{ display: "flex", gap: 12, fontSize: 21, lineHeight: 1.35, color: C.mute }}>
                  <span style={{ color: C.teal }}>›</span>
                  <span style={{ display: "flex" }}>{clip(r, 92)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", marginTop: 26, fontSize: 26, lineHeight: 1.45, color: C.mute, maxWidth: 620 }}>
            {t && !t.initialized
              ? "This address is not an initialized Noxvault."
              : "Signers, delays, recovery and pending payouts, read live from the chain."}
          </div>
        )}
      </OgFrame>
    ),
    { ...size, fonts }
  );
}
