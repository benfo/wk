import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, defaultConfigText, readConfig, STORES, type StoreChoice } from "../config.js";
import { findRoot, homeRoot, projectBase, WORK_DIR } from "../context.js";
import { excludeFile } from "../git.js";
import { result, WkError, type Result } from "../output.js";
import { ARCHIVE_DIR, KINDS } from "../store.js";
import { findSources, sourcesLine, type Sources } from "./sources.js";
import { HANDOFF_FILE } from "./view.js";

/** Works from both src/commands (tests) and dist/commands (installed package). */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKILL_SOURCE = path.join(PACKAGE_ROOT, "skill");
export const STARTER_PRINCIPLES = ["arch", "ui"];
export const SKILL_DIR = path.join(".claude", "skills", "wk");
export const AGENT_POINTER =
  "Track work with the `wk` CLI. At the start of every session run `wk guide` once (skip it if the wk skill is loaded), then `wk brief`.";
/** The pointer line older versions wrote; the next `wk init` replaces it. */
const OLD_POINTER = /^Track work with the `wk` CLI: follow \.claude\/skills\/wk\/SKILL\.md.*$/m;

const STORE_HELP = [
  "Choose where to keep the plan:",
  "  wk init --store repo     .work/ in the repo, committed",
  "  wk init --store ignore   .work/ in the repo, listed in .gitignore",
  "  wk init --store local    .work/ in the repo, listed in .git/info/exclude (only you)",
  "  wk init --store home     outside the repo, in ~/.wk/projects/<slug>/",
];

/** Personal stores leave no trace in tracked files: no pointers, and ignores go in .git/info/exclude. */
function isPersonal(store: StoreChoice): boolean {
  return store === "local" || store === "home";
}

function installSkill(base: string): string {
  const dest = path.join(base, SKILL_DIR);
  if (!fs.existsSync(path.join(SKILL_SOURCE, "SKILL.md"))) throw new WkError(`Skill missing from package: ${SKILL_SOURCE}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(SKILL_SOURCE, dest, { recursive: true });
  return dest;
}

/**
 * True when the file already tells agents to run `wk guide` and `wk brief`: the pointer itself,
 * or the user's own wording of it, wrapped or reworded.
 */
function hasPointer(text: string): boolean {
  return text.includes("`wk guide`") && text.includes("`wk brief`");
}

/**
 * Adds the pointer to an agent instructions file once, upgrading an old pointer line.
 * Returns true if the file changed. With `onlyIfExists`, a missing file is left alone.
 */
function addPointer(base: string, name: string, onlyIfExists = false): boolean {
  const file = path.join(base, name);
  const exists = fs.existsSync(file);
  if (!exists && onlyIfExists) return false;
  const existing = exists ? fs.readFileSync(file, "utf8") : "";
  if (hasPointer(existing)) return false;
  if (OLD_POINTER.test(existing)) {
    fs.writeFileSync(file, existing.replace(OLD_POINTER, AGENT_POINTER));
    return true;
  }
  const sep = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, existing + sep + AGENT_POINTER + "\n");
  return true;
}

/** Appends ignore patterns that are not there yet. Returns the ones added. */
function addIgnores(file: string, patterns: string[]): string[] {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = patterns.filter((p) => !have.has(p) && !have.has(p.replace(/\/$/, "")));
  if (missing.length === 0) return [];
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, existing + sep + ["# wk", ...missing].join("\n") + "\n");
  return missing;
}

function createLayout(root: string, store: StoreChoice): void {
  for (const { dir } of Object.values(KINDS)) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.mkdirSync(path.join(root, ARCHIVE_DIR), { recursive: true });
  fs.mkdirSync(path.join(root, "principles"), { recursive: true });
  for (const tag of STARTER_PRINCIPLES) {
    const file = path.join(root, "principles", `${tag}.md`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${tag}\n\n`);
  }
  if (store === "repo") {
    // Git does not track empty folders; keep the layout in the repo.
    for (const dir of [...Object.values(KINDS).map((k) => k.dir), ARCHIVE_DIR]) {
      fs.writeFileSync(path.join(root, dir, ".gitkeep"), "");
    }
  }
  fs.writeFileSync(path.join(root, CONFIG_FILE), defaultConfigText(store));
  fs.writeFileSync(path.join(root, HANDOFF_FILE), "");
}

export function init(cwd: string, opts: { store?: string; home?: string }): Result {
  const existing = findRoot(cwd, opts.home);
  const lines: string[] = [];
  let base: string;
  let root: string;
  let store: StoreChoice;
  let sources: Sources | null = null;

  if (existing) {
    ({ base, root } = existing);
    store = readConfig(root).store;
    lines.push(`Already set up (store: ${store}): ${root}`);
    if (opts.store && opts.store !== store) {
      lines.push(`Not moving it to "${opts.store}". Moving a plan is not supported yet.`);
    }
  } else {
    if (!opts.store) throw new WkError(STORE_HELP.join("\n"));
    if (!STORES.includes(opts.store as StoreChoice)) {
      throw new WkError([`Unknown store "${opts.store}".`, ...STORE_HELP].join("\n"));
    }
    store = opts.store as StoreChoice;
    const project = projectBase(cwd);
    base = project.base;
    if ((store === "ignore" || store === "local") && !project.git) {
      throw new WkError(`--store ${store} needs a git repo. Use --store repo or --store home here.`);
    }
    root = store === "home" ? homeRoot(base, opts.home) : path.join(base, WORK_DIR);
    createLayout(root, store);
    lines.push(`Created ${root}`);
    sources = findSources(base, project.git);
  }

  const skill = installSkill(base);
  lines.push(`Skill: ${path.relative(base, skill)}`);

  // Keep wk's files out of git for every store but repo. The skill copy follows the plan.
  const skillPattern = SKILL_DIR.split(path.sep).join("/") + "/";
  const patterns = store === "home" ? [skillPattern] : store === "repo" ? [] : [`${WORK_DIR}/`, skillPattern];
  const ignoreFile = store === "ignore" ? path.join(base, ".gitignore") : patterns.length ? excludeFile(base) : null;
  if (ignoreFile && patterns.length) {
    const added = addIgnores(ignoreFile, patterns);
    if (added.length) lines.push(`Ignored in ${path.relative(base, ignoreFile).split(path.sep).join("/")}: ${added.join(" ")}`);
  }

  if (isPersonal(store)) {
    // Tracked files stay untouched. Claude finds the skill on its own; other agents need telling.
    lines.push("No AGENTS.md change (personal store). For other agents, add to your own instructions:");
    lines.push(`  ${AGENT_POINTER}`);
  } else {
    // AGENTS.md reaches most agents. Claude Code reads CLAUDE.md, so add the line there too when
    // the project has one; without one, Claude still finds the skill in .claude/skills/.
    const pointed = ["AGENTS.md", "CLAUDE.md"].filter((name) => addPointer(base, name, name === "CLAUDE.md"));
    if (pointed.length) lines.push(`Added the wk pointer to ${pointed.join(" and ")}`);
  }
  const found = sources ? sourcesLine(sources) : null;
  if (found) lines.push(found);
  lines.push("Next: wk brief");
  return result(lines, { root, skill, store, sources });
}
