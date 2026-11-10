import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "../context.js";
import { createBranch, currentBranch, diffSummary } from "../git.js";
import { checkLines, LIMITS } from "../limits.js";
import { result, unescapeText, WkError, type Result } from "../output.js";
import { label, str, type Store } from "../store.js";
import { assertState, isBlocked, nowTask, status } from "./shared.js";
import { HANDOFF_FILE } from "./view.js";

export function slugify(title: string, max = 40): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/, "");
}

export function start(ctx: Ctx, store: Store, rawId: string, opts: { branch?: boolean }): Result {
  const task = store.get(rawId, "task");
  const current = nowTask(store);
  if (current && current.id !== task.id) {
    throw new WkError(`${current.id} is already now. Checkpoint or block it first.`);
  }
  if (current?.id === task.id) return result([`${task.id} is already now.`], { id: task.id, status: "now" });
  assertState(task, ["later", "next", "review"], "start it");
  if (isBlocked(task)) throw new WkError(`${task.id} is blocked: ${str(task, "blocked_reason")}. Unblock it first.`);

  const lines: string[] = [];
  let branch: string | null = null;
  const wantBranch = opts.branch ?? ctx.config.branch_on_start;
  if (wantBranch) {
    if (!ctx.git) {
      lines.push("Not a git repo, no branch created.");
    } else {
      const name = `${task.id}-${slugify(label(task))}`;
      const r = createBranch(ctx.base, name);
      if (!r.ok) throw new WkError(`Could not create branch ${name}: ${r.message}`);
      branch = name;
    }
  }
  task.data.status = "now";
  store.save(task);
  lines.unshift(`now   ${task.id} ${label(task)}`);
  if (branch) lines.push(`Branch: ${branch}`);
  else if (ctx.git) lines.push(`On branch: ${currentBranch(ctx.base) ?? "unknown"}`);
  return result(lines, { id: task.id, status: "now", branch });
}

const TEST_LINE = /^Test:\s*/i;

export function checkpoint(ctx: Ctx, store: Store, opts: { test?: string[] }): Result {
  const task = nowTask(store);
  if (!task) throw new WkError("Nothing is now. Start a task first: wk start <id>");
  const given = (opts.test ?? []).map(unescapeText).flatMap((t) => t.split("\n")).map((t) => t.trim()).filter(Boolean);
  const rest = task.body.split("\n").filter((l) => !TEST_LINE.test(l));
  let tests = task.body.split("\n").filter((l) => TEST_LINE.test(l)).map((l) => l.replace(TEST_LINE, ""));
  if (given.length) {
    tests = given;
    const body = [...tests.map((t) => `Test: ${t}`), ...(rest.some((l) => l.trim()) ? ["", ...rest] : [])].join("\n");
    task.body = checkLines(body, LIMITS.taskBody, "Task body with tests");
  }
  task.data.status = "review";
  store.save(task);

  const lines = [`review ${task.id} ${label(task)}`];
  if (tests.length) lines.push(...tests.map((t) => `Test: ${t}`));
  else lines.push('No tests recorded. Add some: wk checkpoint --test "<what to test>"');

  const diff = ctx.git ? diffSummary(ctx.base) : null;
  if (diff) {
    if (diff.files.length === 0) lines.push("No uncommitted changes.");
    else {
      lines.push(`Changed: ${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${diff.shortstat ? ` (${diff.shortstat.replace(/^\d+ files? changed, /, "")})` : ""}`);
      const shown = diff.files.slice(0, 3);
      lines.push(`  ${shown.join(", ")}${diff.files.length > shown.length ? `, +${diff.files.length - shown.length} more` : ""}`);
    }
  }
  lines.push(`After testing: wk done ${task.id}`);
  return result(lines, { id: task.id, status: "review", tests, changed: diff?.files ?? null, shortstat: diff?.shortstat ?? null });
}

export function done(ctx: Ctx, store: Store, rawId: string, opts: { force?: boolean }): Result {
  const task = store.get(rawId, "task");
  if (status(task) === "done") return result([`${task.id} is already done.`], { id: task.id, status: "done" });
  if (status(task) !== "review" && !opts.force) {
    throw new WkError(`${task.id} is ${status(task)}, not review. Run wk checkpoint first, or --force for trivial tasks.`);
  }
  task.data.status = "done";
  task.data.done_on = ctx.today;
  task.data.blocked = false;
  delete task.data.blocked_reason;
  store.save(task);
  return result([`done  ${task.id} ${label(task)}`], { id: task.id, status: "done" });
}

export function block(_ctx: Ctx, store: Store, rawId: string, reason: string): Result {
  const task = store.get(rawId, "task");
  assertState(task, ["later", "next", "now", "review"], "block it");
  const why = reason?.trim();
  if (!why) throw new WkError('Say why: wk block <id> "<reason>"');
  checkLines(why, 1, "Block reason");
  task.data.blocked = true;
  task.data.blocked_reason = why;
  store.save(task);
  return result([`blocked ${task.id} ${label(task)}: ${why}`], { id: task.id, blocked: true, reason: why });
}

export function unblock(_ctx: Ctx, store: Store, rawId: string): Result {
  const task = store.get(rawId, "task");
  if (!isBlocked(task)) return result([`${task.id} is not blocked.`], { id: task.id, blocked: false });
  task.data.blocked = false;
  delete task.data.blocked_reason;
  store.save(task);
  return result([`unblocked ${task.id} ${label(task)}`], { id: task.id, blocked: false });
}

export function handoff(ctx: Ctx, _store: Store, raw: string): Result {
  const text = checkLines(unescapeText(raw ?? ""), LIMITS.handoff, "Handoff");
  if (!text) throw new WkError("Handoff is empty.");
  fs.writeFileSync(path.join(ctx.root, HANDOFF_FILE), text + "\n");
  return result([`Handoff saved (${text.split("\n").length} line${text.includes("\n") ? "s" : ""}).`], { handoff: text });
}
