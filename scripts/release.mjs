#!/usr/bin/env node
// Publishes the current version as a GitHub release with the packed tarball attached.
// Bump first with `npm version <patch|minor|major>`, then run `npm run release`.
// `npm run release -- --dry-run` runs the checks and packs, but tags, pushes and publishes nothing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const shell = process.platform === "win32";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", shell, ...opts }).trim();
}
function step(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", shell });
}
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const { name, version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tag = `v${version}`;

if (run("git", ["status", "--porcelain"])) fail("Working tree has uncommitted changes. Commit or stash them first.");
if (!dryRun && !run("git", ["remote"])) fail("No git remote. Create the GitHub repo and add it as origin first.");
if (!dryRun) {
  try {
    run("gh", ["release", "view", tag], { stdio: "pipe" });
    fail(`Release ${tag} already exists. Bump the version first: npm version patch`);
  } catch (e) {
    if (e.status === undefined) throw e;
  }
}
const tagged = run("git", ["tag", "--points-at", "HEAD"]).split(/\r?\n/).includes(tag);
if (!tagged && run("git", ["tag", "--list", tag])) fail(`Tag ${tag} exists but not on this commit. Bump the version first.`);

step("npm", ["test"]);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-release-"));
step("npm", ["pack", "--pack-destination", outDir]);
const tarball = path.join(outDir, `${name}-${version}.tgz`);
if (!fs.existsSync(tarball)) fail(`Expected ${tarball} after npm pack.`);

if (dryRun) {
  console.log(`Dry run: packed ${tarball}. Nothing tagged, pushed or released.`);
  process.exit(0);
}

if (!tagged) step("git", ["tag", tag]);
step("git", ["push", "origin", "HEAD"]);
step("git", ["push", "origin", tag]);

const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
const url = `https://github.com/${repo}/releases/download/${tag}/${name}-${version}.tgz`;
const notes = `Install or upgrade:\n\n\`\`\`bash\nnpm i -g ${url}\n\`\`\`\n\nThen run \`wk init\` in each project to refresh its skill.`;
const notesFile = path.join(outDir, "notes.md");
fs.writeFileSync(notesFile, notes);
step("gh", ["release", "create", tag, tarball, "--title", tag, "--notes-file", notesFile]);
console.log(`Released ${tag}: ${url}`);
