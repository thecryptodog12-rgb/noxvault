// Shared esbuild resolver for the build, the Node runner and the smoke test:
// - "@nox/sdk/<file>" (the site's tsconfig alias) → ../sdk/<file>
// - bare imports made by files outside extension/ (../sdk, ../web) resolve from extension/node_modules,
//   so every bundle carries exactly one, pinned copy of each dependency.
import { join, sep } from "node:path";

export function ownDeps(root) {
  const sdk = join(root, "..", "sdk");
  return {
    name: "own-deps",
    setup(b) {
      b.onResolve({ filter: /^@nox\/sdk\// }, (args) => {
        const sub = args.path.slice("@nox/sdk/".length);
        return { path: join(sdk, sub.endsWith(".ts") ? sub : `${sub}.ts`) };
      });
      b.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (!args.importer || args.importer.startsWith(root + sep) || args.pluginData === "own-deps") return undefined;
        const r = await b.resolve(args.path, { kind: args.kind, resolveDir: root, pluginData: "own-deps" });
        return r.errors.length ? { errors: r.errors } : { path: r.path, sideEffects: r.sideEffects };
      });
    },
  };
}
