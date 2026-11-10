import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { WkError } from "./output.js";

export type Prefix = "E" | "T" | "I" | "D" | "L";

export const STORES = ["repo", "ignore", "local", "home"] as const;
export type StoreChoice = (typeof STORES)[number];

export const BRANCH_MODES = ["none", "task", "epic"] as const;
export type BranchMode = (typeof BRANCH_MODES)[number];
export const COMMIT_MODES = ["ask", "task", "checkpoint"] as const;
export type CommitMode = (typeof COMMIT_MODES)[number];

export interface GitWorkflow {
  /** null until the user chooses. Until then the agent asks and wk never branches. */
  branch: BranchMode | null;
  /** null until the user chooses. Until then the agent asks before any commit. */
  commit: CommitMode | null;
}

export interface Config {
  /** Where the plan is kept; set by `wk init --store`. */
  store: StoreChoice;
  git: GitWorkflow;
  principles_dir: string;
  counters: Record<Prefix, number>;
}

export const CONFIG_FILE = "config.yml";

export function defaultConfigText(store: StoreChoice): string {
  return [
    `store: ${store}`.padEnd(30) + "# repo, ignore, local or home; chosen at wk init",
    "principles_dir: principles   # or an absolute path, shared across projects",
    "counters: { E: 0, T: 0, I: 0, D: 0, L: 0 }",
    "# Your git workflow. Empty means not chosen: the agent asks, wk never branches.",
    "# Set with: wk config set git.branch none|task|epic, wk config set git.commit ask|task|checkpoint",
    "git:",
    "  branch:",
    "  commit:",
    "",
  ].join("\n");
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function load(file: string): Record<string, unknown> {
  try {
    return (yaml.load(fs.readFileSync(file, "utf8")) ?? {}) as Record<string, unknown>;
  } catch (e) {
    throw new WkError(`Cannot read ${file}: ${(e as Error).message}`);
  }
}

export function readConfig(root: string): Config {
  const c = load(path.join(root, CONFIG_FILE));
  const counters = { E: 0, T: 0, I: 0, D: 0, L: 0, ...((c.counters as Partial<Record<Prefix, number>>) ?? {}) };
  const store = pick(c.store, STORES) ?? "repo";
  const git = (c.git ?? {}) as Record<string, unknown>;
  // Older configs used branch_on_start: true for per-task branches.
  const legacyBranch: BranchMode | null = c.branch_on_start === true ? "task" : null;
  return {
    store,
    git: { branch: pick(git.branch, BRANCH_MODES) ?? legacyBranch, commit: pick(git.commit, COMMIT_MODES) },
    principles_dir: typeof c.principles_dir === "string" && c.principles_dir ? c.principles_dir : "principles",
    counters,
  };
}

/** Rewrites only the `counters:` line, so comments and phase-three keys survive. */
export function writeCounters(root: string, counters: Record<Prefix, number>): void {
  const file = path.join(root, CONFIG_FILE);
  const text = fs.readFileSync(file, "utf8");
  const line = `counters: { E: ${counters.E}, T: ${counters.T}, I: ${counters.I}, D: ${counters.D}, L: ${counters.L} }`;
  fs.writeFileSync(file, replaceBlock(text, "counters", line));
}

/** Replaces a top-level key and its indented child lines, or appends it. */
function replaceBlock(text: string, key: string, replacement: string): string {
  // Matches the flow form and a block form with indented child lines.
  const existing = new RegExp(`^${key}:.*(?:\\r?\\n[ \\t]+.*)*`, "m");
  return existing.test(text) ? text.replace(existing, replacement) : text.replace(/\n*$/, "\n") + replacement + "\n";
}

export const SETTABLE: Record<string, readonly string[] | "path"> = {
  "git.branch": BRANCH_MODES,
  "git.commit": COMMIT_MODES,
  principles_dir: "path",
};

/** Sets one key in config.yml, touching only that key's lines. */
export function setConfigValue(root: string, key: string, value: string): void {
  const allowed = SETTABLE[key];
  if (!allowed) throw new WkError(`Unknown setting "${key}". Settable: ${Object.keys(SETTABLE).join(", ")}`);
  if (allowed !== "path" && !allowed.includes(value)) {
    throw new WkError(`${key} must be one of: ${allowed.join(", ")}`);
  }
  if (allowed === "path" && !value.trim()) throw new WkError(`${key} can't be empty.`);
  const file = path.join(root, CONFIG_FILE);
  let text = fs.readFileSync(file, "utf8");
  if (key.startsWith("git.")) {
    const current = readConfig(root).git;
    const next = { ...current, [key.slice(4)]: value };
    const block = ["git:", `  branch:${next.branch ? ` ${next.branch}` : ""}`, `  commit:${next.commit ? ` ${next.commit}` : ""}`];
    text = replaceBlock(text, "git", block.join("\n"));
    // The git block replaces the old flag.
    text = text.replace(/^branch_on_start:.*\r?\n?/m, "");
  } else {
    text = replaceBlock(text, key, `${key}: ${JSON.stringify(value)}`);
  }
  fs.writeFileSync(file, text);
}

export function describeGit(git: GitWorkflow): string {
  const branch =
    git.branch === null ? "branching not chosen" : git.branch === "none" ? "no branches" : git.branch === "task" ? "a branch per task" : "a branch per epic";
  const commit =
    git.commit === null
      ? "commits not chosen"
      : git.commit === "ask"
        ? "ask before each commit"
        : git.commit === "task"
          ? "commit after each task"
          : "commit at each checkpoint";
  return `${branch}, ${commit}`;
}
