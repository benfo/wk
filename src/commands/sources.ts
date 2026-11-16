import fs from "node:fs";
import path from "node:path";
import { remoteUrl, todoCount } from "../git.js";

export interface Sources {
  /** Plan-like files and folders, relative to the project, with a hint of what they hold. */
  files: string[];
  todos: number | null;
  github: boolean;
}

const PLAN_FILE = /^(todo|todos|roadmap|backlog|tasks|plan|planning)(\.(md|txt|markdown))?$/i;
const PLAN_DIRS: Record<string, string> = {
  "docs/plans": "plans",
  "docs/roadmap": "plans",
  "docs/adr": "decisions",
  "docs/adrs": "decisions",
  "docs/decisions": "decisions",
  adr: "decisions",
  "doc/adr": "decisions",
};

function planFiles(dir: string, prefix: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && PLAN_FILE.test(e.name))
    .map((e) => prefix + e.name);
}

/** Looks for existing plans worth migrating. Cheap: a few folder reads and one git grep. */
export function findSources(base: string, git: boolean): Sources {
  const files = [...planFiles(base, ""), ...planFiles(path.join(base, "docs"), "docs/")];
  for (const [dir, kind] of Object.entries(PLAN_DIRS)) {
    const full = path.join(base, ...dir.split("/"));
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) files.push(`${dir}/ (${kind})`);
  }
  const remote = git ? remoteUrl(base) : null;
  return { files, todos: git ? todoCount(base) : null, github: !!remote && /github\.com/i.test(remote) };
}

/** One line for `wk init`, or null when there is nothing to migrate. */
export function sourcesLine(s: Sources): string | null {
  const parts = [...s.files];
  if (s.todos) parts.push(`${s.todos} TODO/FIXME comment${s.todos === 1 ? "" : "s"}`);
  if (s.github) parts.push("GitHub issues (ask first)");
  return parts.length ? `Existing plans: ${parts.join(", ")}. Offer onboarding (wk guide onboarding).` : null;
}
