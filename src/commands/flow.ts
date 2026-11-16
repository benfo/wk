import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "../context.js";
import { branchExists, checkoutBranch, createBranch, currentBranch, diffSummary } from "../git.js";
import { checkLines, checkTitle, LIMITS } from "../limits.js";
import { result, unescapeText, WkError, type Result } from "../output.js";
import { FRESH_AFTER_TASKS, readSession, writeSession } from "../session.js";
import { label, str, tags, type Store } from "../store.js";
import { assertState, commitHint, isBlocked, itemLine, nowTask, status } from "./shared.js";
import { fixPlan, problems } from "./tidy.js";
import { HANDOFF_FILE, nextView, principleLines } from "./view.js";

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
  // --branch / --no-branch win; otherwise follow git.branch. Not chosen means stay put.
  const mode = opts.branch === true ? "task" : opts.branch === false ? "none" : (ctx.config.git.branch ?? "none");
  if (mode !== "none") {
    if (!ctx.git) {
      lines.push("Not a git repo, no branch created.");
    } else {
      const epic = mode === "epic" && str(task, "epic") ? store.find(str(task, "epic")) : undefined;
      if (mode === "epic" && !epic) {
        lines.push("No epic, so no epic branch.");
      } else {
        const owner = epic ?? task;
        const name = `${owner.id}-${slugify(label(owner))}`;
        if (currentBranch(ctx.base) !== name) {
          const r = branchExists(ctx.base, name) ? checkoutBranch(ctx.base, name) : createBranch(ctx.base, name);
          if (!r.ok) throw new WkError(`Could not switch to branch ${name}: ${r.message}`);
        }
        branch = name;
      }
    }
  }
  task.data.status = "now";
  store.save(task);
  lines.unshift(`now   ${task.id} ${label(task)}`);
  if (branch) lines.push(`Branch: ${branch}`);
  else if (ctx.git) lines.push(`On branch: ${currentBranch(ctx.base) ?? "unknown"}`);

  // A task from another epic rarely needs this session's context.
  const session = readSession(ctx);
  const epic = str(task, "epic");
  const switched = session.lastEpic !== null && session.lastEpic !== epic;
  if (switched) {
    lines.push(`Different epic from the last task (${session.lastEpic || "no epic"}): suggest a fresh session, after a handoff.`);
  }
  writeSession(ctx, { ...session, lastEpic: epic });

  // Everything needed to begin, so starting a task is one call: its body, then its principles.
  const body = task.body.split("\n").filter((l) => l.trim());
  if (body.length) lines.push("", ...body);
  const rules = principleLines(ctx, tags(task));
  if (rules.lines.length) lines.push("", "Principles:", ...rules.lines);
  const data = { id: task.id, status: "now", branch, epic_switch: switched, body: task.body, principles: rules.data };
  return { ...result(lines, data), full: true };
}

const TEST_LINE = /^Test:\s*/i;

const HANDOFF_NUDGE = "wk handoff (keeps a fresh session safe)";

function splitLines(values: string[] | undefined): string[] {
  return (values ?? []).map(unescapeText).flatMap((t) => t.split("\n")).map((t) => t.trim()).filter(Boolean);
}

/**
 * Moves the now task to review. `test` is for a human (how it looks, feels, reads, responds);
 * `checked` records automated results the agent already ran (tests, types, build).
 */
export function checkpoint(ctx: Ctx, store: Store, opts: { test?: string[]; checked?: string[]; handoff?: string }): Result {
  const task = nowTask(store);
  if (!task) throw new WkError("Nothing is now. Start a task first: wk start <id>");
  const note = opts.handoff !== undefined ? handoffText(opts.handoff) : null;
  const given = splitLines(opts.test);
  const checked = splitLines(opts.checked);
  for (const c of checked) checkTitle(c, "A --checked line");
  const rest = task.body.split("\n").filter((l) => !TEST_LINE.test(l));
  let tests = task.body.split("\n").filter((l) => TEST_LINE.test(l)).map((l) => l.replace(TEST_LINE, ""));
  if (given.length) {
    tests = given;
    const body = [...tests.map((t) => `Test: ${t}`), ...(rest.some((l) => l.trim()) ? ["", ...rest] : [])].join("\n");
    task.body = checkLines(body, LIMITS.taskBody, "Task body with tests");
  }
  // Automated results live in frontmatter: they describe this checkpoint, not the task.
  if (checked.length) task.data.checked = checked;
  else delete task.data.checked;
  task.data.status = "review";
  store.save(task);

  const lines = [`review ${task.id} ${label(task)}`];
  lines.push(...tests.map((t) => `Test (you): ${t}`));
  lines.push(...checked.map((c) => `Checked: ${c}`));
  if (tests.length === 0 && checked.length === 0) {
    lines.push('Nothing checked or tested. Add --checked "<automated result>" and/or --test "<for a human>".');
  } else if (tests.length === 0) {
    lines.push("Nothing for a human to try. Use Review: what changed, why, which files.");
  }

  const diff = ctx.git ? diffSummary(ctx.base) : null;
  if (diff) {
    if (diff.files.length === 0) lines.push("No uncommitted changes.");
    else {
      lines.push(`Changed: ${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${diff.shortstat ? ` (${diff.shortstat.replace(/^\d+ files? changed, /, "")})` : ""}`);
      const shown = diff.files.slice(0, 3);
      lines.push(`  ${shown.join(", ")}${diff.files.length > shown.length ? `, +${diff.files.length - shown.length} more` : ""}`);
    }
  }
  const git = commitHint(ctx, "checkpoint");
  if (git) lines.push(git);
  // Tidy runs along: only the first problem shows, so the Next line stays in view.
  const left = problems(ctx, store);
  if (left.length) lines.push(`Tidy: ${left[0]}${left.length > 1 ? ` (+${left.length - 1} more, wk tidy)` : ""}`);
  if (note) writeHandoff(ctx, note);
  const then = `send the check-in (Done/Checked/Try/Next), then wk done ${task.id} once the user confirms.`;
  lines.push(note ? `Handoff saved. Next: ${then}` : `Next: ${HANDOFF_NUDGE}, ${then}`);
  return result(lines, {
    tidy: left,
    handoff: note,
    id: task.id,
    status: "review",
    tests,
    checked,
    git,
    changed: diff?.files ?? null,
    shortstat: diff?.shortstat ?? null,
  });
}

export function done(ctx: Ctx, store: Store, rawId: string, opts: { force?: boolean; handoff?: string }): Result {
  const task = store.get(rawId, "task");
  const given = opts.handoff !== undefined ? handoffText(opts.handoff) : null;
  if (status(task) === "done") return result([`${task.id} is already done.`], { id: task.id, status: "done" });
  if (status(task) !== "review" && !opts.force) {
    throw new WkError(`${task.id} is ${status(task)}, not review. Run wk checkpoint first, or --force for trivial tasks.`);
  }
  task.data.status = "done";
  task.data.done_on = ctx.today;
  task.data.blocked = false;
  delete task.data.blocked_reason;
  store.save(task);
  const git = commitHint(ctx, "done");

  const session = readSession(ctx);
  const finished = session.done.includes(task.id) ? session.done : [...session.done, task.id];
  writeSession(ctx, { ...session, done: finished });
  const count = finished.length;
  const advice =
    count >= FRESH_AFTER_TASKS
      ? `${count} tasks done this session: suggest a fresh session unless the next task builds on this one.`
      : "Next task unrelated, or context heavy? Suggest a fresh session.";

  // Done is a stop: archive old done items and leave a handoff, so a fresh session can start here.
  // Epics stay open: more tasks may still join them, so closing one is wk tidy --fix's call.
  const { archived } = fixPlan(ctx, store, false);
  const top = nextView(store, 1).next[0];
  const note = given ?? `Done: ${task.id} ${label(task)}.\nNext: ${top ? itemLine(top) : "nothing queued"}.`;
  writeHandoff(ctx, note);
  const lines = [`done  ${task.id} ${label(task)}`, ...(git ? [git] : [])];
  if (archived.length) lines.push(`Archived ${archived.length} old done item${archived.length === 1 ? "" : "s"}.`);
  lines.push(`Handoff ${given ? "saved" : "written from the next task (pass --handoff for more)"}. ${advice}`);
  return result(lines, {
    id: task.id,
    status: "done",
    git,
    session_tasks: count,
    handoff: note,
    archived: archived.map((i) => i.id),
  });
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

function handoffText(raw: string): string {
  const text = checkLines(unescapeText(raw ?? ""), LIMITS.handoff, "Handoff");
  if (!text) throw new WkError("Handoff is empty.");
  return text;
}

function writeHandoff(ctx: Ctx, text: string): void {
  fs.writeFileSync(path.join(ctx.root, HANDOFF_FILE), text + "\n");
}

export function handoff(ctx: Ctx, _store: Store, raw: string): Result {
  const text = handoffText(raw);
  writeHandoff(ctx, text);
  return result([`Handoff saved (${text.split("\n").length} line${text.includes("\n") ? "s" : ""}).`], { handoff: text });
}
