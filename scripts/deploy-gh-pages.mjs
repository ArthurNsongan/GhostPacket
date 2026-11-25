#!/usr/bin/env node
// Builds the static export under /<repo> and publishes it to the `gh-pages`
// branch (GitHub Pages "Deploy from a branch" mode). Works without GitHub
// Actions minutes. Each deploy is a normal commit on top of the branch.
//
//   node scripts/deploy-gh-pages.mjs [--dry-run]
//
// One-time setup: Settings → Pages → Source: "Deploy from a branch", branch gh-pages, folder / (root).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const dryRun = process.argv.includes("--dry-run");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" && cmd === "npm", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`${cmd} ${args.join(" ")} failed\n${r.stdout ?? ""}${r.stderr ?? ""}`);
    process.exit(1);
  }
  return r;
}
const git = (args, cwd, allowFail = false) => run("git", args, { cwd, allowFail });

const origin = git(["remote", "get-url", "origin"], root).stdout.trim();
const repo = origin.replace(/\.git$/, "").split(/[/:]/).pop();
if (!repo) {
  console.error(`Cannot read the repository name from origin (${origin}).`);
  process.exit(1);
}
const userPage = /\.github\.io$/i.test(repo);
const basePath = userPage ? "" : `/${repo}`;
const sha = git(["rev-parse", "--short", "HEAD"], root).stdout.trim();
const dirty = git(["status", "--porcelain"], root).stdout.trim() !== "";

console.log(`Building web/out with base path "${basePath}" from ${sha}${dirty ? " (uncommitted changes!)" : ""}…`);
run("npm", ["--prefix", "web", "run", "build"], {
  cwd: root,
  env: { ...process.env, NEXT_PUBLIC_BASE_PATH: basePath, NEXT_TELEMETRY_DISABLED: "1" },
});
const out = join(root, "web", "out");
if (!existsSync(join(out, "index.html"))) {
  console.error("web/out/index.html missing after build.");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "gp-pages-"));
git(["init", "-q"], work);
git(["remote", "add", "origin", origin], work);
const fetched = git(["fetch", "-q", "--depth", "1", "origin", "gh-pages"], work, true).status === 0;
if (fetched) git(["checkout", "-q", "-b", "gh-pages", "FETCH_HEAD"], work);
else git(["checkout", "-q", "--orphan", "gh-pages"], work);

for (const name of readdirSync(work)) if (name !== ".git") rmSync(join(work, name), { recursive: true, force: true });
cpSync(out, work, { recursive: true });
// Without this file, Pages runs Jekyll, which drops the `_next/` folder.
writeFileSync(join(work, ".nojekyll"), "");

git(["add", "-A"], work);
if (git(["diff", "--cached", "--quiet"], work, true).status === 0) {
  console.log("No change since the last deploy.");
  process.exit(0);
}
git(["commit", "-q", "-m", `Deploy ${sha}${dirty ? " (dirty)" : ""}`], work);
if (dryRun) {
  console.log(`Dry run: commit ready in ${work}, not pushed.`);
  process.exit(0);
}
git(["push", "-q", "origin", "gh-pages"], work);
console.log(`Pushed to gh-pages. Site: https://${origin.split(/[/:]/).at(-2)?.toLowerCase()}.github.io${basePath}/`);
rmSync(work, { recursive: true, force: true });
