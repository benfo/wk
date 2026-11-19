import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { remoteUrl, repoTop } from "./git.js";
import { WkError } from "./output.js";

export const CONFIG_FILE = "config.yml";
export const VERSION = 2;
export const WORK_DIR = ".work";

export const STORES = ["repo", "ignore", "local", "home"] as const;
export type StoreChoice = (typeof STORES)[number];

export function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Where home-stored plans and per-machine state live. WK_HOME overrides `~/.wk`. */
export function wkHome(override?: string): string {
  return override ?? process.env.WK_HOME ?? path.join(os.homedir(), ".wk");
}

/** The folder `wk init` should use: the repo top level, or the current folder outside git. */
export function projectBase(cwd: string): { base: string; git: boolean } {
  const top = repoTop(cwd);
  return top ? { base: path.resolve(top), git: true } : { base: path.resolve(cwd), git: false };
}

function clean(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** "git@github.com:acme/app.git" and "https://github.com/acme/app" both give "acme/app". */
export function remotePath(url: string): string {
  const noSuffix = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const scp = /^[^/@:]+@[^:]+:(.+)$/.exec(noSuffix);
  if (scp) return scp[1];
  const parsed = /^[a-z+]+:\/\/[^/]+\/(.+)$/i.exec(noSuffix);
  return parsed ? parsed[1] : noSuffix;
}

/** The folder under ~/.wk/projects/: from the git remote, so every clone shares one plan; else name plus path hash. */
export function projectSlug(base: string): string {
  const remote = repoTop(base) ? remoteUrl(base) : null;
  if (remote) return clean(remotePath(remote)) || "project";
  const hash = createHash("sha1").update(path.resolve(base).toLowerCase()).digest("hex").slice(0, 8);
  return `${clean(path.basename(base)) || "project"}-${hash}`;
}

export function homeRoot(base: string, home?: string): string {
  return path.join(wkHome(home), "projects", projectSlug(base));
}

/** The nearest `.work/config.yml` walking up from `cwd`, else a home-stored plan for this repo or folder. */
export function findRoot(cwd: string, home?: string): { root: string; base: string } | null {
  const start = path.resolve(cwd);
  const ancestors: string[] = [];
  for (let dir = start; ; dir = path.dirname(dir)) {
    ancestors.push(dir);
    const candidate = path.join(dir, WORK_DIR);
    if (fs.existsSync(path.join(candidate, CONFIG_FILE))) return { root: candidate, base: dir };
    if (path.dirname(dir) === dir) break;
  }
  const top = repoTop(start);
  for (const base of top ? [path.resolve(top)] : ancestors) {
    const root = homeRoot(base, home);
    if (fs.existsSync(path.join(root, CONFIG_FILE))) return { root, base };
  }
  return null;
}

export const BRANCH_MODES = ["none", "task", "project"] as const;
export type BranchMode = (typeof BRANCH_MODES)[number];
export const COMMIT_MODES = ["ask", "task", "check"] as const;
export type CommitMode = (typeof COMMIT_MODES)[number];
export const PRESETS = ["software", "general"] as const;
export type Preset = (typeof PRESETS)[number];

export interface Workflow {
  /** null until the user chooses; until then the agent asks and wk never branches. */
  git: { branch: BranchMode | null; commit: CommitMode | null };
  commit_style: string | null;
  checks: { quick: string | null; full: string | null };
  tracker: string | null;
}

export interface Config {
  version: number;
  store: StoreChoice;
  preset: Preset | null;
  workflow: Workflow;
  /** Tags the plan knows; anything else gets a "new tag" note. */
  tags: string[];
  /** Date of the last `wk review --done`. */
  reviewed: string | null;
  /** Fingerprints of the agent instruction files read at setup. */
  setup: Record<string, string> | null;
}

export interface Ctx {
  cwd: string;
  /** The project folder: the repo top level, or the folder that holds `.work/` outside git. */
  base: string;
  /** The plan folder. */
  root: string;
  config: Config;
  today: string;
  git: boolean;
  home: string;
  /** Random source for ids; tests swap it. */
  pick?: (n: number) => number;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function defaultConfig(store: StoreChoice, preset: Preset | null = null): Config {
  return {
    version: VERSION,
    store,
    preset,
    workflow: { git: { branch: null, commit: null }, commit_style: null, checks: { quick: null, full: null }, tracker: null },
    tags: [],
    reviewed: null,
    setup: null,
  };
}

export function parseConfig(raw: Record<string, unknown>): Config {
  const wf = (raw.workflow ?? {}) as Record<string, unknown>;
  const git = (wf.git ?? {}) as Record<string, unknown>;
  const checks = (wf.checks ?? {}) as Record<string, unknown>;
  const setup = raw.setup && typeof raw.setup === "object" ? (raw.setup as Record<string, string>) : null;
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    store: pick(raw.store, STORES) ?? "repo",
    preset: pick(raw.preset, PRESETS),
    workflow: {
      git: { branch: pick(git.branch, BRANCH_MODES), commit: pick(git.commit, COMMIT_MODES) },
      commit_style: text(wf.commit_style),
      checks: { quick: text(checks.quick), full: text(checks.full) },
      tracker: text(wf.tracker),
    },
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    reviewed: typeof raw.reviewed === "string" ? raw.reviewed : raw.reviewed instanceof Date ? raw.reviewed.toISOString().slice(0, 10) : null,
    setup,
  };
}

const HEADER = [
  "# wk plan settings. Change them with: wk config set <key> <value>",
  "# workflow.git: branch none|task|project, commit ask|task|check; empty means not chosen yet.",
].join("\n");

export function configText(config: Config): string {
  const dump = (o: Record<string, unknown>) => yaml.dump(o, { lineWidth: 120 }).replace(/: null$/gm, ":");
  const head = dump({ version: config.version, store: config.store, preset: config.preset, workflow: config.workflow });
  // Tags read best on one line.
  const tags = `tags: [${config.tags.join(", ")}]\n`;
  const tail = dump({ reviewed: config.reviewed, ...(config.setup ? { setup: config.setup } : {}) });
  return `${HEADER}\n${head}${tags}${tail}`;
}

export function readConfig(root: string): Config {
  const file = path.join(root, CONFIG_FILE);
  let raw: Record<string, unknown>;
  try {
    raw = (yaml.load(fs.readFileSync(file, "utf8")) ?? {}) as Record<string, unknown>;
  } catch (e) {
    throw new WkError(`Cannot read ${file}: ${(e as Error).message}`);
  }
  return parseConfig(raw);
}

export function writeConfig(root: string, config: Config): void {
  fs.writeFileSync(path.join(root, CONFIG_FILE), configText(config));
}

export const V1_PLAN = "This is a v1 plan, which this version can't read. Convert it with wk migrate.";

export function loadContext(cwd: string, today: string, home?: string, pickFn?: (n: number) => number): Ctx {
  const found = findRoot(cwd, home);
  if (!found) throw new WkError("No wk plan found for this project. Run: wk init --store <repo|ignore|local|home>");
  const config = readConfig(found.root);
  if (config.version < VERSION) throw new WkError(V1_PLAN);
  return { cwd, ...found, config, today, git: repoTop(found.base) !== null, home: wkHome(home), pick: pickFn };
}
