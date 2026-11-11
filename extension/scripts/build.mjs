// Builds the extension into dist/: bundles the service worker and the popup with esbuild and copies
// public/ (manifest, popup.html, css, fonts, icons). `node scripts/build.mjs --watch` rebuilds on change.
//
// The bundles import the SDK straight from ../sdk and the pure alert logic from ../web/lib/alerts.
// Bare imports from those files are resolved against extension/node_modules, so the extension
// always ships one copy of web3.js / Anchor, its own pinned versions.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Resolve bare imports made by files outside extension/ (../sdk, ../web) from extension/node_modules. */
const ownDeps = {
  name: "own-deps",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (!args.importer || args.importer.startsWith(root + sep) || args.pluginData === "own-deps") return undefined;
      const r = await b.resolve(args.path, { kind: args.kind, resolveDir: root, pluginData: "own-deps" });
      return r.errors.length ? { errors: r.errors } : { path: r.path, sideEffects: r.sideEffects };
    });
  },
};

function copyStatic() {
  cpSync(join(root, "public"), dist, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, "public", "manifest.json"), "utf8"));
  manifest.version = pkg.version;
  writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

const options = {
  entryPoints: { background: join(root, "src/background.ts"), popup: join(root, "src/popup.ts") },
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
  plugins: [ownDeps],
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
