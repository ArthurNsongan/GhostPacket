#!/usr/bin/env node
// Copies the runtime assets of ghostpacket-sdk into an app's public/ folder,
// so a static export serves them from its own origin (no CDN, works offline):
//   public/wasm/ghostpacket_core_bg.wasm
//   public/worklets/capture-processor.js
// Run by each app's `predev` / `prebuild`:  node ../../scripts/sync-app-assets.mjs .
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const sdk = join(root, "packages", "ghostpacket-sdk");
const app = resolve(process.argv[2] ?? ".");

const files = [
  [join(sdk, "wasm", "ghostpacket_core_bg.wasm"), join(app, "public", "wasm", "ghostpacket_core_bg.wasm")],
  [join(sdk, "assets", "capture-processor.js"), join(app, "public", "worklets", "capture-processor.js")],
];
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.error(`sync-app-assets: ${from} missing (run npm run wasm at the repo root).`);
    process.exit(1);
  }
  mkdirSync(join(to, ".."), { recursive: true });
  copyFileSync(from, to);
}
console.log(`sync-app-assets: WASM + worklet -> ${join(app, "public")}`);
