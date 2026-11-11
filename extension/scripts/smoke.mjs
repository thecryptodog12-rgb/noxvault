// Reads real vaults through the extension's chain code (same bundle path as the service worker)
// and prints the snapshot + alerts. `node scripts/smoke.mjs [vault…]`; with no args it lists the
// first devnet vaults via getProgramAccounts. Read-only RPC.
import { build } from "esbuild";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownDeps = {
  name: "own-deps",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (!args.importer || args.importer.startsWith(root + sep) || args.pluginData === "own-deps") return undefined;
      const r = await b.resolve(args.path, { kind: args.kind, resolveDir: root, pluginData: "own-deps" });
      return r.errors.length ? { errors: r.errors } : { path: r.path };
    });
  },
};
const entry = `
import { readSnapshot } from ${JSON.stringify(join(root, "src/lib/chain.ts"))};
import { extAlerts } from ${JSON.stringify(join(root, "src/lib/alerts.ts"))};
import { ruleLines } from ${JSON.stringify(join(root, "src/lib/rules.ts"))};
import { headline } from ${JSON.stringify(join(root, "src/lib/status.ts"))};
export { readSnapshot, extAlerts, ruleLines, headline };`;
const res = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", write: false, plugins: [ownDeps], logLevel: "error",
});
const dir = mkdtempSync(join(tmpdir(), "nox-smoke-"));
const file = join(dir, "smoke.cjs");
writeFileSync(file, res.outputFiles[0].text);
const m = createRequire(import.meta.url)(file);

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
let vaults = process.argv.slice(2);
if (!vaults.length) {
  const B = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const enc = (b) => { let n = BigInt("0x" + Buffer.from(b).toString("hex")), s = ""; while (n > 0n) { s = B[Number(n % 58n)] + s; n /= 58n; } for (const x of b) { if (x) break; s = "1" + s; } return s; };
  const disc = enc([228, 196, 82, 165, 98, 210, 235, 152]); // VaultState account discriminator
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: ["8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4", { encoding: "base64", dataSlice: { offset: 8, length: 32 }, filters: [{ memcmp: { offset: 0, bytes: disc } }] }] }),
  }).then((x) => x.json());
  vaults = (r.result ?? []).map((a) => enc(Buffer.from(a.account.data[0], "base64")));
  console.log(`${vaults.length} VaultState accounts on devnet`);
}
const now = Math.floor(Date.now() / 1000);
for (const v of vaults) {
  try {
    const s = await m.readSnapshot(v, "devnet", RPC);
    if (!s) { console.log(v, "→ not a vault"); continue; }
    const h = m.headline(s, now);
    console.log(`${v} → ${(s.lamports / 1e9).toFixed(4)} SOL, ${h.label}: ${h.detail}; tokens ${s.tokens.length}; pending ${s.pending ? "yes" : "no"}; lockdown ${s.lockdownUntil > now}`);
    if (process.env.VERBOSE) {
      for (const r of m.ruleLines(s.rules)) console.log(`   ${r.label}: ${r.value}`);
      for (const a of m.extAlerts(null, s, now)) console.log(`   ALERT ${a.kind}: ${a.message}`);
    }
  } catch (e) {
    console.log(v, "→ error:", e.message);
  }
}
