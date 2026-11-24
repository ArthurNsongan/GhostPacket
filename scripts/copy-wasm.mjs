#!/usr/bin/env node
// After `wasm-pack build --out-dir web/src/wasm`:
// - copies the .wasm binary to web/public/wasm/ so the static export serves it;
// - removes the `*` .gitignore that wasm-pack writes, so the generated glue is
//   versioned and the site deploys without a Rust toolchain.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const outDir = join(root, "web", "src", "wasm");
const wasm = join(outDir, "ghostpacket_core_bg.wasm");
const publicDir = join(root, "web", "public", "wasm");

if (!existsSync(wasm)) {
  console.error(`copy-wasm: ${wasm} not found. Run wasm-pack first.`);
  process.exit(1);
}
mkdirSync(publicDir, { recursive: true });
copyFileSync(wasm, join(publicDir, "ghostpacket_core_bg.wasm"));
rmSync(join(outDir, ".gitignore"), { force: true });

const raw = readFileSync(wasm);
console.log(`copy-wasm: ${(raw.length / 1024).toFixed(1)} KB raw, ${(gzipSync(raw).length / 1024).toFixed(1)} KB gzip -> web/public/wasm/`);
