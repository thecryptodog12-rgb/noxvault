"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";
import { programDeployed, readProgram } from "./program";

let deployedCache: Promise<boolean> | null = null;

/** Read-only program + whether it is deployed on the configured cluster (null while checking). */
export function useNox() {
  const { connection } = useConnection();
  const wallet = useWallet();
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
