import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdk = path.resolve(here, "../sdk");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // a second dev server (e.g. against a local validator) can use its own build dir
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: { externalDir: true },
  outputFileTracingRoot: path.resolve(here, ".."),
  // fonts and art read at request time by the dynamic Open Graph images
  outputFileTracingIncludes: { "/t/[vault]/opengraph-image": ["./assets/**/*"], "/exposure/[address]/opengraph-image": ["./assets/**/*"] },
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, "@nox/sdk": sdk };
    // The SDK lives outside web/; make its imports resolve to web/node_modules so the
    // app and the SDK share one copy of @solana/web3.js, anchor, etc.
    config.resolve.modules = [path.resolve(here, "node_modules"), "node_modules"];
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false, crypto: false };
    // WalletConnect's logger optionally requires these; they are not needed in the browser.
    config.externals = [...(config.externals ?? []), "pino-pretty", "lokijs", "encoding"];
    return config;
  },
};

export default nextConfig;
