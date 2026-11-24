#!/usr/bin/env node
// Static guard for .kiro/steering/wasm-determinism.md:
// no unwrap()/expect()/panic!()/todo!()/unimplemented!()/unreachable!() in
// crates/ghostpacket-core/src outside #[cfg(test)] modules.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const srcDir = join(root, "crates", "ghostpacket-core", "src");

const FORBIDDEN = [
  { re: /\.unwrap\(\)/, label: ".unwrap()" },
  { re: /\.expect\(/, label: ".expect(" },
  { re: /\bpanic!\s*\(/, label: "panic!(" },
  { re: /\btodo!\s*\(/, label: "todo!(" },
  { re: /\bunimplemented!\s*\(/, label: "unimplemented!(" },
  { re: /\bunreachable!\s*\(/, label: "unreachable!(" },
];

function rustFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...rustFiles(p));
    else if (name.endsWith(".rs")) out.push(p);
  }
  return out;
}

/** Lines of production code: stops at the first #[cfg(test)] (tests live at the end). */
function productionLines(text) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => l.trim().startsWith("#[cfg(test)]"));
  return cut === -1 ? lines : lines.slice(0, cut);
}

export function scan() {
  const violations = [];
  for (const file of rustFiles(srcDir)) {
    const lines = productionLines(readFileSync(file, "utf8"));
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      for (const { re, label } of FORBIDDEN) {
        if (re.test(code)) {
          violations.push({ file: relative(root, file).replaceAll("\\", "/"), line: i + 1, label, text: line.trim() });
        }
      }
    });
  }
  return violations;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const violations = scan();
  if (violations.length === 0) {
    console.log("wasm-no-panic-guard: OK (0 forbidden call in crates/ghostpacket-core/src)");
    process.exit(0);
  }
  console.error(`wasm-no-panic-guard: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.label}  ->  ${v.text}`);
  console.error("Replace them with Result<_, GhostError> (see .kiro/steering/wasm-determinism.md).");
  process.exit(1);
}
