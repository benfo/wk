import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { run, type RunOutput } from "../src/run.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

export function tmpDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wk-test-")));
  dirs.push(dir);
  return dir;
}

export const TODAY = "2026-11-10";

export interface Project {
  dir: string;
  /** Stand-in for ~/.wk, so tests never touch the real one. */
  home: string;
  /** Runs wk and returns stdout; fails the test if the exit code isn't 0. */
  wk: (...args: string[]) => string;
  /** Runs wk and returns the full result, whatever the exit code. */
  raw: (...args: string[]) => RunOutput;
  /** Runs wk with text on stdin, for --from -. */
  pipe: (stdin: string, ...args: string[]) => RunOutput;
  /** Runs wk on another day. */
  on: (today: string, ...args: string[]) => RunOutput;
  file: (...parts: string[]) => string;
  read: (...parts: string[]) => string;
}

export function project(opts: { git?: boolean; init?: boolean; store?: string } = {}): Project {
  const dir = tmpDir();
  const home = tmpDir();
  if (opts.git) gitInit(dir);
  const raw = (...args: string[]) => run(args, { cwd: dir, today: TODAY, home });
  const p: Project = {
    dir,
    home,
    raw,
    on: (today, ...args) => run(args, { cwd: dir, today, home }),
    pipe: (stdin, ...args) => run(args, { cwd: dir, today: TODAY, home, stdin }),
    wk: (...args) => {
      const r = raw(...args);
      if (r.code !== 0) throw new Error(`wk ${args.join(" ")} failed (${r.code}): ${r.stderr || r.stdout}`);
      return r.stdout;
    },
    file: (...parts) => path.join(dir, ".work", ...parts),
    read: (...parts) => fs.readFileSync(path.join(dir, ".work", ...parts), "utf8"),
  };
  if (opts.init !== false) p.wk("init", "--store", opts.store ?? "repo");
  return p;
}

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

export function gitInit(dir: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
}

export const hasGit = spawnSync("git", ["--version"]).status === 0;
