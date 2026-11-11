// Loads dist/ into Playwright's full Chromium (extensions need it, not the headless shell), watches
// real devnet vaults and screenshots the popup at 380x600 into docs/. Read-only RPC.
//   pnpm run build && node scripts/screenshot.mjs
// CHROMIUM_PATH overrides the browser binary.
import { chromium } from "playwright-core";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const docs = join(root, "docs");
mkdirSync(docs, { recursive: true });

const VAULTS = [
  { address: "Fdk8pnieuenEVDiBFxz6Bp7rsm8BFQc2o7V1cTTzHTow", label: "Savings" },
  { address: "3wVPA3xxaLyb3yP6WJN2pcfWaMAPukgfHmR1pwV9SbfM", label: "Ops" },
  { address: "7GzFijW3syXxxwxCBdqHSLzdypPwTYTi73aNdaa9jGV", label: "Family 2-of-2" },
];

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "nox-ext-")), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" }), // full Chromium: the headless shell has no extensions
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 380, height: 600 },
  deviceScaleFactor: 2,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;
console.log("extension id", id);

const now = Math.floor(Date.now() / 1000);
await sw.evaluate(
  async ({ vaults, now }) => {
    await chrome.storage.local.set({ watched: vaults.map((v, i) => ({ ...v, cluster: "devnet", addedAt: now - i })) });
  },
  { vaults: VAULTS, now }
);

const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("popup console:", m.text()));
page.on("pageerror", (e) => console.log("popup error:", e.message));
await page.goto(`chrome-extension://${id}/popup.html`);

// The popup asks the worker to refresh stale vaults; wait until all three have a snapshot.
await page.waitForFunction(
  async (n) => {
    const { status = {} } = await chrome.storage.local.get("status");
    return Object.values(status).filter((s) => s && (s.snap || s.error || s.notFound)).length >= n;
  },
  VAULTS.length,
  { timeout: 120_000, polling: 1000 }
);
await page.waitForTimeout(800);
const shot = async (name) => {
  await page.screenshot({ path: join(docs, name) });
  console.log("saved docs/" + name);
};
await shot("popup-vaults.png");

await page.click(`[data-detail="devnet:${VAULTS[0].address}"]`);
await page.waitForTimeout(300);
await shot("popup-vault-detail.png");

await page.click("[data-deposit]");
await page.waitForTimeout(300);
await shot("popup-deposit.png");

await page.click('[data-act="home"], .back');
await page.click('[data-act="add"]');
await page.waitForTimeout(200);
await shot("popup-add.png");

await page.click('[data-act="settings"]');
await page.waitForTimeout(200);
await shot("popup-settings.png");

// Let any running poll finish and stop the schedule, so nothing overwrites the simulation below.
await sw.evaluate(() => chrome.alarms.clearAll());
await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh", only: [] }));

// What an alert looks like. SIMULATED: a pending withdrawal and a lockdown are written into the
// stored snapshot of a real vault (none of the devnet vaults has one right now).
await sw.evaluate(async ({ vault, now }) => {
  const key = `devnet:${vault}`;
  const { status } = await chrome.storage.local.get("status");
  const s = status[key];
  s.snap = { ...s.snap, pending: { kind: "withdraw", mint: "11111111111111111111111111111111", dest: "DmpPGVKPkhsxAWxW5WaxReDa2QxdJZvXk8BaG1SwQXAC", amount: "42000000000", executableAt: now + 71 * 3600 + 7 }, lamports: 42_034_000_000 };
  await chrome.storage.local.set({ status });
}, { vault: VAULTS[0].address, now });
await page.click('[data-act="home"]');
await page.waitForTimeout(400);
await shot("popup-alert-simulated.png");
await page.click(`[data-detail="devnet:${VAULTS[0].address}"]`);
await page.waitForTimeout(300);
await shot("popup-pending-simulated.png");

const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
console.log("badge text:", JSON.stringify(badge));
await ctx.close();
