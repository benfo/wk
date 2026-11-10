import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILE, readConfig, type Config } from "./config.js";
import { remoteUrl, repoTop } from "./git.js";
import { WkError } from "./output.js";

export const WORK_DIR = ".work";

export interface Ctx {
  /** Where the command was run. */
  cwd: string;
  /** The project folder: the repo top level, or the folder that holds `.work/` outside git. */
  base: string;
  /** The plan folder: `.work/` in the project, or `~/.wk/projects/<slug>/`. */
  root: string;
  config: Config;
  /** Today as YYYY-MM-DD. */
  today: string;
  /** True when `base` is inside a git repo. */
  git: boolean;
}

export function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Where home-stored plans live. WK_HOME overrides `~/.wk`. */
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

/**
 * The folder name under ~/.wk/projects/. From the git remote when there is one, so every clone
 * of a repo shares one plan; otherwise the folder name plus a hash of its path.
 */
export function projectSlug(base: string): string {
  const remote = repoTop(base) ? remoteUrl(base) : null;
  if (remote) return clean(remotePath(remote)) || "project";
  const hash = createHash("sha1").update(path.resolve(base).toLowerCase()).digest("hex").slice(0, 8);
  return `${clean(path.basename(base)) || "project"}-${hash}`;
}

export function homeRoot(base: string, home?: string): string {
  return path.join(wkHome(home), "projects", projectSlug(base));
}

/**
 * Finds the plan: the nearest `.work/config.yml` walking up from `cwd`, else a home-stored plan
 * for the repo (or, outside git, for the current folder or one above it).
 */
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

export function loadContext(cwd: string, today: string, home?: string): Ctx {
  const found = findRoot(cwd, home);
  if (!found) throw new WkError("No wk plan found for this project. Run: wk init --store <repo|ignore|local|home>");
  const { root, base } = found;
  return { cwd, base, root, config: readConfig(root), today, git: repoTop(base) !== null };
}
