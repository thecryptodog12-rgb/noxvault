"use client";
// Permissionless follow-ups (execute, run schedule, testament, migrate, sweep) sent by the
// connected wallet as fee payer. They cannot change anything that was signed.
import { useCallback, useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { TransactionInstruction } from "@solana/web3.js";
import { useNox } from "./hooks";
import { errMsg } from "./format";
import { sendIxs } from "./unlock";

export function useRunner(onDone?: () => void) {
  const { connection, wallet } = useNox();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string; sig?: string } | null>(null);
  const run = useCallback(
    async (id: string, build: () => Promise<TransactionInstruction[]>, okText: string) => {
      if (!wallet.publicKey) {
        setVisible(true);
        return;
      }
      setBusy(id);
      setMsg(null);
      try {
        const ixs = await build();
        let sig = "";
        // keep transactions small: a few instructions per transaction
        for (let i = 0; i < ixs.length; i += 4) sig = await sendIxs(connection, wallet.publicKey, wallet.sendTransaction, ixs.slice(i, i + 4));
        setMsg({ kind: "ok", text: okText, sig });
        onDone?.();
      } catch (e) {
        setMsg({ kind: "bad", text: errMsg(e) });
      } finally {
        setBusy(null);
      }
    },
    [connection, wallet, setVisible, onDone]
  );
  return { run, busy, msg, payer: wallet.publicKey };
}
