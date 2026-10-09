"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState } from "react";
import { short } from "@/lib/format";

export default function WalletButton({ className = "" }: { className?: string }) {
  const { publicKey, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <button className={`btn w-full ${className}`}>connect wallet</button>;

  if (!publicKey) {
    return (
      <button className={`btn w-full ${className}`} onClick={() => setVisible(true)} disabled={connecting}>
        {connecting ? "connecting…" : "connect wallet"}
      </button>
    );
  }
  return (
    <div className={`relative ${className}`}>
      <button className="btn ghost w-full justify-between" onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2">
          {wallet?.adapter.icon && <img src={wallet.adapter.icon} alt="" className="h-3.5 w-3.5" />}
          {short(publicKey.toBase58())}
        </span>
        <span className="text-dim">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 border border-line-2 bg-ink-2 text-[12px]">
          <button
            className="block w-full px-3 py-2 text-left hover:bg-ink-3 hover:text-moon"
            onClick={() => {
              navigator.clipboard.writeText(publicKey.toBase58()).catch(() => {});
              setOpen(false);
            }}
          >
            copy address
          </button>
          <button
            className="block w-full px-3 py-2 text-left hover:bg-ink-3 hover:text-moon"
            onClick={() => {
              setOpen(false);
              setVisible(true);
            }}
          >
            change wallet
          </button>
          <button
            className="block w-full px-3 py-2 text-left hover:bg-ink-3 hover:text-bad"
            onClick={() => {
              setOpen(false);
              disconnect().catch(() => {});
            }}
          >
            disconnect
          </button>
        </div>
      )}
    </div>
  );
}
