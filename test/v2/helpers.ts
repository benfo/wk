import fs from "node:fs";
import path from "node:path";
import { run, type RunOptions, type RunOutput } from "../../src/v2/run.js";
import { gitInit, tmpDir, TODAY } from "../helpers.js";

export interface Plan {
  dir: string;
  home: string;
  wk: (...args: string[]) => string;
  raw: (...args: string[]) => RunOutput;
  /** Runs with extra options, e.g. a fixed random source. */
  with: (opts: Partial<RunOptions>, ...args: string[]) => RunOutput;
  file: (...parts: string[]) => string;
  read: (...parts: string[]) => string;
  /** Item files under a folder of the plan, relative names only. */
  files: (...parts: string[]) => string[];
}

export function plan(opts: { git?: boolean; init?: boolean; store?: string } = {}): Plan {
  const dir = tmpDir();
  const home = tmpDir();
  if (opts.git) gitInit(dir);
  const base: RunOptions = { cwd: dir, today: TODAY, home };
  const raw = (...args: string[]) => run(args, base);
  const p: Plan = {
    dir,
    home,
    raw,
    with: (o, ...args) => run(args, { ...base, ...o }),
    wk: (...args) => {
      const r = raw(...args);
      if (r.code !== 0) throw new Error(`wk ${args.join(" ")} failed (${r.code}): ${r.stderr || r.stdout}`);
      return r.stdout;
    },
    file: (...parts) => path.join(dir, ".work", ...parts),
    read: (...parts) => fs.readFileSync(path.join(dir, ".work", ...parts), "utf8"),
    files: (...parts) => fs.readdirSync(path.join(dir, ".work", ...parts)).filter((f) => f.endsWith(".md")).sort(),
  };
  if (opts.init !== false) p.wk("init", "--store", opts.store ?? "repo");
  return p;
}

/** Writes an item file by hand, for states the commands under test can't reach yet. */
export function put(p: Plan, home: string[], id: string, title: string, data: Record<string, string | number | string[]>): string {
  const lines = ["---", `id: ${id}`];
  for (const [k, v] of Object.entries({ kind: "task", ...data })) lines.push(`${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`);
  lines.push("created: 2026-11-10", "updated: 2026-11-10", "---", `# ${title}`, "");
  const dir = p.file(...home);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

/** A random source that returns these alphabet indexes in turn, then repeats the last. */
export function fixedPick(...indexes: number[]): (n: number) => number {
  let i = 0;
  return () => indexes[Math.min(i++, indexes.length - 1)];
}
