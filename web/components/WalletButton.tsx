"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { short } from "@/lib/format";

export default function WalletButton({ className = "" }: { className?: string }) {
  const { publicKey, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const base = `btn outline !px-4 !py-2.5 !text-[13px] ${className}`;
  if (!mounted || !publicKey) {
    return (
      <button className={base} onClick={() => setVisible(true)} disabled={mounted && connecting}>
        <Wallet size={16} strokeWidth={1.6} />
        {mounted && connecting ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button className="btn outline w-full !px-4 !py-2.5 !text-[13px]" onClick={() => setOpen((o) => !o)}>
        {wallet?.adapter.icon ? <img src={wallet.adapter.icon} alt="" className="h-4 w-4" /> : <Wallet size={16} />}
        {short(publicKey.toBase58())}
        <span className="text-[10px] opacity-70">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-md border border-line-2 bg-ink-2 text-[12px]">
          {[
            ["Copy address", () => navigator.clipboard.writeText(publicKey.toBase58()).catch(() => {})],
            ["Change wallet", () => setVisible(true)],
            ["Disconnect", () => disconnect().catch(() => {})],
          ].map(([t, fn]) => (
            <button
              key={t as string}
              className={`block w-full whitespace-nowrap px-4 py-2 text-left hover:bg-ink-3 ${t === "Disconnect" ? "hover:text-bad" : "hover:text-teal"}`}
              onClick={() => {
                setOpen(false);
                (fn as () => void)();
              }}
            >
              {t as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
