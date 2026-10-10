// Bundles src/keeper.ts with the shared keeper logic (../web/lib/keeper.ts, ../sdk) into
// dist/keeper.cjs. npm packages stay external and load from bot/node_modules at runtime, so the
// SDK and the keeper share one copy of @solana/web3.js and anchor.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdk = path.resolve(bot, "../sdk");

await build({
  entryPoints: [path.join(bot, "src/keeper.ts")],
  outfile: path.join(bot, "dist/keeper.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  packages: "external",
  logLevel: "warning",
  plugins: [
    {
      name: "nox-sdk",
      setup(b) {
        b.onResolve({ filter: /^@nox\/sdk\// }, (args) => ({ path: path.join(sdk, args.path.slice("@nox/sdk/".length) + ".ts") }));
        // Every npm import stays external, also where web/tsconfig.json maps it to web/node_modules.
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith("@nox/") ? undefined : { path: args.path, external: true }));
      },
    },
  ],
});
console.log("built dist/keeper.cjs");
