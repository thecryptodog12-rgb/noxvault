"use client";
// The action form shared by /offline (typed by hand on the signing device) and /submit (composed
// on the online device for air-gapped signing).
import type { Dispatch, SetStateAction } from "react";
import { Label } from "@/components/ui";
import { ACTION_KINDS, KIND_FIELDS, KIND_LABEL, type ActionForm } from "@/lib/offline";

type Props = { form: ActionForm; setForm: Dispatch<SetStateAction<ActionForm>> };

export function KindSelect({ form, setForm, disabled = false, value }: Props & { disabled?: boolean; value?: string }) {
  return (
    <select className="field" value={value ?? form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ActionForm["kind"] }))} disabled={disabled}>
      {ACTION_KINDS.map((k) => (
        <option key={k} value={k}>
          {KIND_LABEL[k]}
        </option>
      ))}
    </select>
  );
}

/** The fields of the selected action kind. */
export function ActionFields({ form, setForm }: Props) {
  const set = (k: keyof ActionForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const f = KIND_FIELDS[form.kind];
  const tokenAsset = f.includes("asset") && form.asset === "token";
  const field = (k: keyof ActionForm, label: string, extra: Record<string, string> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <input className="field" value={form[k] as string} onChange={set(k)} spellCheck={false} {...extra} />
    </div>
  );
  const unit = (k: "intervalUnit" | "periodUnit") => (
    <select className="field !w-24" value={form[k]} onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.value as "h" | "d" }))}>
      <option value="h">hours</option>
      <option value="d">days</option>
    </select>
  );
  return (
    <>
      {f.includes("asset") && (
        <>
          <div className="flex gap-2">
            {(["sol", "token"] as const).map((a) => (
              <button key={a} className={`btn sm ${form.asset === a ? "outline" : "ghost"}`} onClick={() => setForm((x) => ({ ...x, asset: a }))}>
                {a === "sol" ? "SOL" : "SPL / Token-2022"}
              </button>
            ))}
          </div>
          {tokenAsset && (
            <div className="grid grid-cols-[1fr_96px] gap-3">
              {field("mint", "mint")}
              {field("decimals", "decimals", { inputMode: "numeric" })}
            </div>
          )}
        </>
      )}
      {f.includes("id") && field("id", form.kind === "schedule" || form.kind === "cancelSchedule" ? "schedule slot (0–255)" : "budget slot (0–255)", { inputMode: "numeric" })}
      {f.includes("session") && field("session", "session wallet (an ordinary wallet that may spend)")}
      {f.includes("dest") && field("dest", form.kind === "schedule" ? "pay to" : "destination wallet")}
      {f.includes("vote") && field("vote", "validator vote account")}
      {f.includes("newVault") && field("newVault", "new vault address (must be an initialized Noxvault)")}
      <div className="grid grid-cols-2 gap-3">
        {f.includes("amount") &&
          field(
            "amount",
            `${form.kind === "schedule" ? "amount per payment" : form.kind === "budget" ? "limit per period" : "amount"} (${tokenAsset ? "tokens" : "SOL"})`,
            { inputMode: "decimal", placeholder: "0.0" }
          )}
        {f.includes("seed") && field("seed", "stake slot (0–7)", { inputMode: "numeric" })}
        {f.includes("count") && field("count", "number of payments", { inputMode: "numeric" })}
      </div>
      {f.includes("interval") && (
        <div className="flex flex-col gap-1.5">
          <Label>every</Label>
          <div className="flex gap-2">
            <input className="field flex-1" inputMode="decimal" value={form.interval} onChange={set("interval")} />
            {unit("intervalUnit")}
          </div>
        </div>
      )}
      {f.includes("period") && (
        <div className="flex flex-col gap-1.5">
          <Label>period</Label>
          <div className="flex gap-2">
            <input className="field flex-1" inputMode="decimal" value={form.period} onChange={set("period")} />
            {unit("periodUnit")}
          </div>
        </div>
      )}
      {f.includes("start") && field("start", "first payment", { type: "datetime-local" })}
      {f.includes("expires") && field("expires", "budget expires", { type: "datetime-local" })}
      {(form.kind === "schedule" || form.kind === "budget" || form.kind === "cancelSchedule" || form.kind === "cancelBudget") && (
        <p className="text-[11px] text-dim">Slots: take a free one (new) or the existing one (stop) from the online prepare step / vault view.</p>
      )}
    </>
  );
}

/** Relayer fee and payee. */
export function FeeFields({ form, setForm }: Props) {
  const set = (k: keyof ActionForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>fee (SOL)</Label>
        <input className="field" inputMode="decimal" value={form.fee} onChange={set("fee")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>fee payee (relayer)</Label>
        <input className="field" value={form.feePayee} onChange={set("feePayee")} disabled={!Number(form.fee)} placeholder={Number(form.fee) ? "relayer address" : "no fee: you submit with a wallet"} spellCheck={false} />
      </div>
    </div>
  );
}
