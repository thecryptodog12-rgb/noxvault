"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";
import type { Connection, Signer, Transaction } from "@solana/web3.js";
import { programDeployed, readProgram } from "./program";

let deployedCache: Promise<boolean> | null = null;

/** Read-only program + whether it is deployed on the configured cluster (null while checking). */
export function useNox() {
  const { connection } = useConnection();
  const w = useWallet();
  // The wallet only signs; we broadcast through this site's own RPC. With the wallet's
  // sendTransaction, Phantom broadcasts on whatever network it is set to (often mainnet), so a
  // devnet transaction never lands and expires ("block height exceeded").
  const wallet = useMemo(() => {
    const { signTransaction, publicKey } = w;
    if (!signTransaction || !publicKey) return w;
    const sendTransaction = async (
      tx: Transaction,
      conn: Connection,
      opts: { signers?: Signer[]; preflightCommitment?: "confirmed"; maxRetries?: number } = {}
    ): Promise<string> => {
      tx.feePayer ??= publicKey;
      if (!tx.recentBlockhash) {
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
      }
      if (opts.signers?.length) tx.partialSign(...opts.signers);
      const signed = await signTransaction(tx);
      return conn.sendRawTransaction(signed.serialize(), { preflightCommitment: opts.preflightCommitment ?? "confirmed", maxRetries: opts.maxRetries });
    };
    return { ...w, sendTransaction } as typeof w;
  }, [w]);
  const program = useMemo(() => readProgram(connection), [connection]);
  const [deployed, setDeployed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    deployedCache ??= programDeployed(connection, program).catch(() => false);
    deployedCache.then((d) => live && setDeployed(d));
    return () => {
      live = false;
    };
  }, [connection, program]);
  return { connection, program, wallet, deployed };
}

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
