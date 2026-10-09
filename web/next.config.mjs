import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdk = path.resolve(here, "../sdk");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  outputFileTracingRoot: path.resolve(here, ".."),
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, "@nox/sdk": sdk };
    // The SDK lives outside web/; make its imports resolve to web/node_modules so the
    // app and the SDK share one copy of @solana/web3.js, anchor, etc.
    config.resolve.modules = [path.resolve(here, "node_modules"), "node_modules"];
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false, crypto: false };
    return config;
  },
};

export default nextConfig;
