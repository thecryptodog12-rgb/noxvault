"use client";
import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { Label, Note } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { errMsg, fromBaseUnits, toBaseUnits } from "@/lib/format";
import { explorerUrl } from "@/lib/config";
import { sendIxs } from "@/lib/unlock";

export default function TokenDeposit({
  vault,
  disabled,
  presetMint,
  label,
  onSent,
}: {
  vault: PublicKey | null;
  disabled: boolean;
  /** fix the mint (e.g. $NOX) and open the form directly */
  presetMint?: string;
  label?: string;
  onSent?: () => void;
}) {
  const { connection, wallet } = useNox();
  const [open, setOpen] = useState(!!presetMint);
  const [mint, setMint] = useState(presetMint ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ kind: "ok" | "bad"; text: string; sig?: string } | null>(null);

  const send = async () => {
    if (!vault || !wallet.publicKey) return;
    setRes(null);
    setBusy(true);
    try {
      const mintPk = new PublicKey(mint.trim());
      const info = await connection.getAccountInfo(mintPk);
      if (!info) throw new Error("Mint not found");
      const tokenProgram = info.owner;
      const m = await getMint(connection, mintPk, "confirmed", tokenProgram);
      const units = toBaseUnits(amount, m.decimals);
      const from = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, false, tokenProgram);
      const to = getAssociatedTokenAddressSync(mintPk, vault, true, tokenProgram);
      const sig = await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, [
        createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, to, vault, mintPk, tokenProgram),
        createTransferCheckedInstruction(from, mintPk, to, wallet.publicKey, units, m.decimals, [], tokenProgram),
      ]);
      setRes({ kind: "ok", text: `Sent ${fromBaseUnits(units, m.decimals)} tokens to the vault.`, sig });
      onSent?.();
    } catch (e) {
      setRes({ kind: "bad", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button className="self-start text-[11px] uppercase tracking-[0.18em] text-dim hover:text-teal" onClick={() => setOpen(true)}>
        [+ deposit an spl token instead]
      </button>
    );
  return (
    <div className="flex flex-col gap-2 border border-dashed border-line p-3">
      <Label>{label ?? "spl / token-2022 deposit"}</Label>
      {!presetMint && <input className="field" placeholder="mint address" value={mint} onChange={(e) => setMint(e.target.value)} spellCheck={false} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field flex-1" placeholder="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="btn" onClick={send} disabled={busy || disabled || !mint || !amount}>
          {busy ? "sending…" : "deposit token"}
        </button>
      </div>
      <p className="text-[11px] text-dim">Creates the vault&apos;s token account (owner = vault) if needed, then transfers.</p>
      {res && (
        <Note kind={res.kind}>
          {res.text}{" "}
          {res.sig && (
            <a className="underline" href={explorerUrl(res.sig, "tx")} target="_blank" rel="noreferrer">
              view tx
            </a>
          )}
        </Note>
      )}
    </div>
  );
}
