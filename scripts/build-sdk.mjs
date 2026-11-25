#!/usr/bin/env node
// Builds the standalone ESM package in sdk/dist from web/src/lib (same code as the site):
// 1. tsc (web/tsconfig.sdk.json) → sdk/dist/lib/*.js + .d.ts
// 2. adds ".js" to relative import specifiers (browsers and Node require them)
// 3. copies the WASM glue + binary and the capture AudioWorklet
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const web = join(root, "web");
const dist = join(root, "sdk", "dist");

rmSync(dist, { recursive: true, force: true });
const tsc = join(web, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tsc)) {
  console.error("build-sdk: run `npm --prefix web install` first (TypeScript is needed).");
  process.exit(1);
}
const r = spawnSync(process.execPath, [tsc, "-p", join(web, "tsconfig.sdk.json")], { cwd: web, encoding: "utf8" });
if (r.status !== 0) {
  console.error(`build-sdk: tsc failed\n${r.stdout}${r.stderr}`);
  process.exit(1);
}

const RELATIVE = /(\bfrom\s*["']|\bimport\s*\(\s*["']|\bimport\s+["'])(\.{1,2}\/[^"']+?)(["'])/g;
let rewritten = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".js") || name.endsWith(".d.ts")) {
      const src = readFileSync(p, "utf8");
      const out = src.replace(RELATIVE, (m, pre, spec, post) => {
        if (/\.(m?js|json|wasm)$/.test(spec)) return m;
        rewritten++;
        return `${pre}${spec}.js${post}`;
      });
      if (out !== src) writeFileSync(p, out);
    }
  }
}
walk(dist);

const wasmSrc = join(web, "src", "wasm");
mkdirSync(join(dist, "wasm"), { recursive: true });
for (const f of ["ghostpacket_core.js", "ghostpacket_core.d.ts", "ghostpacket_core_bg.wasm", "ghostpacket_core_bg.wasm.d.ts"]) {
  copyFileSync(join(wasmSrc, f), join(dist, "wasm", f));
}
mkdirSync(join(dist, "assets"), { recursive: true });
copyFileSync(join(web, "public", "worklets", "capture-processor.js"), join(dist, "assets", "capture-processor.js"));

const wasm = readFileSync(join(dist, "wasm", "ghostpacket_core_bg.wasm"));
const files = [];
(function list(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? list(p) : files.push(p);
  }
})(dist);
console.log(`build-sdk: ${files.length} files in sdk/dist, ${rewritten} import(s) rewritten, WASM ${(gzipSync(wasm).length / 1024).toFixed(1)} KB gzip`);
