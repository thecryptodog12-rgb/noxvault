// v0.3 end to end, through the real extension UI in full Chromium (--load-extension):
//   onboard (new phrase) → wallet #1 = m/44'/501'/0'/0' of the phrase (checked against an independent
//   implementation) → fund it on devnet from FUNDER → holdings show it → Send 0.01 SOL to FUNDER →
//   activity → "Protect it": Personal vault, paid and initialized by the wallet (no relayer) → move SOL
//   from the wallet into the vault → the vault shows it → withdraw from the vault with one-time keys,
//   the wallet paying the network fee (default payer) → import a wallet (public test mnemonic), export-key
//   screen (blurred) → read-only mainnet holdings of a large public wallet, with prices → return the
//   wallet's devnet SOL to FUNDER with Send (Max). Screenshots → docs/v0.3/, every phrase / key masked.
//
//   pnpm run build && FUNDER=~/.config/solana/id.json node scripts/e2e-v03.mjs
//
// Spends at most ~0.03 SOL net (creation fee 0.01 to the protocol treasury, the vault's rent, network
// fees); it moves 0.12 SOL to the test wallet and returns what is left. The phrase is generated at runtime
// and never written to disk.
import { chromium } from "playwright-core";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { derivePath } from "ed25519-hd-key";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const docs = join(root, "docs", "v0.3");
mkdirSync(docs, { recursive: true });

const RPC = "https://api.devnet.solana.com";
const rawConn = new Connection(RPC, "confirmed");
// public devnet RPC rate-limits: retry the script's own reads
const retry = async (fn, n = 6) => {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= n) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
};
const conn = new Proxy(rawConn, {
  get(t, k) {
    const v = t[k];
    return typeof v === "function" && ["getBalance", "getTransaction", "getAccountInfo"].includes(k) ? (...a) => retry(() => v.apply(t, a)) : typeof v === "function" ? v.bind(t) : v;
  },
});
const funderPath = (process.env.FUNDER || "~/.config/solana/id.json").replace(/^~/, homedir());
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(funderPath, "utf8"))));
const WALLET_SOL = 0.12;
const MOVE_SOL = "0.03";
// A large public wallet (an exchange hot wallet, labelled as such by public explorers). Read-only.
const PUBLIC_MAINNET = process.env.PUBLIC_WALLET || "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S";
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PASSWORD = `e2e-${Math.random().toString(36).slice(2)}-pass`;
const report = { funder: funder.publicKey.toBase58(), txs: {}, steps: [] };
const log = (...a) => {
  console.log(...a);
  report.steps.push(a.join(" "));
};

const startBal = await conn.getBalance(funder.publicKey);
log("funder", funder.publicKey.toBase58(), startBal / LAMPORTS_PER_SOL, "SOL");
if (startBal < 0.2 * LAMPORTS_PER_SOL) throw new Error("funder needs ≥ 0.2 SOL");

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "nox-e2e3-")), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" }),
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 380, height: 600 },
  deviceScaleFactor: 2,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("page console:", m.text()));
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto(`chrome-extension://${id}/popup.html`);

const view = (name, timeout = 30_000) => page.waitForSelector(`body[data-view="${name}"]`, { timeout });
const click = (sel) => page.click(sel);
let shotN = 0;
async function shot(name, { full = false } = {}) {
  // never a phrase or key in a screenshot
  await page.evaluate(() => {
    document.querySelectorAll(".words li span:last-child").forEach((s) => (s.textContent = "•••••"));
    document.querySelectorAll(".keybox").forEach((s) => (s.textContent = "•".repeat(88)));
    document.querySelectorAll("textarea").forEach((t) => (t.value = t.value ? "•••• •••• •••• (masked)" : ""));
  });
  const file = `${String(++shotN).padStart(2, "0")}-${name}.png`;
  if (full) await page.evaluate(() => document.body.classList.add("full-shot"));
  await page.screenshot({ path: join(docs, file), fullPage: full });
  if (full) await page.evaluate(() => document.body.classList.remove("full-shot"));
  console.log("  shot", file);
}
const words = () => page.evaluate(() => [...document.querySelectorAll(".words li span:last-child")].map((s) => s.textContent).join(" "));
const sigFromLink = (sel) => page.$eval(sel, (b) => (b.getAttribute("data-arg") || "").split("/tx/")[1]?.split("?")[0]);
async function transfer(to, sol) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
  return sendAndConfirmTransaction(conn, tx, [funder], { commitment: "confirmed" });
}
const local = () => sw.evaluate(async () => chrome.storage.local.get(null));

let walletKp = null; // derived here from the runtime phrase only to sweep leftovers if a step fails
try {
  // ---------- onboarding ----------
  await view("welcome");
  await shot("welcome");
  await click("[data-a='ob-new']");
  await view("ob-show");
  await click("[data-a='ob-reveal']");
  const phrase = await words();
  await click("[data-a='ob-wrote']");
  await click("[data-a='ob-to-quiz']");
  await view("ob-quiz");
  const idx = await page.$$eval("form[data-a='ob-quiz'] label span", (ls) => ls.map((l) => Number(l.textContent.replace(/\D/g, "")) - 1));
  const list = phrase.split(" ");
  for (let k = 0; k < 3; k++) await page.fill(`input[name='w${k}']`, list[idx[k]]);
  await click("form[data-a='ob-quiz'] button[type='submit']");
  await view("ob-password");
  await page.fill("input[name='pw']", PASSWORD);
  await page.fill("input[name='pw2']", PASSWORD);
  await click("form[data-a='ob-pw-submit'] button[type='submit']");
  await view("home", 60_000);
  await page.waitForSelector(".tok, .panel .bad", { timeout: 60_000 });
  await shot("home-mainnet-new-wallet");

  // wallet #1 is the standard Phantom path of this phrase
  const st = await local();
  const w1 = st.wallets[0];
  const seed = mnemonicToSeedSync(phrase);
  const ref = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", Buffer.from(seed).toString("hex")).key);
  if (w1.address !== ref.publicKey.toBase58()) throw new Error("wallet #1 is not m/44'/501'/0'/0'");
  walletKp = ref;
  report.wallet = w1.address;
  log("wallet #1", w1.address, "= m/44'/501'/0'/0' of the phrase (ed25519-hd-key) ✓");
  const disk = JSON.stringify(st);
  if (list.some((w) => disk.includes(` ${w} `)) || disk.includes(Buffer.from(ref.secretKey.slice(0, 32)).toString("hex")) || disk.includes(PASSWORD)) throw new Error("secret material on disk");
  log("storage.local holds no phrase, wallet seed or password ✓");
  const probe = await page.evaluate(async () => {
    const r = await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }) });
    return r.status;
  });
  log("mainnet RPC from the extension page:", probe);
  if (process.env.STOP === "home") throw new Error("STOP=home (no SOL moved)");

  // ---------- devnet: fund, holdings ----------
  await click("[data-a='w-net'][data-arg='devnet']");
  report.txs.fundWallet = await transfer(new PublicKey(w1.address), WALLET_SOL);
  log("funded wallet", WALLET_SOL, "SOL:", report.txs.fundWallet);
  await click("#refresh-btn");
  await page.waitForFunction(() => /0\.12/.test(document.querySelector(".tok .tk-amt")?.textContent ?? ""), null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot("home-devnet-funded", { full: true });

  // ---------- send 0.01 SOL ----------
  await click(".bigbtns [data-a='w-send']");
  await view("wsend");
  await page.waitForSelector("form[data-a='ws-form']");
  await page.fill("input[name='amount']", "0.01");
  await page.fill("input[name='dest']", funder.publicKey.toBase58());
  await shot("send-form");
  await click("form[data-a='ws-form'] button[type='submit']");
  await page.waitForSelector("[data-a='ws-go']", { timeout: 60_000 });
  await shot("send-review", { full: true });
  await click("[data-a='ws-go']");
  await page.waitForSelector(".alert.okc", { timeout: 90_000 });
  report.txs.sendSol = await sigFromLink(".alert.okc [data-a='open']");
  log("sent 0.01 SOL to funder:", report.txs.sendSol);
  await shot("send-done");
  await click("[data-a='home']");
  await view("home");
  await page.waitForSelector(".actrow", { timeout: 90_000 });
  await page.waitForTimeout(1000);
  await shot("home-activity", { full: true });

  // ---------- Protect it: vault paid by the wallet ----------
  await click(".bigbtns [data-a='w-protect']");
  await view("protect");
  await page.waitForSelector("[data-a='protect-go']:not([disabled])", { timeout: 60_000 });
  await shot("protect", { full: true });
  await click("[data-a='protect-go']");
  await view("create");
  await page.waitForSelector("[data-a='cr-preset']", { timeout: 180_000 });
  await page.click("[data-a='cr-preset'][data-arg='personal']");
  await page.fill("input[data-bind='@label']", "E2E protected");
  await page.waitForSelector("[data-a='cr-review']:not([disabled])");
  await shot("protect-create-settings", { full: true });
  await click("[data-a='cr-review']");
  await click("[data-a='cr-save']");
  await view("fund");
  const vault = await page.$eval(".copybox code", (c) => c.textContent.trim());
  report.vault = vault;
  log("vault", vault);
  await page.waitForSelector("[data-a='fund-fee']:not([disabled])", { timeout: 90_000 });
  await shot("protect-fund-wallet-pays", { full: true });
  await click("[data-a='fund-fee']");
  await view("wmove", 120_000);
  report.txs.initByWallet = await page.$eval("#init-sig", (b) => b.dataset.sig);
  log("vault initialized, paid by the wallet:", report.txs.initByWallet);
  const initTx = await conn.getTransaction(report.txs.initByWallet, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const feePayer = initTx.transaction.message.staticAccountKeys[0].toBase58();
  if (feePayer !== w1.address) throw new Error(`init fee payer ${feePayer} is not the wallet`);
  log("init fee payer = wallet #1 ✓ (no relayer)");

  // ---------- move SOL from the wallet into the vault ----------
  await page.waitForSelector(".mvamt", { timeout: 60_000 });
  await shot("move-prefilled");
  await page.fill(".mvamt[data-i='0']", MOVE_SOL);
  await click("[data-a='mv-review']");
  await page.waitForSelector("[data-a='mv-go']", { timeout: 60_000 });
  await shot("move-review");
  await click("[data-a='mv-go']");
  await page.waitForSelector("#move-done", { timeout: 120_000 });
  report.txs.moveIntoVault = await page.$$eval("#move-done [data-a='open']", (bs) => bs.map((b) => (b.getAttribute("data-arg") || "").split("/tx/")[1]?.split("?")[0]));
  log("moved", MOVE_SOL, "SOL into the vault:", report.txs.moveIntoVault.join(" "));
  await shot("move-done");
  await click("[data-a='detail']");
  await view("vault");
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "refresh" }));
  await page.waitForFunction(() => Number((document.querySelector(".hero .bal")?.textContent ?? "0").replace(/[^\d.]/g, "")) >= 0.03, null, { timeout: 90_000 });
  const vaultBal = await conn.getBalance(new PublicKey(vault));
  log("vault shows the deposit; on chain", vaultBal / LAMPORTS_PER_SOL, "SOL");
  await page.waitForTimeout(2000);
  await shot("vault-after-deposit", { full: true });

  // ---------- withdraw from the vault: one-time key, the wallet pays the network fee ----------
  await click("[data-a='send-start']");
  await view("sign");
  await page.waitForSelector("form[data-a='sign-form']", { timeout: 180_000 });
  const mode = await page.$eval("select[name='mode']", (s) => s.value);
  if (mode !== "wallet") throw new Error(`default payer is ${mode}, expected the wallet`);
  log("vault send: default payer = wallet ✓");
  await click("[data-a='sign-max']");
  await page.fill("input[name='dest']", funder.publicKey.toBase58());
  await shot("vault-send-wallet-pays");
  await click("form[data-a='sign-form'] button[type='submit']");
  await page.waitForSelector("[data-a='sign-go']", { timeout: 180_000 });
  if (await page.$("[data-a='sign-consent']")) await click("[data-a='sign-consent']");
  await shot("vault-send-review", { full: true });
  await click("[data-a='sign-go']");
  await page.waitForFunction(() => !!document.querySelector("[data-a='sign-back'].btn.primary"), null, { timeout: 300_000 });
  report.txs.vaultWithdraw = await page.evaluate(() => [...document.querySelectorAll("[data-a='open-tx']")].map((b) => b.getAttribute("data-arg")));
  log("vault withdraw (wallet paid fees):", report.txs.vaultWithdraw.join(" "));
  await shot("vault-send-done");

  // ---------- accounts: import, manage, export (blurred) ----------
  await click("[data-a='home']");
  await view("home");
  await click("[data-a='wallets']");
  await view("wallets");
  await click("[data-a='wimport-open']");
  await view("wimport");
  await page.fill("input[name='name']", "Test mnemonic");
  await page.fill("input[name='pw']", PASSWORD);
  await page.fill("textarea[name='secret']", "masked masked masked");
  await shot("import-wallet");
  await page.fill("textarea[name='secret']", ABANDON);
  await click("form[data-a='wimport-submit'] button[type='submit']");
  await view("home", 60_000);
  const st2 = await local();
  const imported = st2.wallets.find((w) => w.kind === "imported-phrase");
  if (imported?.address !== "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk") throw new Error("imported address mismatch");
  if (JSON.stringify(st2).includes("abandon abandon")) throw new Error("imported phrase on disk");
  log("imported the 'abandon … about' test phrase → HAgk14Jp…Kpqk (published Phantom address) ✓; not on disk ✓");
  await click("[data-a='wallets']");
  await view("wallets");
  await page.waitForTimeout(2500);
  await shot("wallet-accounts");
  await click(`[data-a='wmanage-open'][data-arg='${w1.id}']`);
  await view("wmanage");
  await page.fill("form[data-a='wm-export'] input[name='pw']", PASSWORD);
  await click("form[data-a='wm-export'] button[type='submit']");
  await page.waitForSelector(".keybox");
  const exported = await page.$eval(".keybox", (k) => k.textContent.trim());
  if (Keypair.fromSecretKey(Uint8Array.from(bs58decode(exported))).publicKey.toBase58() !== w1.address) throw new Error("export mismatch");
  log("export private key behind password ✓ (matches wallet #1)");
  await shot("export-key-blurred", { full: true });
  await click("[data-a='wm-hide']");

  // ---------- settings ----------
  await click("[data-a='settings']");
  await view("settings");
  await shot("settings", { full: true });

  // ---------- return the wallet's devnet SOL with Send (Max) ----------
  await click("[data-a='wallets']");
  await view("wallets");
  await click(`[data-a='w-select'][data-arg='${w1.id}']`);
  await view("home");
  await click("[data-a='w-net'][data-arg='devnet']");
  await page.waitForSelector(".tok", { timeout: 60_000 });
  await click(".bigbtns [data-a='w-send']");
  await view("wsend");
  await page.waitForSelector("form[data-a='ws-form']");
  await click("[data-a='ws-max']");
  await page.fill("input[name='dest']", funder.publicKey.toBase58());
  await click("form[data-a='ws-form'] button[type='submit']");
  await page.waitForSelector("[data-a='ws-go']", { timeout: 60_000 });
  await shot("send-max-review", { full: true });
  await click("[data-a='ws-go']");
  await page.waitForSelector(".alert.okc", { timeout: 90_000 });
  report.txs.returnMax = await sigFromLink(".alert.okc [data-a='open']");
  const left = await conn.getBalance(new PublicKey(w1.address));
  log("returned the wallet's SOL with Max:", report.txs.returnMax, "wallet left", left, "lamports");
  // ---------- read-only mainnet holdings of a big public wallet ----------
  await click("[data-a='home']");
  await view("home");
  await click("[data-a='wallets']");
  await view("wallets");
  await click("[data-a='wwatch-open']");
  await view("wwatch");
  await page.fill("input[name='address']", PUBLIC_MAINNET);
  await page.fill("input[name='name']", "Public wallet");
  await click("form[data-a='wwatch-submit'] button[type='submit']");
  await view("home");
  await click("[data-a='w-net'][data-arg='mainnet-beta']");
  await page.waitForFunction(() => /\$/.test(document.querySelector(".wtotal .num")?.textContent ?? ""), null, { timeout: 180_000 });
  await page.waitForTimeout(4000);
  const total = await page.$eval(".wtotal .num", (n) => n.textContent);
  log("mainnet read-only holdings of", PUBLIC_MAINNET, "total", total);
  await shot("mainnet-public-wallet-holdings");
  await shot("mainnet-public-wallet-full", { full: true });

} catch (e) {
  await shot("FAIL").catch(() => {});
  console.log("FAIL view:", await page.evaluate(() => document.body.dataset.view + " | " + document.getElementById("view").innerText.slice(0, 600)).catch(() => ""));
  throw e;
} finally {
  if (walletKp) {
    const bal = await conn.getBalance(walletKp.publicKey).catch(() => 0);
    if (bal > 5000) {
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: walletKp.publicKey, toPubkey: funder.publicKey, lamports: bal - 5000 }));
      report.txs.sweep = await sendAndConfirmTransaction(conn, tx, [walletKp], { commitment: "confirmed" }).catch((e) => String(e));
      log("swept wallet leftovers", (bal - 5000) / LAMPORTS_PER_SOL, report.txs.sweep);
    }
  }
  const endBal = await conn.getBalance(funder.publicKey);
  report.spentSol = (startBal - endBal) / LAMPORTS_PER_SOL;
  if (report.vault) report.vaultLeft = (await conn.getBalance(new PublicKey(report.vault))) / LAMPORTS_PER_SOL;
  log("funder spent", report.spentSol, "SOL net; vault holds", report.vaultLeft ?? 0, "SOL (its rent)");
  writeFileSync(join(docs, "e2e-report.json"), JSON.stringify(report, null, 2) + "\n");
  await ctx.close();
}

function bs58decode(s) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(A.indexOf(c));
  const out = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return out;
}
