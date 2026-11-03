// Shared pieces for Open Graph images (next/og). Server only: reads fonts and art from web/assets.
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 };

const dir = join(process.cwd(), "assets");
let cache: Promise<{ fonts: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]; art: string }> | null = null;

export function ogAssets() {
  cache ??= Promise.all([
    readFile(join(dir, "JetBrainsMono-Regular.ttf")),
    readFile(join(dir, "JetBrainsMono-Bold.ttf")),
    readFile(join(dir, "og-vault.jpg")),
  ]).then(([regular, bold, art]) => ({
    fonts: [
      { name: "JetBrains Mono", data: regular, weight: 400 as const, style: "normal" as const },
      { name: "JetBrains Mono", data: bold, weight: 700 as const, style: "normal" as const },
    ],
    art: `data:image/jpeg;base64,${art.toString("base64")}`,
  }));
  return cache;
}

export const C = {
  ink: "#03070a",
  bone: "#e6f0ef",
  mute: "#93a5a9",
  dim: "#5f7479",
  teal: "#2ee6d6",
  line: "#213a40",
  warn: "#ffb547",
};

/** The common frame: vault art on the right fading into the dark, content on the left. */
export function OgFrame({ art, children, footer }: { art: string; children: ReactNode; footer: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: C.ink, fontFamily: "JetBrains Mono", color: C.bone, position: "relative" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art} width={612} height={666} style={{ position: "absolute", right: -20, top: -18, width: 612, height: 666, objectFit: "cover" }} alt="" />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1200,
          height: 630,
          display: "flex",
          background: `linear-gradient(90deg, ${C.ink} 0%, ${C.ink} 46%, rgba(3,7,10,0.75) 62%, rgba(3,7,10,0) 82%)`,
        }}
      />
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, background: C.teal, display: "flex" }} />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "56px 0 48px 72px", width: 760, height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 22, letterSpacing: 4, color: C.teal }}>
          <div style={{ width: 12, height: 12, borderRadius: 12, background: C.teal, display: "flex" }} />
          NOXVAULT
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>{children}</div>
        <div style={{ display: "flex", fontSize: 19, color: C.dim }}>{footer}</div>
      </div>
    </div>
  );
}
