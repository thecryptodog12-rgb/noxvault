// Tests resolve imports exactly like the build (scripts/resolve.mjs): the site's "@nox/sdk/*" alias
// maps to ../sdk, and bare imports made by ../sdk and ../web files resolve from extension/node_modules
// (never from some node_modules higher up the tree).
import { defineConfig, type Plugin } from "vitest/config";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const sdk = resolve(root, "..", "sdk");

function ownDeps(): Plugin {
  return {
    name: "own-deps",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (source.startsWith("@nox/sdk/")) return join(sdk, `${source.slice("@nox/sdk/".length)}.ts`);
      if (!importer || /^[./]/.test(source) || source.startsWith("\0") || source.startsWith("/@")) return null;
      if (importer.startsWith(root + sep) && !importer.includes(`${sep}node_modules${sep}`)) return null;
      if (importer.includes(`${sep}node_modules${sep}`)) return null;
      return this.resolve(source, join(root, "src", "popup.ts"), { ...opts, skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [ownDeps()],
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
