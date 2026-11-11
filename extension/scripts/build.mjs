// Builds the extension into dist/: bundles the service worker, the app page (popup + full tab) and
// the tree worker with esbuild and copies public/ (manifest, popup.html, css, fonts, icons).
// `node scripts/build.mjs --watch` rebuilds on change.
//
// The bundles import the SDK straight from ../sdk and pure modules from ../web/lib (the site's own
// code: alerts, presets, config JSON, action JSON, the tree worker). Bare imports from those files
// are resolved against extension/node_modules, so the extension ships one copy of web3.js / Anchor,
// its own pinned versions. The site's "@nox/sdk/<file>" alias is mapped to ../sdk/<file>.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownDeps } from "./resolve.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function copyStatic() {
  cpSync(join(root, "public"), dist, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, "public", "manifest.json"), "utf8"));
  manifest.version = pkg.version;
  writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

const options = {
  entryPoints: {
    background: join(root, "src/background.ts"),
    popup: join(root, "src/popup.ts"),
    // The site's own worker, unchanged (web/lib/tree.worker.ts): builds a PUBLIC tree from a master.
    "tree-worker": join(root, "../web/lib/tree.worker.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome114",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  inject: [join(root, "src/shim/node.ts")],
  define: { global: "globalThis", "process.env.NODE_ENV": '"production"' },
  plugins: [ownDeps(root)],
  logLevel: "info",
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching… (static files are copied once; re-run for manifest/css changes)");
} else {
  await build(options);
  console.log(`built ${pkg.name} ${pkg.version} → dist/`);
}
