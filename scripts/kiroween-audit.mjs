#!/usr/bin/env node
// Pre-submission audit. Fast checks by default; `--full` also runs the Rust
// suite and the TypeScript typecheck; `--json` prints a machine report (used
// by the MCP tool check_kiroween_compliance).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { scan as scanPanics } from "./no-panic-guard.mjs";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const args = new Set(process.argv.slice(2));
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail: detail ?? "" });
  } catch (err) {
    checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

function git(...a) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function walk(dir, filter) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "out" || name === "target") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(name)) out.push(p);
  }
  return out;
}

check(".kiro/ is tracked by git (not ignored)", () => {
  const probe = ".kiro/steering/product.md";
  const r = spawnSync("git", ["check-ignore", "-q", probe], { cwd: root });
  if (r.status === 0) throw new Error(`${probe} is ignored by .gitignore`);
  return "not ignored";
});

check(".kiro/ contains steering, specs, hooks and MCP settings", () => {
  const required = [
    ".kiro/steering/product.md",
    ".kiro/steering/tech.md",
    ".kiro/steering/structure.md",
    ".kiro/steering/wasm-determinism.md",
    ".kiro/settings/mcp.json",
    ".kiro/hooks/fuzz-noise-channel.json",
    ".kiro/hooks/wasm-no-panic-guard.json",
    ".kiro/hooks/ts-typecheck-on-save.json",
    ".kiro/hooks/kiroween-audit.json",
  ];
  for (const spec of ["core-system", "binary-protocol", "acoustic-fsk", "optical-fountain", "judge-demo-ui"]) {
    for (const f of ["requirements.md", "design.md", "tasks.md"]) required.push(`.kiro/specs/${spec}/${f}`);
  }
  const missing = required.filter((f) => !existsSync(join(root, f)));
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
  for (const f of required.filter((f) => f.endsWith(".json"))) JSON.parse(readFileSync(join(root, f), "utf8"));
  return `${required.length} files present, JSON valid`;
});

check("No external AI tool files are tracked", () => {
  let tracked = "";
  try {
    tracked = git("ls-files");
  } catch {
    return "git index empty";
  }
  const bad = tracked
    .split("\n")
    .filter((f) => /^(\.cursor|\.claude|\.vscode|\.idea|\.windsurf|\.github\/copilot|\.continue|\.cline|\.roo|\.aider)/.test(f) || /^(AGENTS?|CLAUDE|GEMINI|COPILOT|CURSOR)\.md$/.test(f));
  if (bad.length) throw new Error(`tracked: ${bad.join(", ")}`);
  return "none";
});

check("MIT LICENSE present", () => {
  const p = join(root, "LICENSE");
  if (!existsSync(p)) throw new Error("LICENSE missing");
  if (!/MIT License/.test(readFileSync(p, "utf8"))) throw new Error("LICENSE is not MIT");
  return "MIT";
});

check("No secret or API key in client code", () => {
  const patterns = [
    /AKIA[0-9A-Z]{16}/,
    /\bsk-[A-Za-z0-9]{20,}/,
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i,
    /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/,
  ];
  const files = [
    ...walk(join(root, "web", "src"), (n) => /\.(ts|tsx|js|mjs|json|css)$/.test(n) && !n.endsWith("_bg.wasm")),
    ...walk(join(root, "mcp-server", "src"), (n) => /\.(ts|js)$/.test(n)),
  ];
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const re of patterns) if (re.test(text)) hits.push(`${relative(root, f)} (${re.source.slice(0, 24)}…)`);
  }
  if (hits.length) throw new Error(hits.join("; "));
  const envFiles = walk(root, (n) => /^\.env/.test(n));
  for (const e of envFiles) {
    const r = spawnSync("git", ["check-ignore", "-q", relative(root, e)], { cwd: root });
    if (r.status !== 0) throw new Error(`${relative(root, e)} is not git-ignored`);
  }
  return `${files.length} files scanned`;
});

check("Zero panic in crates/ghostpacket-core/src", () => {
  const v = scanPanics();
  if (v.length) throw new Error(v.map((x) => `${x.file}:${x.line} ${x.label}`).join("; "));
  return "0 forbidden call";
});

check("WASM bundle size < 350 KB gzip", () => {
  const wasm = join(root, "web", "public", "wasm", "ghostpacket_core_bg.wasm");
  if (!existsSync(wasm)) throw new Error("web/public/wasm/ghostpacket_core_bg.wasm not built (npm --prefix web run wasm)");
  const raw = readFileSync(wasm);
  const gz = gzipSync(raw).length;
  if (gz > 350 * 1024) throw new Error(`${(gz / 1024).toFixed(1)} KB gzip`);
  return `${(raw.length / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`;
});

if (args.has("--full")) {
  check("Rust test suite (protocol + FSK fuzz + fountain fuzz)", () => {
    const r = spawnSync("cargo", ["test", "--release", "--manifest-path", "crates/ghostpacket-core/Cargo.toml"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const passed = [...(r.stdout ?? "").matchAll(/test result: ok\. (\d+) passed/g)].reduce((a, m) => a + Number(m[1]), 0);
    if (r.status !== 0) throw new Error(`cargo test failed\n${(r.stdout ?? "").slice(-1500)}${(r.stderr ?? "").slice(-800)}`);
    return `${passed} tests passed`;
  });
  check("TypeScript typecheck (web)", () => {
    if (!existsSync(join(root, "web", "node_modules"))) throw new Error("web/node_modules missing (npm --prefix web install)");
    const r = spawnSync("npm", ["--prefix", "web", "run", "typecheck"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
    if (r.status !== 0) throw new Error((r.stdout ?? "").slice(-1500));
    return "tsc --noEmit OK";
  });
}

const ok = checks.every((c) => c.ok);
if (args.has("--json")) {
  console.log(JSON.stringify({ ok, checks }, null, 2));
} else {
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  —  ${c.detail}` : ""}`);
  console.log(ok ? "\nKiroween audit: all checks passed." : "\nKiroween audit: FAILED.");
}
process.exit(ok ? 0 : 1);
