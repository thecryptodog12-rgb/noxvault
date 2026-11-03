import { ImageResponse } from "next/og";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { fetchState } from "@nox/sdk/client";
import { RPC_URL } from "@/lib/config";
import { readActivity, readStakes, riskOf, type Activity, type RiskLevel } from "@/lib/exposure";
import { readProgram } from "@/lib/program";
import { C, OG_SIZE, OgFrame, ogAssets } from "@/lib/og";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "Quantum exposure of a Solana address: value behind one ed25519 key, read live from the chain";
export const size = OG_SIZE;
export const contentType = "image/png";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const solStr = (l: number) => (l / 1e9).toLocaleString("en-US", { maximumFractionDigits: l >= 1000e9 ? 0 : 2 });

interface Card {
  kind: "wallet" | "pda" | "vault";
  lamports: number;
  stake: number;
  tokens: number;
  activity: Activity | null;
  level: RiskLevel;
}

/** Each read gets its own deadline; a slow one leaves its part blank instead of failing the card. */
const soft = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

async function load(address: string): Promise<Card | null> {
  let key: PublicKey;
  try {
    key = new PublicKey(address);
  } catch {
    return null;
  }
  const conn = new Connection(RPC_URL, "confirmed");
  const tokenCount = (programId: PublicKey) => conn.getTokenAccountsByOwner(key, { programId }, "confirmed").then((r) => r.value.length);
  const [info, t1, t2, activity, stakes, vault] = await Promise.all([
    soft(conn.getAccountInfo(key, "confirmed"), 5000),
    soft(tokenCount(TOKEN_PROGRAM_ID), 5000),
    soft(tokenCount(TOKEN_2022_PROGRAM_ID), 5000),
    soft(readActivity(conn, key, 1), 5000),
    soft(readStakes(conn, key), 5000),
    soft(fetchState(readProgram(conn), key), 5000),
  ]);
  const kind = vault ? "vault" : PublicKey.isOnCurve(key.toBytes()) ? "wallet" : "pda";
  const lamports = info?.lamports ?? 0;
  const stake = (stakes ?? []).filter((s) => s.role !== "staker").reduce((a, s) => a + s.lamports, 0);
  const tokens = (t1 ?? 0) + (t2 ?? 0); // includes empty token accounts; the card says "token accounts"
  const { level } = riskOf({ kind, lamports, stakeWithdrawable: stake, stakeStakerOnly: 0, tokens, usd: null, delegations: 0, escapeArmed: false, activity });
  return { kind, lamports, stake, tokens, activity, level };
}

const LEVEL_COLOR: Record<RiskLevel, string> = { none: C.teal, low: C.mute, medium: C.warn, high: "#ff6b7a" };

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  const address = decodeURIComponent(raw);
  const [{ fonts, art }, c] = await Promise.all([ogAssets(), load(address)]);

  const year = (t: number | null) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null);
  const facts: string[] = [];
  if (c && c.kind === "wallet") {
    if (c.stake) facts.push(`+ ${solStr(c.stake)} SOL staked, withdrawable by this key`);
    if (c.tokens) facts.push(`${c.tokens} token account${c.tokens === 1 ? "" : "s"} under the same key`);
    if (c.activity?.count) facts.push(`${c.activity.capped ? `${c.activity.count}+` : c.activity.count} transactions · last ${year(c.activity.last) ?? "?"}`);
    facts.splice(2);
    facts.push("The address is the public key. Exposure = value behind it.");
  }

  return new ImageResponse(
    (
      <OgFrame art={art} footer={`nox-vault.com/exposure/${short(address)}  ·  read live from the chain`}>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: C.dim }}>QUANTUM EXPOSURE · {short(address)}</div>
        {!c ? (
          <div style={{ display: "flex", marginTop: 14, fontSize: 60, fontWeight: 700, letterSpacing: -1.5 }}>Quantum exposure scanner</div>
        ) : c.kind === "vault" ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", marginTop: 14, fontSize: 64, fontWeight: 700, letterSpacing: -1.5, color: C.teal }}>Protected.</div>
            <div style={{ display: "flex", marginTop: 20, fontSize: 27, lineHeight: 1.45, color: C.mute, maxWidth: 640 }}>
              A Noxvault: {solStr(c.lamports)} SOL that no ed25519 key can move. Withdrawals need hash-based one-time signatures.
            </div>
          </div>
        ) : c.kind === "pda" ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", marginTop: 14, fontSize: 58, fontWeight: 700, letterSpacing: -1.5 }}>No private key.</div>
            <div style={{ display: "flex", marginTop: 20, fontSize: 27, lineHeight: 1.45, color: C.mute, maxWidth: 640 }}>
              A program address, off the ed25519 curve. What it holds follows that program&apos;s rules.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 14, fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>
              {solStr(c.lamports)}
              <span style={{ fontSize: 40, marginLeft: 16, color: C.mute }}>SOL</span>
            </div>
            <div style={{ display: "flex", fontSize: 32, color: C.warn, marginTop: 4 }}>on one ed25519 key</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 24, maxWidth: 640 }}>
              {facts.slice(0, 3).map((f) => (
                <div key={f} style={{ display: "flex", gap: 12, fontSize: 21, lineHeight: 1.35, color: C.mute }}>
                  <span style={{ color: C.teal }}>›</span>
                  <span style={{ display: "flex" }}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24 }}>
              <div style={{ display: "flex", border: `2px solid ${LEVEL_COLOR[c.level]}`, color: LEVEL_COLOR[c.level], borderRadius: 6, padding: "6px 14px", fontSize: 20, letterSpacing: 2 }}>
                {c.level.toUpperCase()} EXPOSURE
              </div>
              <div style={{ display: "flex", fontSize: 20, color: C.dim }}>scan yours at nox-vault.com/scan</div>
            </div>
          </div>
        )}
      </OgFrame>
    ),
    { ...size, fonts }
  );
}
