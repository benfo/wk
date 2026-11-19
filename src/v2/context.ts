import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { STORES, type StoreChoice } from "../config.js";
import { findRoot, wkHome } from "../context.js";
import { repoTop } from "../git.js";
import { WkError } from "../output.js";

export const CONFIG_FILE = "config.yml";
export const VERSION = 2;

export interface Config {
  version: number;
  store: StoreChoice;
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

export function configText(store: StoreChoice): string {
  return [`version: ${VERSION}`, `store: ${store}`.padEnd(14) + "# repo, ignore, local or home; chosen at wk init", ""].join("\n");
}

export function readConfig(root: string): Config {
  const file = path.join(root, CONFIG_FILE);
  let raw: Record<string, unknown>;
  try {
    raw = (yaml.load(fs.readFileSync(file, "utf8")) ?? {}) as Record<string, unknown>;
  } catch (e) {
    throw new WkError(`Cannot read ${file}: ${(e as Error).message}`);
  }
  const store = STORES.includes(raw.store as StoreChoice) ? (raw.store as StoreChoice) : "repo";
  return { version: typeof raw.version === "number" ? raw.version : 1, store };
}

export const V1_PLAN = "This is a v1 plan, which this version can't read. Convert it with wk migrate.";

export function loadContext(cwd: string, today: string, home?: string, pick?: (n: number) => number): Ctx {
  const found = findRoot(cwd, home);
  if (!found) throw new WkError("No wk plan found for this project. Run: wk init --store <repo|ignore|local|home>");
  const config = readConfig(found.root);
  if (config.version < VERSION) throw new WkError(V1_PLAN);
  return { cwd, ...found, config, today, git: repoTop(found.base) !== null, home: wkHome(home), pick };
}
