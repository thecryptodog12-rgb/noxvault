"use client";
import { Buffer } from "buffer";
import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletAdapterNetwork, type Adapter } from "@solana/wallet-adapter-base";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import { LedgerWalletAdapter } from "@solana/wallet-adapter-ledger";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import { NETWORK, RPC_URL } from "@/lib/config";
import "@solana/wallet-adapter-react-ui/styles.css";

if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export default function Providers({ children }: { children: ReactNode }) {
  // Installed wallets that speak the Wallet Standard (Phantom, Backpack, Solflare, Jupiter, OKX,
  // MetaMask, ...) are detected automatically; these adapters add the rest. WalletConnect (any
  // mobile wallet via QR) needs a Reown project id in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
  const wallets = useMemo(() => {
    const list: Adapter[] = [new SolflareWalletAdapter(), new CoinbaseWalletAdapter(), new TrustWalletAdapter(), new LedgerWalletAdapter()];
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    if (projectId && typeof window !== "undefined") {
      list.push(
        new WalletConnectWalletAdapter({
          network: NETWORK === "mainnet-beta" ? WalletAdapterNetwork.Mainnet : WalletAdapterNetwork.Devnet,
          options: {
            projectId,
            metadata: {
              name: "Noxvault",
              description: "The safer, quantum-proof wallet for Solana",
              url: window.location.origin,
              icons: [`${window.location.origin}/icon.svg`],
            },
          },
        }) as unknown as SolflareWalletAdapter
      );
    }
    return list;
  }, []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
