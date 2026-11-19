import fs from "node:fs";
import path from "node:path";
import { branchExists, checkoutBranch, createBranch, currentBranch, diffSummary } from "../../git.js";
import { result, unescapeText, WkError, type Result } from "../../output.js";
import type { Ctx } from "../context.js";
import { slugify } from "../ids.js";
import { checkLines, checkTitle, LIMITS } from "../limits.js";
import { daysBetween, isWaiting, state } from "../model.js";
import { FRESH_AFTER_TASKS, readSession, writeSession } from "../session.js";
import { str, type Item, type Store } from "../store.js";
import { SESSION_FILE } from "./init.js";
import { nextView, queueLine } from "./views.js";

export const FRESH_MARK = "<!-- fresh session -->";
export const ARCHIVE_AFTER_DAYS = 7;

export function nowTask(store: Store): Item | undefined {
  return store.list().find((i) => i.kind === "task" && state(i) === "now");
}

function task(store: Store, raw: string): Item {
  const item = store.get(raw);
  if (item.kind !== "task") throw new WkError(`${item.id} is a ${item.kind}, not a task.`);
  return item;
}

/**
 * What the git workflow says to do at a stop, or null when it says nothing (or there's no git).
 * The agent follows this instead of its own git habits.
 */
export function commitHint(ctx: Ctx, moment: "check" | "done"): string | null {
  if (!ctx.git) return null;
  const { commit, branch } = ctx.config.workflow.git;
  if (commit === null || branch === null) {
    return "Git: workflow not chosen. Ask the user before any commit or branch, then save it with wk config set.";
  }
  if (commit === "ask") return "Git: ask the user before committing.";
  const due = commit === "task" ? "done" : "check";
  const style = ctx.config.workflow.commit_style ? ` Style: ${ctx.config.workflow.commit_style}.` : "";
  return moment === due ? `Git: commit now (commit: ${commit}).${style}` : null;
}

/** Hooks later features add to; each returns extra lines for its moment. */
export interface FlowHooks {
  onStart: ((ctx: Ctx, store: Store, item: Item) => string[])[];
  onCheck: ((ctx: Ctx, store: Store, item: Item) => string[])[];
  onDone: ((ctx: Ctx, store: Store, item: Item) => string[])[];
}

export const hooks: FlowHooks = { onStart: [], onCheck: [], onDone: [] };

export function start(ctx: Ctx, store: Store, raw: string, opts: { branch?: boolean }): Result {
  const item = task(store, raw);
  const current = nowTask(store);
  if (current && current.id !== item.id) throw new WkError(`${current.id} is already now. Check it or wait it first.`);
  if (current?.id === item.id) return result([`${item.id} is already now.`], { id: item.id, state: "now" });
  if (state(item) === "inbox") throw new WkError(`${item.id} is in the inbox. Sort it first: wk move ${item.id} --in <home>`);
  if (state(item) === "done") throw new WkError(`${item.id} is done.`);
  if (isWaiting(item)) throw new WkError(`${item.id} is waiting on ${str(item, "wait")}. Clear it first: wk wait ${item.id} --clear`);

  const lines: string[] = [];
  let branch: string | null = null;
  const mode = opts.branch === true ? "task" : opts.branch === false ? "none" : (ctx.config.workflow.git.branch ?? "none");
  if (mode !== "none") {
    if (!ctx.git) lines.push("Not a git repo, no branch created.");
    else {
      const project = mode === "project" && item.home.type === "project" ? store.project(item.home.name) : undefined;
      if (mode === "project" && !project) lines.push("Not in a project, so no project branch.");
      else {
        const name = project ? `${project.id}-${slugify(project.title)}` : `${item.id}-${slugify(item.title)}`;
        if (currentBranch(ctx.base) !== name) {
          const r = branchExists(ctx.base, name) ? checkoutBranch(ctx.base, name) : createBranch(ctx.base, name);
          if (!r.ok) throw new WkError(`Could not switch to branch ${name}: ${r.message}`);
        }
        branch = name;
      }
    }
  }
  item.data.state = "now";
  delete item.data.due;
  store.save(item);
  lines.unshift(`now   ${item.id} ${item.title} (${item.home.name})`);
  if (branch) lines.push(`Branch: ${branch}`);
  else if (ctx.git) lines.push(`On branch: ${currentBranch(ctx.base) ?? "unknown"}`);

  // A task from another home rarely needs this session's context.
  const session = readSession(ctx);
  const switched = session.lastHome !== null && session.lastHome !== item.home.name;
  if (switched) lines.push(`Different home from the last task (${session.lastHome}): suggest a fresh session, after a handoff.`);
  writeSession(ctx, { ...readSession(ctx), lastHome: item.home.name });

  // Everything needed to begin, so starting a task is one call.
  const body = item.body.split("\n").filter((l) => l.trim());
  if (body.length) lines.push("", ...body);
  for (const hook of hooks.onStart) lines.push(...hook(ctx, store, item));
  return { ...result(lines, { id: item.id, state: "now", branch, home_switch: switched, body: item.body }), full: true };
}

const TEST_LINE = /^Test:\s*/i;

function splitLines(values: string[] | undefined): string[] {
  return (values ?? []).map(unescapeText).flatMap((t) => t.split("\n")).map((t) => t.trim()).filter(Boolean);
}

export interface CheckOpts {
  test?: string[];
  checked?: string[];
  handoff?: string;
  fresh?: boolean;
}

/** Moves the now task to review: `checked` is what the agent ran, `test` is for a person to try. */
export function check(ctx: Ctx, store: Store, opts: CheckOpts): Result {
  const item = nowTask(store);
  if (!item) throw new WkError("Nothing is now. Start a task first: wk start <id>");
  const note = opts.handoff !== undefined ? handoffText(opts.handoff) : null;
  const given = splitLines(opts.test);
  const checked = splitLines(opts.checked);
  for (const c of checked) checkTitle(c, "A --checked line");
  const rest = item.body.split("\n").filter((l) => !TEST_LINE.test(l));
  let tests = item.body.split("\n").filter((l) => TEST_LINE.test(l)).map((l) => l.replace(TEST_LINE, ""));
  if (given.length) {
    tests = given;
    const body = [...tests.map((t) => `Test: ${t}`), ...(rest.some((l) => l.trim()) ? ["", ...rest] : [])].join("\n");
    item.body = checkLines(body, LIMITS.taskBody, "Task body with tests");
  }
  if (checked.length) item.data.checked = checked;
  else delete item.data.checked;
  item.data.state = "review";
  store.save(item);

  const lines = [`review ${item.id} ${item.title}`];
  lines.push(...tests.map((t) => `Test (you): ${t}`));
  lines.push(...checked.map((c) => `Checked: ${c}`));
  if (tests.length === 0 && checked.length === 0) {
    lines.push('Nothing checked or tested. Add --checked "<automated result>" and/or --test "<for a person>".');
  } else if (tests.length === 0) lines.push("Nothing for a person to try. Use Review: what changed, why, which files.");

  const diff = ctx.git ? diffSummary(ctx.base) : null;
  if (diff) {
    if (diff.files.length === 0) lines.push("No uncommitted changes.");
    else {
      const stat = diff.shortstat ? ` (${diff.shortstat.replace(/^\d+ files? changed, /, "")})` : "";
      lines.push(`Changed: ${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${stat}`);
      const shown = diff.files.slice(0, 3);
      lines.push(`  ${shown.join(", ")}${diff.files.length > shown.length ? `, +${diff.files.length - shown.length} more` : ""}`);
    }
  }
  for (const hook of hooks.onCheck) lines.push(...hook(ctx, store, item));
  const git = commitHint(ctx, "check");
  if (git) lines.push(git);
  if (note) writeHandoff(ctx, note, opts.fresh);
  writeSession(ctx, { ...readSession(ctx), freshFor: opts.fresh ? item.id : null });
  const then = `send the check-in, then wk done ${item.id} once the user confirms.`;
  lines.push(note ? `Handoff saved. Next: ${then}` : `Next: wk handoff (keeps a fresh session safe), ${then}`);
  return result(lines, { id: item.id, state: "review", tests, checked, git, handoff: note, changed: diff?.files ?? null });
}

/** Moves done area items older than a week to the archive, so lists stay short. */
export function archiveOld(ctx: Ctx, store: Store): Item[] {
  const old = store
    .list()
    .filter((i) => i.kind === "task" && state(i) === "done" && i.home.type === "area")
    .filter((i) => daysBetween(str(i, "done_on") || str(i, "updated"), ctx.today) > ARCHIVE_AFTER_DAYS);
  for (const i of old) store.archive(i, (str(i, "done_on") || ctx.today).slice(0, 4));
  return old;
}

export function done(ctx: Ctx, store: Store, raw: string, opts: { force?: boolean; handoff?: string; fresh?: boolean }): Result {
  const item = task(store, raw);
  const given = opts.handoff !== undefined ? handoffText(opts.handoff) : null;
  if (state(item) === "done") return result([`${item.id} is already done.`], { id: item.id, state: "done" });
  if (state(item) !== "review" && !opts.force) {
    throw new WkError(`${item.id} is ${state(item)}, not review. Run wk check first, or --force for trivial tasks.`);
  }
  item.data.state = "done";
  item.data.done_on = ctx.today;
  delete item.data.wait;
  delete item.data.wait_since;
  delete item.data.due;
  store.save(item);
  const git = commitHint(ctx, "done");

  const session = readSession(ctx);
  const finished = session.done.includes(item.id) ? session.done : [...session.done, item.id];
  const fresh = opts.fresh ?? session.freshFor === item.id;
  writeSession(ctx, { ...session, done: finished, freshFor: null });
  const advice = fresh
    ? "You recommended a fresh session: stop here."
    : finished.length >= FRESH_AFTER_TASKS
      ? `${finished.length} tasks done this session: suggest a fresh session unless the next task builds on this one.`
      : "Next task unrelated, or context heavy? Suggest a fresh session.";

  const lines = [`done  ${item.id} ${item.title}`];
  if (git) lines.push(git);
  for (const hook of hooks.onDone) lines.push(...hook(ctx, store, item));
  const archived = archiveOld(ctx, store);
  if (archived.length) lines.push(`Archived ${archived.length} old done item${archived.length === 1 ? "" : "s"}.`);
  const top = nextView(store, 1).queue[0];
  const note = given ?? `Done: ${item.id} ${item.title}.\nNext: ${top ? queueLine(top) : "nothing queued"}.`;
  writeHandoff(ctx, note, fresh);
  lines.push(`Handoff ${given ? "saved" : "written from the next task (pass --handoff for more)"}. ${advice}`);
  return result(lines, { id: item.id, state: "done", git, session_tasks: finished.length, handoff: note, archived: archived.map((i) => i.id) });
}

export function wait(ctx: Ctx, store: Store, raw: string, reason: string | undefined, opts: { clear?: boolean }): Result {
  const item = task(store, raw);
  if (opts.clear) {
    if (!isWaiting(item)) return result([`${item.id} isn't waiting.`], { id: item.id, wait: null });
    delete item.data.wait;
    delete item.data.wait_since;
    store.save(item);
    return result([`${item.id} ${item.title} is no longer waiting.`], { id: item.id, wait: null });
  }
  if (state(item) === "done") throw new WkError(`${item.id} is done.`);
  const why = checkLines((reason ?? "").trim(), 1, "Wait reason");
  if (!why) throw new WkError(`Say what it waits on: wk wait ${item.id} "<a decision, a person, another item>"`);
  item.data.wait = why;
  item.data.wait_since = ctx.today;
  if (state(item) === "now") item.data.state = "open";
  store.save(item);
  return result([`${item.id} ${item.title} waits on: ${why}`], { id: item.id, wait: why });
}

function handoffText(raw: string): string {
  const text = checkLines(unescapeText(raw ?? ""), LIMITS.handoff, "Handoff");
  if (!text) throw new WkError("Handoff is empty.");
  return text;
}

export function writeHandoff(ctx: Ctx, text: string, fresh = false): void {
  fs.writeFileSync(path.join(ctx.root, SESSION_FILE), (fresh ? `${FRESH_MARK}\n` : "") + text + "\n");
}

export function handoff(ctx: Ctx, _store: Store, raw: string, opts: { fresh?: boolean } = {}): Result {
  const text = handoffText(raw);
  writeHandoff(ctx, text, opts.fresh);
  const n = text.split("\n").length;
  return result([`Handoff saved (${n} line${n === 1 ? "" : "s"}).`], { handoff: text });
}
