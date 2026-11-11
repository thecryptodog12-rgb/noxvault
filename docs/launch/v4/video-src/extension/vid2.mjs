import { chromium } from "playwright-core";
const [mode, outDir, dur] = [process.argv[2], process.argv[3], Number(process.argv[4] || 32)];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file://" + process.env.SRC); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
const times = mode === "preview" ? [2.5, 7, 13, 18, 22, 26.5, 31] : Array.from({ length: Math.round(dur * 30) }, (_, i) => i / 30);
let i = 0;
for (const t of times) { await p.evaluate(t => render(t), t); await p.screenshot({ path: `${outDir}/f${String(i++).padStart(4, "0")}.${mode === "preview" ? "png" : "jpg"}`, ...(mode === "preview" ? {} : { type: "jpeg", quality: 95 }) }); }
await b.close();
