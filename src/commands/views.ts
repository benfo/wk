import fs from "node:fs";
import path from "node:path";
import { result, type Result } from "../output.js";
import type { Ctx, Workflow } from "../context.js";
import { byQueue, isDue, isQueued, isWaiting, itemLine, state } from "../model.js";
import { startSession } from "../session.js";
import type { Item, Store } from "../store.js";
import { readSummary } from "./homes.js";
import { SESSION_FILE } from "./init.js";
import { summary } from "./items.js";

const FRESH_MARK = "<!-- fresh session -->";

export interface NextView {
  now: Item | undefined;
  review: Item[];
  queue: Item[];
  queueTotal: number;
  due: Item[];
  waiting: Item[];
}

export function nextView(store: Store, limit = 5): NextView {
  const tasks = store.list().filter((i) => i.kind === "task");
  const ready = tasks.filter((t) => isQueued(t) && !isWaiting(t)).sort(byQueue);
  return {
    now: tasks.find((t) => state(t) === "now"),
    review: tasks.filter((t) => state(t) === "review"),
    queue: ready.slice(0, limit),
    queueTotal: ready.length,
    due: tasks.filter((t) => isDue(t) && state(t) === "open" && !isQueued(t)),
    waiting: tasks.filter((t) => isWaiting(t) && state(t) !== "done"),
  };
}

/** "r8vn Fix the banner (ui)" */
export function queueLine(item: Item): string {
  return `${itemLine(item)} (${item.home.name})`;
}

function nextLines(v: NextView): string[] {
  const lines: string[] = [];
  lines.push(v.now ? `now    ${queueLine(v.now)}` : "now    (nothing in progress)");
  for (const t of v.review) lines.push(`review ${queueLine(t)} (waiting for the user)`);
  for (const t of v.queue) lines.push(`next   ${queueLine(t)}`);
  if (v.queueTotal > v.queue.length) lines.push(`       +${v.queueTotal - v.queue.length} more queued (wk ls queued)`);
  for (const t of v.due) lines.push(`due    ${queueLine(t)}`);
  for (const t of v.waiting) lines.push(`wait   ${queueLine(t)}`);
  if (!v.now && !v.review.length && !v.queue.length && !v.due.length && !v.waiting.length) {
    lines.push('Nothing queued. Add work with: wk add "<title>"');
  }
  return lines;
}

function nextData(v: NextView) {
  return {
    now: v.now ? summary(v.now) : null,
    review: v.review.map(summary),
    queue: v.queue.map(summary),
    queue_total: v.queueTotal,
    due: v.due.map(summary),
    waiting: v.waiting.map(summary),
  };
}

export function next(_ctx: Ctx, store: Store): Result {
  const v = nextView(store);
  return result(nextLines(v), nextData(v));
}

function readHandoffFile(ctx: Ctx): string {
  const file = path.join(ctx.root, SESSION_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim() : "";
}

export function readHandoff(ctx: Ctx): string {
  return readHandoffFile(ctx).replace(FRESH_MARK, "").trim();
}

function describeGit(git: Workflow["git"]): string {
  const branch = git.branch === null ? "branching not chosen" : git.branch === "none" ? "no branches" : `a branch per ${git.branch}`;
  const commit =
    git.commit === null ? "commits not chosen" : git.commit === "ask" ? "ask before each commit" : git.commit === "task" ? "commit after each task" : "commit at each check";
  return `${branch}, ${commit}`;
}

/** One line a fresh session reads before touching git or running checks. */
export function workflowLine(ctx: Ctx): string | null {
  const wf = ctx.config.workflow;
  const parts: string[] = [];
  if (ctx.git) {
    parts.push(describeGit(wf.git));
    if (wf.commit_style) parts.push(`commits: ${wf.commit_style}`);
  }
  if (wf.checks.quick) parts.push(`quick checks: ${wf.checks.quick}`);
  if (wf.checks.full) parts.push(`full checks: ${wf.checks.full}`);
  if (wf.tracker) parts.push(`tracker: ${wf.tracker}`);
  if (parts.length === 0) return null;
  const unchosen = ctx.git && (wf.git.branch === null || wf.git.commit === null);
  return `Workflow: ${parts.join("; ")}.${unchosen ? " Ask before any branch or commit." : ""}`;
}

/** When the handoff was written, and whether an item changed after it. */
function handoffAge(ctx: Ctx, store: Store): { written: string | null; stale: boolean } {
  const file = path.join(ctx.root, SESSION_FILE);
  if (!fs.existsSync(file) || !readHandoff(ctx)) return { written: null, stale: false };
  const at = fs.statSync(file).mtimeMs;
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const written = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const stale = store.list().some((i) => i.kind === "task" && fs.existsSync(i.file) && fs.statSync(i.file).mtimeMs > at);
  return { written, stale };
}

/** Cues later features add to `wk brief`: due items, inbox, review, drift, principles. */
export const briefHooks: ((ctx: Ctx, store: Store) => string[])[] = [];

export function brief(ctx: Ctx, store: Store): Result {
  startSession(ctx);
  const lines: string[] = [];
  const empty = store.list().length === 0 && store.projects().length === 0 && store.archived().length === 0;
  if (empty) lines.push("Empty plan. Offer setup (wk guide setup).");
  const about = readSummary(ctx);
  lines.push(about ? `Summary: ${about.split("\n")[0]}` : "No summary yet.");
  // Cues go early, so the line cap never hides them.
  for (const hook of briefHooks) lines.push(...hook(ctx, store));
  const wf = workflowLine(ctx);
  if (wf) lines.push(wf);
  const handoff = readHandoff(ctx);
  const age = handoffAge(ctx, store);
  if (handoff) {
    const fresh = readHandoffFile(ctx).startsWith(FRESH_MARK) ? ", fresh session recommended" : "";
    const when = (age.stale ? `${age.written}, older than the latest task change` : age.written) + fresh;
    lines.push(`Handoff (${when}):`, ...handoff.split("\n").map((l) => `  ${l}`));
  } else lines.push("Handoff: none yet.");
  const v = nextView(store, 3);
  lines.push(...nextLines(v));
  return result(lines, { summary: about || null, handoff: handoff || null, ...nextData(v), empty_plan: empty, workflow: ctx.config.workflow });
}
