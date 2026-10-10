"use client";
import type { SummaryRow } from "@/lib/offline";

/** Human-readable description of a signed action. */
export default function Summary({ headline, rows, digest }: { headline: string; rows: SummaryRow[]; digest?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="border-l-2 border-teal bg-teal/[0.05] px-3 py-2 text-[14px] font-bold leading-snug text-bone break-all">{headline}</div>
      <table className="tbl">
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td className="w-28 whitespace-nowrap text-dim">{r.k}</td>
              <td className={`break-all ${r.strong ? "text-bone" : "text-mute"}`}>{r.v}</td>
            </tr>
          ))}
          {digest && (
            <tr>
              <td className="w-28 whitespace-nowrap text-dim">digest</td>
              <td className="break-all text-[11px] text-dim">{digest}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
