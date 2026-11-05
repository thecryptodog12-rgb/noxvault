import { chromium } from "playwright";
const [mode, outDir] = [process.argv[2], process.argv[3]];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args:["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file://" + process.env.S + "/video/index.html"); await p.evaluate(() => document.fonts.ready);
const times = mode === "preview" ? [3.5, 8.8, 15, 20, 24.8, 29.5] : Array.from({ length: 900 }, (_, i) => i / 30);
let i = 0;
for (const t of times) { await p.evaluate(t => render(t), t); await p.screenshot({ path: `${outDir}/f${String(i++).padStart(4, "0")}.${mode==="preview"?"png":"jpg"}`, ...(mode==="preview"?{}:{type:"jpeg",quality:96}) }); }
await b.close();
