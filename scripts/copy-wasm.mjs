#!/usr/bin/env node
// After `wasm-pack build --out-dir packages/ghostpacket-sdk/wasm` (npm run wasm):
// - removes the `*` .gitignore that wasm-pack writes, so the generated glue is
//   versioned and the apps build without a Rust toolchain;
// - refreshes public/wasm in every app (scripts/sync-app-assets.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const outDir = join(root, "packages", "ghostpacket-sdk", "wasm");
const wasm = join(outDir, "ghostpacket_core_bg.wasm");

if (!existsSync(wasm)) {
  console.error(`copy-wasm: ${wasm} not found. Run wasm-pack first.`);
  process.exit(1);
}
rmSync(join(outDir, ".gitignore"), { force: true });

const apps = join(root, "apps");
for (const name of existsSync(apps) ? readdirSync(apps) : []) {
  if (!existsSync(join(apps, name, "public"))) continue;
  spawnSync(process.execPath, [join(root, "scripts", "sync-app-assets.mjs"), join(apps, name)], { stdio: "inherit" });
}

const raw = readFileSync(wasm);
console.log(`copy-wasm: ${(raw.length / 1024).toFixed(1)} KB raw, ${(gzipSync(raw).length / 1024).toFixed(1)} KB gzip (packages/ghostpacket-sdk/wasm)`);
