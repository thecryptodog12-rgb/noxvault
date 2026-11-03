"use client";
// Rolling re-encryption (docs/SPEC.md §12): when the owner opens a vault and this browser holds
// its letter key, letters whose opening date came closer are sealed again to a later round.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicKey } from "@solana/web3.js";
import { SIGNER_SLOTS, type Signer } from "@nox/sdk/client";
import { useNox } from "@/lib/hooks";

/** Same storage key as lib/letters.ts (not imported here, so the vault page stays small). */
function hasLocalLetters(vault: PublicKey): boolean {
  try {
    return localStorage.getItem(`nox4.letters.${vault.toBase58()}`) !== null;
  } catch {
    return false;
  }
}

export default function LetterAutoRefresh({ vault, signer }: { vault: PublicKey; signer: Signer }) {
  const { program } = useNox();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // Signer phrases only: never in a recovery or duress session.
    if (signer.tree >= SIGNER_SLOTS || !hasLocalLetters(vault)) return;
    let live = true;
    (async () => {
      try {
        // Loaded only when this browser holds letters: keeps tlock out of the vault page bundle.
        const { loadLocalLetters, refreshLetters } = await import("@/lib/letters");
        const local = await loadLocalLetters(signer, vault);
        if (!local || !local.letters.length) return;
        const r = await refreshLetters(program, vault, local);
        if (!live) return;
        if (r.errors.length) setMsg({ ok: false, text: `Sealed letters could not all be refreshed: ${r.errors.join("; ")}` });
        else if (r.refreshed) setMsg({ ok: true, text: `${r.refreshed} sealed letter${r.refreshed > 1 ? "s" : ""} re-sealed to a later date.` });
      } catch (e) {
        if (live) setMsg({ ok: false, text: `Sealed letters were not refreshed: ${e instanceof Error ? e.message : String(e)}` });
      }
    })();
    return () => {
      live = false;
    };
  }, [program, vault, signer]);

  if (!msg) return null;
  return (
    <div className={`border-b border-line px-4 py-2 text-[12px] sm:px-5 ${msg.ok ? "text-teal" : "text-warn"}`}>
      {msg.text}{" "}
      <Link href="/letters" className="underline">
        sealed letters
      </Link>
    </div>
  );
}
