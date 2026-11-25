#!/usr/bin/env node
// Builds every app of the skeleton as a static export and merges them into one
// GitHub Pages tree:
//   <base>/          apps/portal
//   <base>/clinic/   apps/ghost-clinic
//   <base>/tontine/  apps/ghost-tontine
//   node scripts/build-pages.mjs [--base /GhostPacket] [--out pages-out]
// The base path defaults to $NEXT_PUBLIC_BASE_PATH (or empty).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
const base = arg("--base", process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const out = resolve(root, arg("--out", "pages-out"));
// The output folder is deleted first: it must be a sub-folder of the repository.
if (!out.startsWith(root + sep) || out === root) {
  console.error(`build-pages: refusing --out ${out} (must be inside ${root})`);
  process.exit(1);
}

export const APPS = [
  { dir: "apps/portal", mount: "" },
  { dir: "apps/ghost-clinic", mount: "/clinic" },
  { dir: "apps/ghost-tontine", mount: "/tontine" },
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const app of APPS) {
  const basePath = `${base}${app.mount}`;
  console.log(`build-pages: ${app.dir} with base path "${basePath || "/"}"`);
  const r = spawnSync("npm", ["run", "build", "-w", app.dir], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: basePath, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (r.status !== 0) {
    console.error(`build-pages: ${app.dir} failed`);
    process.exit(1);
  }
  const appOut = join(root, app.dir, "out");
  if (!existsSync(join(appOut, "index.html"))) {
    console.error(`build-pages: ${appOut}/index.html missing`);
    process.exit(1);
  }
  cpSync(appOut, join(out, app.mount), { recursive: true });
}
// Without this file, Pages runs Jekyll, which drops the `_next/` folder.
writeFileSync(join(out, ".nojekyll"), "");
console.log(`build-pages: ${APPS.length} apps merged into ${out}`);
