"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicKey } from "@solana/web3.js";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fetchState, initVaultIx, makeConfig, vaultOf, type Signer } from "@nox/sdk/client";
import type { Config } from "@nox/sdk/wots";
import { Copy, Note, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { savedConfigsFor } from "@/lib/configJson";
import { errMsg, hex, sol } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import { sendIxs } from "@/lib/unlock";

interface Pending {
  n: number;
  vault: PublicKey;
  config: Config;
  balance: number;
}

/**
 * Vault addresses this device set up in /create but that were never initialized on chain.
 * Their address already exists, so funds sent there are safe; they just can't be used yet.
 */
export default function PendingVaults({ signers, onCreated }: { signers: { n: number; signer: Signer }[]; onCreated: () => void }) {
  const { connection, program, wallet } = useNox();
  const { setVisible } = useWalletModal();
  const [list, setList] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string; sig?: string } | null>(null);

  const load = useCallback(async () => {
    const out: Pending[] = [];
    for (const { n, signer } of signers) {
      // Settings saved by /create on this site, plus the default settings (no extra rules), which
      // also covers a vault set up on another device or domain.
      const def = makeConfig(signer);
      const candidates = [{ vault: vaultOf(def, program.programId), config: def }, ...savedConfigsFor(hex(signer.pub.root))];
      const seen = new Set<string>();
      for (const { vault, config } of candidates) {
        if (seen.has(vault.toBase58())) continue;
        seen.add(vault.toBase58());
        if (!vaultOf(config, program.programId).equals(vault)) continue;
        if (await fetchState(program, vault)) continue;
        const balance = await connection.getBalance(vault, "confirmed");
        // Only addresses that hold funds matter; settings the user merely tried out are noise.
        if (balance > 0) out.push({ n, vault, config, balance });
      }
    }
    setList(out);
  }, [signers, program, connection]);

  useEffect(() => {
    load().catch(() => setList([]));
  }, [load]);

  const create = async (p: Pending) => {
    if (!wallet.publicKey) return setVisible(true);
    setMsg(null);
    setBusy(p.vault.toBase58());
    try {
      const sig = await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [await initVaultIx(program, wallet.publicKey, p.config)]);
      setMsg({ kind: "ok", text: "Vault created.", sig });
      onCreated();
      await load();
    } catch (e) {
      setMsg({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!list.length) return null;
  return (
    <Panel title="not created yet">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <p className="text-[12.5px] leading-6 text-mute">
          These vaults were set up with your words but never finished. The address already exists and the funds on it are
          safe, but you can only use them once the vault is created.
        </p>
        {list.map((p) => (
          <div key={p.vault.toBase58()} className="flex flex-col gap-3 border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-dim">vault #{p.n}</div>
              <div className="mt-1 flex items-center gap-2 break-all text-[13px]">
                {p.vault.toBase58()} <Copy value={p.vault.toBase58()} />
              </div>
              <div className="mt-1 text-[12px] text-teal">{sol(p.balance)} SOL waiting</div>
            </div>
            <button className="btn shrink-0" disabled={!!busy} onClick={() => create(p)}>
              {busy === p.vault.toBase58() ? "confirm in wallet…" : wallet.publicKey ? "create it now" : "connect wallet"}
            </button>
          </div>
        ))}
        {msg && (
          <Note kind={msg.kind === "ok" ? "ok" : "bad"}>
            {msg.text}{" "}
            {msg.sig && (
              <a className="underline" href={explorerUrl(msg.sig, "tx")} target="_blank" rel="noreferrer">
                view
              </a>
            )}
          </Note>
        )}
        <p className="text-[11.5px] text-dim">
          Want different settings or $NOX first? Finish it in <Link href="/create" className="underline">create</Link> with the same words
          and settings.
        </p>
      </div>
    </Panel>
  );
}
