"use client";
import { Download } from "lucide-react";

/** The browser's own "Save as PDF" with print styles: no server-side PDF build needed. */
export default function PrintButton() {
  return (
    <button className="btn ghost sm" onClick={() => window.print()}>
      <Download size={14} /> Save as PDF
    </button>
  );
}
