// Runs a TypeScript file under Node by bundling it with esbuild first (same resolution rules as the
// extension build: "@nox/sdk/*" → ../sdk, bare imports from ../sdk and ../web → extension/node_modules).
//   node scripts/run-ts.mjs path/to/file.ts [args…]
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ownDeps } from "./resolve.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [file, ...rest] = process.argv.slice(2);
if (!file) throw new Error("usage: node scripts/run-ts.mjs <file.ts> [args…]");

const res = await build({
  entryPoints: [resolve(file)],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false,
  plugins: [ownDeps(root)],
  logLevel: "error",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __filename.replace(/[\\\\/][^\\\\/]*$/, '');",
  },
});
const out = join(mkdtempSync(join(tmpdir(), "nox-run-")), "run.mjs");
writeFileSync(out, res.outputFiles[0].text);
process.argv = [process.argv[0], out, ...rest];
await import(pathToFileURL(out).href);
