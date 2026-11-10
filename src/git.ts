import { spawnSync } from "node:child_process";
import path from "node:path";

function git(cwd: string, args: string[], raw = false): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (r.error) return { ok: false, out: "", err: r.error.message };
  const out = r.stdout ?? "";
  return { ok: r.status === 0, out: raw ? out : out.trim(), err: (r.stderr ?? "").trim() };
}

/** Absolute path of the repo top level, or null outside a git repo (or without git). */
export function repoTop(cwd: string): string | null {
  const r = git(cwd, ["rev-parse", "--show-toplevel"]);
  return r.ok && r.out ? r.out : null;
}

export function currentBranch(cwd: string): string | null {
  // symbolic-ref also works before the first commit, where rev-parse fails.
  const r = git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (r.ok && r.out) return r.out;
  const detached = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return detached.ok ? detached.out : null;
}

export function createBranch(cwd: string, name: string): { ok: boolean; message: string } {
  const r = git(cwd, ["checkout", "-b", name]);
  return { ok: r.ok, message: r.ok ? name : r.err || "git checkout failed" };
}

export interface DiffSummary {
  files: string[];
  shortstat: string;
}

/** Changed files (tracked and untracked, excluding .work/) and a line count summary. */
export function diffSummary(cwd: string): DiffSummary | null {
  // Raw output: porcelain lines start with a status column that may be a space.
  const status = git(cwd, ["status", "--porcelain", "--untracked-files=all"], true);
  if (!status.ok) return null;
  const files = status.out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .map((f) => (f.includes(" -> ") ? f.split(" -> ")[1] : f))
    .filter((f) => !f.startsWith(".work/"));
  const stat = git(cwd, ["diff", "--shortstat", "HEAD", "--", ".", ":(exclude).work"]);
  return { files, shortstat: stat.ok ? stat.out : "" };
}

/** The `origin` remote URL (or the first remote), or null. */
export function remoteUrl(cwd: string): string | null {
  const origin = git(cwd, ["remote", "get-url", "origin"]);
  if (origin.ok && origin.out) return origin.out;
  const first = git(cwd, ["remote"]).out.split("\n")[0];
  if (!first) return null;
  const r = git(cwd, ["remote", "get-url", first]);
  return r.ok && r.out ? r.out : null;
}

/** Absolute path of the repo's personal ignore file (.git/info/exclude), worktree-aware. */
export function excludeFile(cwd: string): string | null {
  const r = git(cwd, ["rev-parse", "--git-path", "info/exclude"]);
  if (!r.ok || !r.out) return null;
  return path.resolve(cwd, r.out);
}

/** Number of TODO and FIXME markers in tracked text files, or null outside git. */
export function todoCount(cwd: string): number | null {
  // -w matches whole words, so "todos" and "TODOS" don't count.
  const r = git(cwd, ["grep", "-I", "-c", "-w", "-E", "TODO|FIXME", "--", ".", ":(exclude).work"]);
  // git grep exits 1 when nothing matches.
  if (!r.ok) return r.err ? null : 0;
  return r.out
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(":") + 1) || 0), 0);
}

export function branchExists(cwd: string, name: string): boolean {
  return git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]).ok;
}

export function checkoutBranch(cwd: string, name: string): { ok: boolean; message: string } {
  const r = git(cwd, ["checkout", name]);
  return { ok: r.ok, message: r.ok ? name : r.err || "git checkout failed" };
}
