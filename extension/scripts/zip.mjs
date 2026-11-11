// Zips dist/ into noxvault-extension-<version>.zip for the Chrome Web Store upload.
import { zipSync } from "fflate";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "manifest.json"))) throw new Error("dist/ is empty: run `pnpm run build` first");

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(dist, p).split("\\").join("/")] = [readFileSync(p), { level: 9 }];
  }
};
walk(dist);

const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const out = join(root, `noxvault-extension-${version}.zip`);
writeFileSync(out, zipSync(files, { mtime: new Date("2026-01-01T00:00:00Z") }));
console.log(`${relative(root, out)}: ${Object.keys(files).length} files, ${(statSync(out).size / 1024).toFixed(0)} KB`);
