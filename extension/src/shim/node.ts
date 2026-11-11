// Injected into every bundle (scripts/build.mjs): web3.js and Anchor expect Node's Buffer and a
// `process` object. The extension pages and the service worker have neither.
import { Buffer } from "buffer";

const proc = { env: {} as Record<string, string | undefined>, browser: true, version: "", versions: {} as Record<string, string>, nextTick: (fn: () => void) => queueMicrotask(fn) };

export { Buffer, proc as process };
