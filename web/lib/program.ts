import { AnchorProvider, Program, type Provider } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import { idl, type Noxvault } from "@nox/sdk/client";

/** Read-only program: enough for account fetches and building instructions. */
export function readProgram(connection: Connection): Program<Noxvault> {
  return new Program(idl as unknown as Noxvault, { connection } as Provider);
}

export function walletProgram(connection: Connection, wallet: AnchorWallet): Program<Noxvault> {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program(idl as unknown as Noxvault, provider);
}

/** True when the program account exists on the configured cluster. */
export async function programDeployed(connection: Connection, program: Program<Noxvault>): Promise<boolean> {
  const info = await connection.getAccountInfo(program.programId);
  return !!info?.executable;
}
