import { defineConfig } from "tsup";

// ESM + CJS + .d.ts from sdk/index.ts. dependencies and peerDependencies stay external; the IDL
// JSON is inlined so consumers need nothing from the repo.
export default defineConfig({
  entry: { index: "index.ts" },
  format: ["esm", "cjs"],
  dts: { compilerOptions: { composite: false } },
  tsconfig: "tsconfig.build.json",
  target: "es2020",
  platform: "neutral",
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
});
