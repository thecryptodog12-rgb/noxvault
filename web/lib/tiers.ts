// Tiers of many vaults in a few RPC calls (explorer, stats, keeper). Framework-free: the keeper
// bundles this. Same rule as the program: held >= sentinel -> Sentinel, >= guardian -> Guardian.
import { PublicKey, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TIER_FREE, TIER_GUARDIAN, TIER_SENTINEL, withRetry, type ProtocolView } from "@nox/sdk/client";

export async function tiersFor(conn: Connection, vaults: PublicKey[], p: ProtocolView | null): Promise<Map<string, { tier: number; held: bigint }>> {
  const out = new Map<string, { tier: number; held: bigint }>();
  if (!p || p.noxMint.equals(PublicKey.default)) {
    for (const v of vaults) out.set(v.toBase58(), { tier: TIER_SENTINEL, held: 0n });
    return out;
  }
  const mintInfo = await withRetry(() => conn.getAccountInfo(p.noxMint, "confirmed"));
  if (!mintInfo) return out;
  const atas = vaults.map((v) => getAssociatedTokenAddressSync(p.noxMint, v, true, mintInfo.owner));
  for (let i = 0; i < atas.length; i += 100) {
    const infos = await withRetry(() => conn.getMultipleAccountsInfo(atas.slice(i, i + 100), "confirmed"));
    infos.forEach((info, k) => {
      let held = 0n;
      if (info && info.data.length >= 72) held = new DataView(info.data.buffer, info.data.byteOffset).getBigUint64(64, true);
      const tier = held >= p.sentinel ? TIER_SENTINEL : held >= p.guardian ? TIER_GUARDIAN : TIER_FREE;
      out.set(vaults[i + k].toBase58(), { tier, held });
    });
  }
  return out;
}
