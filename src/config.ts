import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { WkError } from "./output.js";

export type Prefix = "E" | "T" | "I" | "D" | "L";

export const STORES = ["repo", "ignore", "local", "home"] as const;
export type StoreChoice = (typeof STORES)[number];

export interface Config {
  /** Where the plan is kept; set by `wk init --store`. */
  store: StoreChoice;
  branch_on_start: boolean;
  principles_dir: string;
  counters: Record<Prefix, number>;
}

export const CONFIG_FILE = "config.yml";

export function defaultConfigText(store: StoreChoice): string {
  return [
    `store: ${store}`.padEnd(30) + "# repo, ignore, local or home; chosen at wk init",
    "branch_on_start: false        # true creates a <id>-<slug> branch on wk start",
    "principles_dir: principles   # or an absolute path, shared across projects",
    "counters: { E: 0, T: 0, I: 0, D: 0, L: 0 }",
    "",
  ].join("\n");
}

export function readConfig(root: string): Config {
  const file = path.join(root, CONFIG_FILE);
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new WkError(`Cannot read ${file}: ${(e as Error).message}`);
  }
  const c = (raw ?? {}) as Partial<Config> & { counters?: Partial<Record<Prefix, number>> };
  const counters = { E: 0, T: 0, I: 0, D: 0, L: 0, ...(c.counters ?? {}) };
  const store = STORES.includes(c.store as StoreChoice) ? (c.store as StoreChoice) : "repo";
  return {
    store,
    branch_on_start: c.branch_on_start === true,
    principles_dir: typeof c.principles_dir === "string" && c.principles_dir ? c.principles_dir : "principles",
    counters,
  };
}

/** Rewrites only the `counters:` line, so comments and phase-three keys survive. */
export function writeCounters(root: string, counters: Record<Prefix, number>): void {
  const file = path.join(root, CONFIG_FILE);
  const text = fs.readFileSync(file, "utf8");
  const line = `counters: { E: ${counters.E}, T: ${counters.T}, I: ${counters.I}, D: ${counters.D}, L: ${counters.L} }`;
  // Matches the flow form and a block form with indented child lines.
  const existing = /^counters:.*(?:\r?\n[ \t]+.*)*/m;
  const next = existing.test(text)
    ? text.replace(existing, line)
    : text.replace(/\n*$/, "\n") + line + "\n";
  fs.writeFileSync(file, next);
}
