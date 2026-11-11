// Renders public/icons/icon-{16,32,48,128}.png from the site's icon (web/public/icon.svg) with
// Playwright's Chromium. Run once after changing the icon; the PNGs are committed.
// Needs a Chromium for playwright-core: `npx playwright install chromium`, or set CHROMIUM_PATH.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "..", "web", "public", "icon.svg"), "utf8");
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(out, `icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`icon-${size}.png`);
}
await browser.close();
