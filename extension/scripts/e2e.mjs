// End to end on devnet, through the real extension UI in full Chromium (--load-extension):
//   onboard (new phrase, confirm words, password) → create an Anti-theft vault (recovery phrase shown
//   once and confirmed; your funding wallet whitelisted) → fund it + the fee account from a funded key →
//   initialize (fee account) → send 0.06 SOL to a fresh, non-whitelisted address (above the 0.05 SOL
//   daily instant limit → pending 72 h) → cancel it with the recovery phrase → send the rest home to the
//   whitelisted funding wallet (instant) → return the fee account's SOL. Screenshots → docs/v0.2/.
//
//   pnpm run build && FUNDER=~/.config/solana/id.json node scripts/e2e.mjs
//
// FUNDER is a devnet keypair file with ≥ 0.15 SOL. Net cost: the vault's rent (~0.006 SOL, stays in the
// vault state account), relayer fees (0.0001 SOL per action), network fees. The Free-tier creation fee
// (0.01 SOL) goes to the protocol treasury. The phrases are generated at runtime and never written out;
// screenshots mask them.
import { chromium } from "playwright-core";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const docs = join(root, "docs", "v0.2");
mkdirSync(docs, { recursive: true });

const RPC = "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const funderPath = (process.env.FUNDER || "~/.config/solana/id.json").replace(/^~/, homedir());
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(funderPath, "utf8"))));
const VAULT_SOL = 0.1;
const FEE_SOL = 0.03;
const PASSWORD = `e2e-${Math.random().toString(36).slice(2)}-pass`;
const report = { funder: funder.publicKey.toBase58(), txs: {}, steps: [] };
const log = (...a) => {
  console.log(...a);
  report.steps.push(a.join(" "));
};

const startBal = await conn.getBalance(funder.publicKey);
log("funder", funder.publicKey.toBase58(), startBal / LAMPORTS_PER_SOL, "SOL");
if (startBal < 0.15 * LAMPORTS_PER_SOL) throw new Error("funder needs ≥ 0.15 SOL");

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "nox-e2e-")), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" }),
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 380, height: 600 },
  deviceScaleFactor: 2,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;
log("extension id", id);

const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("page console:", m.text()));
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto(`chrome-extension://${id}/popup.html`);

const view = (name, timeout = 30_000) => page.waitForSelector(`body[data-view="${name}"]`, { timeout });
const click = (sel) => page.click(sel);
let shotN = 0;
async function shot(name, { mask = false, full = false } = {}) {
  if (mask) await page.evaluate(() => document.querySelectorAll(".words li span:last-child").forEach((s) => (s.textContent = "•••••")));
  const file = `${String(++shotN).padStart(2, "0")}-${name}.png`;
  if (full) await page.evaluate(() => document.body.classList.add("full-shot"));
  await page.screenshot({ path: join(docs, file), fullPage: full });
  if (full) await page.evaluate(() => document.body.classList.remove("full-shot"));
  console.log("  shot", file);
}
const words = () => page.evaluate(() => [...document.querySelectorAll(".words li span:last-child")].map((s) => s.textContent).join(" "));
const steps = () => page.evaluate(() => [...document.querySelectorAll("[data-a='open-tx']")].map((b) => b.getAttribute("data-arg")));
async function transfer(to, sol) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
  return sendAndConfirmTransaction(conn, tx, [funder], { commitment: "confirmed" });
}

// ---------- onboarding ----------
await view("welcome");
await shot("welcome");
await click("[data-a='ob-new']");
await view("ob-show");
await shot("new-phrase-hidden");
await click("[data-a='ob-reveal']");
const phrase = await words();
if (phrase.split(" ").length !== 24) throw new Error("expected 24 words");
await shot("new-phrase-revealed-masked", { mask: true });
await click("[data-a='ob-wrote']");
await click("[data-a='ob-to-quiz']");
await view("ob-quiz");
const idx = await page.$$eval("form[data-a='ob-quiz'] label span", (ls) => ls.map((l) => Number(l.textContent.replace(/\D/g, "")) - 1));
const list = phrase.split(" ");
for (let k = 0; k < 3; k++) await page.fill(`input[name='w${k}']`, list[idx[k]]);
await page.evaluate(() => document.querySelectorAll("form[data-a='ob-quiz'] input").forEach((i) => (i.type = "password")));
await shot("confirm-words-masked");
await click("form[data-a='ob-quiz'] button[type='submit']");
await view("ob-password");
await page.fill("input[name='pw']", PASSWORD);
await page.fill("input[name='pw2']", PASSWORD);
await shot("password");
await click("form[data-a='ob-pw-submit'] button[type='submit']");
await view("home", 60_000);
await shot("home-empty");

// No plaintext phrase on disk.
const disk = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
for (const w of list) if (disk.includes(`"${w}"`) || disk.includes(` ${w} `)) throw new Error("phrase word found in storage.local");
if (disk.includes(PASSWORD)) throw new Error("password in storage");
log("storage.local holds no phrase / password ✓ (", disk.length, "bytes )");

// ---------- create an Anti-theft vault ----------
await click("[data-a='create-start']");
await view("create");
await shot("create-building-tree");
await page.waitForSelector("[data-a='cr-preset']", { timeout: 120_000 });
await page.click("[data-a='cr-preset'][data-arg='antitheft']");
await page.click("[data-a='cr-rec-gen']");
await page.waitForSelector("[data-a='cr-rec-ok']", { timeout: 60_000 });
const recovery = await words();
await shot("recovery-phrase-once-masked", { mask: true, full: true });
const rq = await page.$$eval("#rq0, #rq1", (els) => els.map((e) => Number(e.closest("label").querySelector("span").textContent.replace(/\D/g, "")) - 1));
const rl = recovery.split(" ");
await page.fill("#rq0", rl[rq[0]]);
await page.fill("#rq1", rl[rq[1]]);
await click("[data-a='cr-rec-ok']");
await page.waitForSelector(".note.ok-note");
// whitelist the funding wallet: payouts to it are instant
await page.fill("input[data-bind='whitelist.0']", funder.publicKey.toBase58());
await page.fill("input[data-bind='@label']", "E2E anti-theft");
await page.waitForSelector("[data-a='cr-review']:not([disabled])");
await shot("create-settings", { full: true });
await click("[data-a='cr-review']");
await shot("create-review", { full: true });
await click("[data-a='cr-save']");
await view("fund");
const vault = await page.$eval(".copybox code", (c) => c.textContent.trim());
report.vault = vault;
log("vault", vault);
// The recovery phrase must not be anywhere in the extension's storage.
const disk2 = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)) + JSON.stringify(await chrome.storage.session.get(null)));
if (rl.filter((w) => w.length > 4).some((w) => disk2.includes(`${w} `))) throw new Error("recovery words found in storage");
log("recovery phrase not stored ✓");
await shot("fund-unfunded");
if (process.env.STOP === "create") {
  log("STOP=create: stopping before any SOL moves");
  await ctx.close();
  process.exit(0);
}

// ---------- fund vault + fee account, initialize with the fee account ----------
const { accounts } = await sw.evaluate(() => chrome.storage.local.get("accounts"));
const feeAddr = new PublicKey(accounts[0].feeAddress);
report.feeAccount = feeAddr.toBase58();
report.txs.depositVault = await transfer(new PublicKey(vault), VAULT_SOL);
report.txs.fundFeeAccount = await transfer(feeAddr, FEE_SOL);
log("deposited", VAULT_SOL, "SOL to vault:", report.txs.depositVault);
log("funded fee account", FEE_SOL, "SOL:", report.txs.fundFeeAccount);
await page.waitForSelector("[data-a='fund-fee']:not([disabled])", { timeout: 60_000 });
await shot("fund-funded");
await click("[data-a='fund-fee']");
await page.waitForFunction(() => /Vault initialized|initialized/.test(document.querySelector(".kv dd")?.textContent ?? ""), null, { timeout: 90_000 });
await page.waitForSelector(".alert.okc", { timeout: 60_000 });
report.txs.init = await page.evaluate(() => document.querySelector(".note.ok-note")?.textContent ?? "");
log("init:", report.txs.init);
await shot("fund-initialized");

// ---------- vault home ----------
await sw.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: "refresh" }, r)).catch(() => {}));
await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh" }));
await click("[data-a='detail']");
await view("vault");
await page.waitForSelector(".hero .bal", { timeout: 60_000 });
await page.waitForTimeout(2500);
await shot("vault-home", { full: true });
await click("[data-a='home']");
await view("home");
await shot("home-with-vault");
await click("[data-a='detail']");
await view("vault");

// ---------- send 0.06 SOL to a fresh non-whitelisted address → pending ----------
const stranger = Keypair.generate().publicKey.toBase58();
await click("[data-a='send-start']");
await view("sign");
await page.waitForSelector("form[data-a='sign-form']", { timeout: 120_000 });
await page.fill("input[name='amount']", "0.06");
await page.fill("input[name='dest']", stranger);
await shot("send-form");
await click("form[data-a='sign-form'] button[type='submit']");
await page.waitForSelector("[data-a='sign-go']", { timeout: 120_000 });
if (await page.$("[data-a='sign-consent']")) await click("[data-a='sign-consent']");
await shot("send-review-pending-warning", { full: true });
await click("[data-a='sign-go']");
await page.waitForSelector(".alert.warnc .t, .alert.okc .t", { timeout: 240_000 });
await page.waitForFunction(() => document.body.dataset.view === "sign" && !!document.querySelector("[data-a='sign-back'].btn.primary"), null, { timeout: 240_000 });
report.txs.withdrawPending = await steps();
log("withdraw 0.06 (pending):", report.txs.withdrawPending.join(" "));
await shot("send-done-pending");
const st1 = await conn.getAccountInfo(new PublicKey(vault));
log("vault balance after queued withdraw", st1.lamports / LAMPORTS_PER_SOL);

// ---------- vault shows the pending payout; cancel with the recovery phrase ----------
await click("[data-a='sign-back']");
await view("vault");
await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh" }));
await page.waitForSelector("[data-a='cancel-start']", { timeout: 60_000 });
await page.waitForTimeout(800);
await shot("vault-pending", { full: true });
await click(".alert [data-a='cancel-start']");
await view("sign");
await page.waitForSelector("[data-a='cancel-recovery']");
await shot("cancel-choose");
await click("[data-a='cancel-recovery']");
await page.waitForSelector("form[data-a='rec-submit']");
await shot("cancel-recovery-phrase");
await page.fill("textarea[name='words']", recovery);
await page.fill("input[name='n']", "0");
await click("form[data-a='rec-submit'] button[type='submit']");
await page.waitForSelector("[data-a='sign-go']", { timeout: 180_000 });
await shot("cancel-review", { full: true });
await click("[data-a='sign-go']");
await page.waitForFunction(() => !!document.querySelector("[data-a='sign-back'].btn.primary"), null, { timeout: 240_000 });
report.txs.cancelWithRecovery = await steps();
log("cancel with recovery:", report.txs.cancelWithRecovery.join(" "));
await shot("cancel-done");
// the recovery phrase must be gone from the page
const leftover = await page.evaluate((w) => document.body.innerHTML.includes(w), rl.slice(0, 3).join(" "));
if (leftover) throw new Error("recovery words still in the DOM");

// ---------- send the rest home to the whitelisted funder (instant) ----------
await click("[data-a='sign-back']");
await view("vault");
await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh" }));
await page.waitForFunction(() => !document.querySelector(".alert [data-a='cancel-start']"), null, { timeout: 60_000 });
await click("[data-a='send-start']");
await page.waitForSelector("form[data-a='sign-form']", { timeout: 120_000 });
await click("[data-a='sign-max']");
await page.fill("input[name='dest']", funder.publicKey.toBase58());
await click("form[data-a='sign-form'] button[type='submit']");
await page.waitForSelector("[data-a='sign-go']", { timeout: 120_000 });
if (await page.$("[data-a='sign-consent']")) await click("[data-a='sign-consent']");
await shot("send-home-review-instant", { full: true });
await click("[data-a='sign-go']");
await page.waitForFunction(() => !!document.querySelector("[data-a='sign-back'].btn.primary"), null, { timeout: 240_000 });
report.txs.withdrawHome = await steps();
log("withdraw rest home (instant):", report.txs.withdrawHome.join(" "));
await shot("send-home-done");

// ---------- deposit, settings, account, lock ----------
await click("[data-a='sign-back']");
await view("vault");
await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh" }));
await page.waitForTimeout(3000);
await shot("vault-after", { full: true });
await click("[data-a='deposit']");
await view("deposit");
await shot("deposit");
await click("[data-a='settings']");
await view("settings");
await page.waitForTimeout(1500);
await shot("settings", { full: true });
await click("[data-a='acct-open']");
await view("account");
await shot("account", { full: true });
await click("[data-a='lock-now']");
await view("home");
await shot("home-locked");
await click("[data-a='go-lock']");
await view("lock");
await page.fill("input[name='pw']", "wrong-password-1");
await click("form[data-a='lock-submit'] button[type='submit']");
await page.waitForSelector(".err");
await shot("lock-wrong-password");
await page.fill("input[name='pw']", PASSWORD);
await click("form[data-a='lock-submit'] button[type='submit']");
await view("home");
log("unlock after wrong password ✓");

// popup-sized shot of the create entry with the expand button, and a tab-sized create screen
const tab = await ctx.newPage();
await tab.setViewportSize({ width: 1100, height: 900 });
await tab.goto(`chrome-extension://${id}/popup.html?tab=1#create`);
await tab.waitForSelector("[data-a='cr-preset']", { timeout: 120_000 });
await tab.screenshot({ path: join(docs, `${String(++shotN).padStart(2, "0")}-create-in-tab.png`) });

// ---------- return the fee account's SOL ----------
const master = mnemonicToEntropy(phrase, wordlist);
const fee = Keypair.fromSeed(sha256(new Uint8Array([...new TextEncoder().encode("nox-ext/fee-account/v1"), ...master])));
if (!fee.publicKey.equals(feeAddr)) throw new Error("fee account derivation mismatch");
const feeBal = await conn.getBalance(fee.publicKey);
if (feeBal > 5000) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: fee.publicKey, toPubkey: funder.publicKey, lamports: feeBal - 5000 }));
  report.txs.returnFee = await sendAndConfirmTransaction(conn, tx, [fee], { commitment: "confirmed" });
  log("returned fee account SOL:", (feeBal - 5000) / LAMPORTS_PER_SOL, report.txs.returnFee);
}
const endBal = await conn.getBalance(funder.publicKey);
const vaultLeft = await conn.getBalance(new PublicKey(vault));
report.spentSol = (startBal - endBal) / LAMPORTS_PER_SOL;
report.vaultLeft = vaultLeft / LAMPORTS_PER_SOL;
log("funder spent", report.spentSol, "SOL net; vault holds", report.vaultLeft, "SOL");
writeFileSync(join(docs, "e2e-report.json"), JSON.stringify(report, null, 2) + "\n");
await ctx.close();
