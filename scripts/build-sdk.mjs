#!/usr/bin/env node
// Builds the publishable ESM package in packages/ghostpacket-sdk/dist from the
// same TypeScript sources the apps compile:
// 1. tsc (packages/ghostpacket-sdk/tsconfig.build.json) → dist/lib/*.js + .d.ts
// 2. adds ".js" to relative import specifiers (browsers and Node require them)
// 3. copies the WASM glue + binary and the capture AudioWorklet
// 4. writes dist/package.json (exports point at dist files), README and LICENSE
// Publish or pack from dist:  npm pack ./packages/ghostpacket-sdk/dist
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const pkg = join(root, "packages", "ghostpacket-sdk");
const dist = join(pkg, "dist");

rmSync(dist, { recursive: true, force: true });
let tsc;
try {
  tsc = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
} catch {
  console.error("build-sdk: run `npm install` at the repo root first (TypeScript is needed).");
  process.exit(1);
}
const r = spawnSync(process.execPath, [tsc, "-p", join(pkg, "tsconfig.build.json")], { cwd: pkg, encoding: "utf8" });
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

mkdirSync(join(dist, "wasm"), { recursive: true });
for (const f of ["ghostpacket_core.js", "ghostpacket_core.d.ts", "ghostpacket_core_bg.wasm", "ghostpacket_core_bg.wasm.d.ts"]) {
  copyFileSync(join(pkg, "wasm", f), join(dist, "wasm", f));
}
mkdirSync(join(dist, "assets"), { recursive: true });
copyFileSync(join(pkg, "assets", "capture-processor.js"), join(dist, "assets", "capture-processor.js"));

const src = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const published = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: src.license,
  type: "module",
  main: "./lib/index.js",
  types: "./lib/index.d.ts",
  exports: {
    ".": { types: "./lib/index.d.ts", import: "./lib/index.js" },
    "./wasm/ghostpacket_core_bg.wasm": "./wasm/ghostpacket_core_bg.wasm",
    "./assets/capture-processor.js": "./assets/capture-processor.js",
  },
  sideEffects: ["./lib/index.js"],
  engines: src.engines,
  dependencies: src.dependencies,
  repository: src.repository,
};
writeFileSync(join(dist, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
copyFileSync(join(pkg, "README.md"), join(dist, "README.md"));
copyFileSync(join(root, "LICENSE"), join(dist, "LICENSE"));

const wasm = readFileSync(join(dist, "wasm", "ghostpacket_core_bg.wasm"));
const files = [];
(function list(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? list(p) : files.push(p);
  }
})(dist);
console.log(`build-sdk: ${files.length} files in packages/ghostpacket-sdk/dist, ${rewritten} import(s) rewritten, WASM ${(gzipSync(wasm).length / 1024).toFixed(1)} KB gzip`);
