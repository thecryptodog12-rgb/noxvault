"use client";
// Online half of air-gapped signing: compose the action here, show it as an animated QR for the
// offline device to scan. Leaf choice uses the same safe lookup as the prepare step (state bitmap
// plus every key that ever appeared in the vault's history).
import { useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { RECOVERY_TREE, TREE_PRIMARY } from "@nox/sdk/client";
import { Label, Note, Panel } from "@/components/ui";
import { useNox } from "@/lib/hooks";
import { fetchRelayerInfo } from "@/lib/unlock";
import { errMsg, fromBaseUnits } from "@/lib/format";
import { EMPTY_FORM, KIND_FIELDS, UNSIGNED_PREFIX, actionFromForm, encodeUnsigned, prepareLeaves, splitForQr, summarize, type ActionForm, type UnsignedRequest } from "@/lib/offline";
import { ActionFields, FeeFields, KindSelect } from "../offline/ActionFields";
import QrParts from "../offline/QrParts";
import Summary from "../offline/Summary";

const PART_SIZES = [
  { v: 200, l: "small parts" },
  { v: 400, l: "medium parts" },
  { v: 1000, l: "one QR if it fits" },
];

export default function Compose({ onComposed }: { onComposed: (u: UnsignedRequest | null) => void }) {
  const { program } = useNox();
  const [vault, setVault] = useState("");
  const [tree, setTree] = useState<number>(TREE_PRIMARY);
  const [leaf, setLeaf] = useState("");
  const [form, setForm] = useState<ActionForm>(EMPTY_FORM);
  const [lookup, setLookup] = useState<{ busy: boolean; err?: string; note?: string }>({ busy: false });
  const [composed, setComposed] = useState<{ u: UnsignedRequest; text: string } | null>(null);
  const [partSize, setPartSize] = useState(400);

  const draft = useMemo(() => {
    try {
      const v = new PublicKey(vault.trim());
      const l = Number(leaf);
      const max = tree === RECOVERY_TREE ? 15 : 255;
      if (leaf === "" || !Number.isInteger(l) || l < 0 || l > max) throw new Error(`Leaf must be 0–${max} (use "next safe leaf")`);
      const action = actionFromForm(form);
      const decimals = KIND_FIELDS[form.kind].includes("asset") && form.asset === "token" ? Number(form.decimals) : undefined;
      const u: UnsignedRequest = { vault: v, tree, leaf: l, action, decimals };
      return { ok: true as const, u, summary: summarize(v.toBase58(), tree, l, action, decimals) };
    } catch (e) {
      return { ok: false as const, err: errMsg(e) };
    }
  }, [vault, tree, leaf, form]);

  const reset = () => {
    setComposed(null);
    onComposed(null);
  };

  const nextLeaf = async () => {
    reset();
    setLookup({ busy: true });
    try {
      const v = new PublicKey(vault.trim());
      const [p, r] = await Promise.all([prepareLeaves(program, v), fetchRelayerInfo().catch(() => null)]);
      if (!p) throw new Error("No vault state found for this address on this network.");
      const slot = p.slots.find((x) => x.slot === tree);
      if (!slot) throw new Error(`This vault has no ${tree === RECOVERY_TREE ? "recovery key" : `signer in slot ${tree + 1}`}.`);
      if (slot.next === -1) throw new Error("No unused one-time keys left in this slot.");
      setLeaf(String(slot.next));
      if (r) setForm((f) => ({ ...f, fee: fromBaseUnits(BigInt(r.minFee), 9), feePayee: r.relayer }));
      setLookup({ busy: false, note: `Leaf #${slot.next} is unused on chain and never appeared in this vault's history.${r ? " Relayer fee filled in." : ""}` });
    } catch (e) {
      setLookup({ busy: false, err: errMsg(e) });
    }
  };

  const compose = () => {
    if (!draft.ok) return;
    const text = encodeUnsigned(draft.u);
    setComposed({ u: draft.u, text });
    onComposed(draft.u);
  };

  const parts = useMemo(() => (composed ? splitForQr(composed.text, partSize, UNSIGNED_PREFIX) : []), [composed, partSize]);
  const edit = <T,>(fn: (v: T) => void) => (v: T) => {
    reset();
    fn(v);
  };
  const setFormAndReset: typeof setForm = (v) => {
    reset();
    setForm(v);
  };

  return (
    <Panel title="A2 // air-gapped: send an action to your offline device" lit={!!composed}>
      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-mute">
            Compose the action here. Your offline device scans it on <Link href="/offline" className="text-teal">/offline</Link>, shows every
            field, signs it, and shows the signed request as a QR you scan back in B. No cable or clipboard between them.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>vault address</Label>
            <input className="field" value={vault} onChange={(e) => edit(setVault)(e.target.value)} placeholder="the vault's deposit address" spellCheck={false} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>signing slot</Label>
              <select className="field" value={tree} onChange={(e) => edit(setTree)(Number(e.target.value))}>
                <option value={TREE_PRIMARY}>signer 1 / owner</option>
                <option value={1}>signer 2 / co-signer</option>
                <option value={2}>signer 3 / co-signer</option>
                <option value={RECOVERY_TREE}>recovery</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>leaf (one-time key #)</Label>
              <div className="flex gap-2">
                <input className="field min-w-[3.5rem] flex-1" inputMode="numeric" value={leaf} onChange={(e) => edit(setLeaf)(e.target.value.trim())} placeholder="#" />
                <button className="btn ghost sm shrink-0" onClick={nextLeaf} disabled={lookup.busy || !vault.trim()}>
                  {lookup.busy ? "reading…" : "next safe leaf"}
                </button>
              </div>
            </div>
          </div>
          {lookup.err && <div className="text-[12px] text-bad">✕ {lookup.err}</div>}
          {lookup.note && <div className="text-[11.5px] text-teal">✓ {lookup.note}</div>}
          <div className="flex flex-col gap-1.5">
            <Label>action</Label>
            <KindSelect form={form} setForm={setFormAndReset} />
          </div>
          <ActionFields form={form} setForm={setFormAndReset} />
          <FeeFields form={form} setForm={setFormAndReset} />
        </div>

        <div className="flex flex-col gap-4">
          {draft.ok ? <Summary {...draft.summary} /> : <div className="text-[12.5px] text-dim">Fill in the action to see what the offline device will be asked to sign. ({draft.err})</div>}
          {!composed ? (
            <button className="btn self-start" onClick={compose} disabled={!draft.ok}>
              show as QR for the offline device
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label>unsigned action ({parts.length} part{parts.length === 1 ? "" : "s"})</Label>
                <select className="field !w-auto !py-1 text-[11.5px]" value={partSize} onChange={(e) => setPartSize(Number(e.target.value))}>
                  {PART_SIZES.map((p) => (
                    <option key={p.v} value={p.v}>
                      {p.l}
                    </option>
                  ))}
                </select>
              </div>
              <QrParts parts={parts} animate />
              <Note kind="info">
                This QR holds no secret and cannot move funds by itself. The offline device signs only after you check it there. When it
                shows the signed QR, scan it below in B: this page checks that it signs exactly this action.
              </Note>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
