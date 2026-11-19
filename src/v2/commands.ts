import fs from "node:fs";
import path from "node:path";
import { STORES, type StoreChoice } from "../config.js";
import { findRoot, homeRoot, projectBase, WORK_DIR } from "../context.js";
import { excludeFile } from "../git.js";
import { addIgnores } from "../commands/init.js";
import { result, unescapeText, WkError, type Result } from "../output.js";
import { isSimilar } from "../similar.js";
import { CONFIG_FILE, configText, readConfig, V1_PLAN, type Ctx } from "./context.js";
import { checkLines, checkTitle, LIMITS } from "./limits.js";
import {
  ARCHIVE_DIR, AREA_FILE, AREAS_DIR, CORE_AREA, INBOX_DIR, PROJECTS_DIR, str, tagsOf, type Item, type Store,
} from "./store.js";

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

function writeIfMissing(file: string, text: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
}

/** Creates whatever part of the layout is missing; never overwrites. */
function ensureLayout(root: string, store: StoreChoice): void {
  for (const dir of [INBOX_DIR, PROJECTS_DIR, ARCHIVE_DIR, path.join(AREAS_DIR, CORE_AREA)]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  writeIfMissing(path.join(root, AREAS_DIR, CORE_AREA, AREA_FILE), `# ${CORE_AREA}\n\n${CORE_DESCRIPTION}\n`);
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

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

export function isOpen(item: Item): boolean {
  return item.kind === "task" && !["done", "dropped"].includes(str(item, "state"));
}

function guardSimilar(title: string, pool: Item[], force: boolean | undefined): void {
  if (force) return;
  const hits = pool.filter((i) => isSimilar(title, i.title));
  if (hits.length === 0) return;
  const lines = hits.slice(0, 3).map((h) => `Similar: ${h.id} ${h.title}`);
  lines.push("Update or merge the existing item, or rerun with --force.");
  throw new WkError(lines.join("\n"));
}

/** Where an item lives, for one-line output: "core", "inbox" or a project id. */
export function homeLabel(item: Item): string {
  return item.home.name;
}

export function addTask(ctx: Ctx, store: Store, rawTitle: string, opts: { body?: string; tags?: string; force?: boolean }): Result {
  const title = checkTitle(rawTitle, "Task title");
  const body = checkLines(unescapeText(opts.body ?? ""), LIMITS.taskBody, "Task body");
  guardSimilar(title, store.list().filter(isOpen), opts.force);
  const home = store.area(CORE_AREA);
  const item = store.create("task", home, title, body, { state: "open", when: "queue", tags: parseTags(opts.tags) });
  return result([`Added ${item.id} ${title} (${home.name})`], { id: item.id, title, home: home.name, file: item.file });
}

export function show(_ctx: Ctx, store: Store, raw: string): Result {
  const item = store.get(raw);
  const facts = [item.kind, str(item, "state"), str(item, "when"), homeLabel(item)].filter(Boolean);
  if (item.archived) facts.push("archived");
  const lines = [`${item.id}  ${facts.join(" · ")}`, item.title];
  const tags = tagsOf(item);
  if (tags.length) lines.push(`tags: ${tags.join(", ")}`);
  for (const key of ["from", "wait", "ref"]) if (str(item, key)) lines.push(`${key}: ${str(item, key)}`);
  lines.push(`created ${str(item, "created")} · updated ${str(item, "updated")}`);
  if (item.body) lines.push("", ...item.body.split("\n"));
  return { lines, data: { ...item.data, title: item.title, body: item.body, home: item.home.name, file: item.file }, full: true };
}
