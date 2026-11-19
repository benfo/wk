import fs from "node:fs";
import path from "node:path";
import { STORES, type StoreChoice } from "../../config.js";
import { findRoot, homeRoot, projectBase, WORK_DIR } from "../../context.js";
import { excludeFile } from "../../git.js";
import { addIgnores } from "../../commands/init.js";
import { result, WkError, type Result } from "../../output.js";
import { CONFIG_FILE, configText, readConfig, V1_PLAN } from "../context.js";
import { ARCHIVE_DIR, AREA_FILE, AREAS_DIR, CORE_AREA, INBOX_DIR, PROJECTS_DIR } from "../store.js";

export const SUMMARY_FILE = "summary.md";
export const SESSION_FILE = "session.md";
const CORE_DESCRIPTION = "Always in scope. Its principles load for every task; items with no better home live here.";

const STORE_HELP = [
  "Choose where to keep the plan:",
  "  wk init --store repo     .work/ in the repo, committed",
  "  wk init --store ignore   .work/ in the repo, listed in .gitignore",
  "  wk init --store local    .work/ in the repo, listed in .git/info/exclude (only you)",
  "  wk init --store home     outside the repo, in ~/.wk/projects/<slug>/",
];

export function writeIfMissing(file: string, text: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
}

export function areaText(name: string, description: string): string {
  return `# ${name}\n\n${description}\n`;
}

/** Creates whatever part of the layout is missing; never overwrites. */
export function ensureLayout(root: string, store: StoreChoice): void {
  for (const dir of [INBOX_DIR, PROJECTS_DIR, ARCHIVE_DIR, path.join(AREAS_DIR, CORE_AREA)]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  writeIfMissing(path.join(root, AREAS_DIR, CORE_AREA, AREA_FILE), areaText(CORE_AREA, CORE_DESCRIPTION));
  writeIfMissing(path.join(root, SUMMARY_FILE), "");
  writeIfMissing(path.join(root, SESSION_FILE), "");
  if (store === "repo") {
    // Git doesn't track empty folders.
    for (const dir of [INBOX_DIR, PROJECTS_DIR, ARCHIVE_DIR]) writeIfMissing(path.join(root, dir, ".gitkeep"), "");
  }
}

export function init(cwd: string, opts: { store?: string; home?: string }): Result {
  const existing = findRoot(cwd, opts.home);
  if (existing) {
    const config = readConfig(existing.root);
    if (config.version < 2) throw new WkError(V1_PLAN);
    ensureLayout(existing.root, config.store);
    const lines = [`Already set up (store: ${config.store}): ${existing.root}`];
    if (opts.store && opts.store !== config.store) lines.push(`Not moving it to "${opts.store}". Moving a plan is not supported.`);
    return result(lines, { root: existing.root, store: config.store });
  }
  if (!opts.store) throw new WkError(STORE_HELP.join("\n"));
  if (!STORES.includes(opts.store as StoreChoice)) throw new WkError([`Unknown store "${opts.store}".`, ...STORE_HELP].join("\n"));
  const store = opts.store as StoreChoice;
  const { base, git } = projectBase(cwd);
  if ((store === "ignore" || store === "local") && !git) {
    throw new WkError(`--store ${store} needs a git repo. Use --store repo or --store home here.`);
  }
  const root = store === "home" ? homeRoot(base, opts.home) : path.join(base, WORK_DIR);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, CONFIG_FILE), configText(store));
  ensureLayout(root, store);
  const lines = [`Created ${root}`];
  if (store === "ignore" || store === "local") {
    const file = store === "ignore" ? path.join(base, ".gitignore") : excludeFile(base);
    const added = file ? addIgnores(file, [`${WORK_DIR}/`]) : [];
    if (file && added.length) lines.push(`Ignored in ${path.relative(base, file).split(path.sep).join("/")}: ${added.join(" ")}`);
  }
  lines.push("Next: wk brief");
  return result(lines, { root, store });
}
