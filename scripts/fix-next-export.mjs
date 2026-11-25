#!/usr/bin/env node
// Next.js 16 static export writes segment prefetch data as
// `<route>/__next.<segment>/__PAGE__.txt`, but the client router requests
// `<route>/__next.<segment>.__PAGE__.txt`. Static hosts (GitHub Pages) then
// answer 404 on every prefetch. This copies each nested file to the flat name.
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ?? join(fileURLToPath(import.meta.url), "..", "..", "web", "out");
if (!existsSync(out)) {
  console.error(`fix-next-export: ${out} not found`);
  process.exit(1);
}

let copied = 0;
function flatten(dir, prefix, target) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const flat = `${prefix}.${name}`;
    if (statSync(p).isDirectory()) flatten(p, flat, target);
    else if (!existsSync(join(target, flat))) {
      copyFileSync(p, join(target, flat));
      copied++;
    }
  }
}
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) continue;
    if (name.startsWith("__next.")) flatten(p, name, dir);
    else if (name !== "_next") walk(p);
  }
}
walk(out);
console.log(`fix-next-export: ${copied} prefetch file(s) flattened`);
