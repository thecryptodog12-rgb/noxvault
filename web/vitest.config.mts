import path from "node:path";
import { defineConfig } from "vitest/config";

// Same alias as next.config.mjs, so tests can import the SDK the way the app does.
export default defineConfig({
  resolve: { alias: { "@nox/sdk": path.resolve(__dirname, "../sdk"), "@": path.resolve(__dirname) } },
  server: { fs: { allow: [".."] } },
});
