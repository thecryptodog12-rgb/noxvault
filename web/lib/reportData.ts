// Loads the committed snapshot (content/exposure-report.json, written by scripts/exposure-report.ts).
// Returns null when there is no snapshot yet, so /report can show a "snapshot pending" state.
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExposureReport } from "./report";

export async function loadReport(): Promise<ExposureReport | null> {
  try {
    const raw = await readFile(join(process.cwd(), "content", "exposure-report.json"), "utf8");
    const r = JSON.parse(raw) as ExposureReport;
    return r?.version === 1 && typeof r.generatedAt === "string" ? r : null;
  } catch {
    return null;
  }
}
