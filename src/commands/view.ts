import fs from "node:fs";
import path from "node:path";
import { describeGit } from "../config.js";
import type { Ctx } from "../context.js";
import { startSession } from "../session.js";
import { checkLines, LIMITS } from "../limits.js";
import { progressBar, result, unescapeText, WkError, type Result } from "../output.js";
import { KINDS, label, str, tags, type Item, type Kind, type Store } from "../store.js";
import { isBlocked, itemLine, needsDecision, nowTask, principlesDir, status, summary } from "./shared.js";

export const HANDOFF_FILE = "handoff.md";
export const PROJECT_FILE = "project.md";

export function readProject(ctx: Ctx): string {
  const file = path.join(ctx.root, PROJECT_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
}

/** Shows the project summary, or overwrites it when text is given. */
export function project(ctx: Ctx, _store: Store, raw: string | undefined): Result {
  if (raw === undefined) {
    const text = readProject(ctx);
    if (!text) return result(['No project summary yet. Write one: wk project "<what, who for, goal, out of scope, done when>"'], { project: null });
    return { lines: text.split("\n"), data: { project: text }, full: true };
  }
  const text = checkLines(unescapeText(raw), LIMITS.project, "Project summary");
  if (!text) throw new WkError("Project summary is empty.");
  fs.writeFileSync(path.join(ctx.root, PROJECT_FILE), text + "\n");
  const n = text.split("\n").length;
  return result([`Project summary saved (${n} line${n === 1 ? "" : "s"}).`], { project: text });
}

export function readHandoff(ctx: Ctx): string {
  const file = path.join(ctx.root, HANDOFF_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
}

/** "Git: no branches, commit after each task." or a prompt to ask when it isn't chosen. */
function gitLine(ctx: Ctx): string {
  const { branch, commit } = ctx.config.git;
  const line = `Git: ${describeGit(ctx.config.git)}.`;
  return branch === null || commit === null ? `${line} Ask before any branch or commit.` : line;
}

/** When the handoff was written, and whether a task or epic changed after it. */
export function handoffAge(ctx: Ctx, store: Store): { written: string | null; stale: boolean } {
  const file = path.join(ctx.root, HANDOFF_FILE);
  if (!fs.existsSync(file) || !readHandoff(ctx)) return { written: null, stale: false };
  const at = fs.statSync(file).mtimeMs;
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const written = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const items = [...store.list("task"), ...store.list("epic")];
  const stale = items.some((i) => fs.existsSync(i.file) && fs.statSync(i.file).mtimeMs > at);
  return { written, stale };
}

export interface NextView {
  now: Item | undefined;
  review: Item[];
  next: Item[];
  nextTotal: number;
  stuck: Item[];
}

export function nextView(store: Store, limit = 5): NextView {
  const tasks = store.list("task");
  const now = nowTask(store);
  const ready = tasks.filter((t) => status(t) === "next" && !isBlocked(t) && !needsDecision(t));
  const stuck = tasks.filter((t) => ["next", "now"].includes(status(t)) && (isBlocked(t) || needsDecision(t)) && t !== now);
  const review = tasks.filter((t) => status(t) === "review");
  return { now, review, next: ready.slice(0, limit), nextTotal: ready.length, stuck };
}

function nextLines(v: NextView): string[] {
  const lines: string[] = [];
  lines.push(v.now ? `now   ${itemLine(v.now)}` : "now   (nothing in progress)");
  for (const t of v.review) lines.push(`review ${itemLine(t)} (waiting for a human test)`);
  for (const t of v.next) lines.push(`next  ${itemLine(t)}`);
  if (v.nextTotal > v.next.length) lines.push(`      +${v.nextTotal - v.next.length} more next (wk ls --status next)`);
  for (const t of v.stuck) lines.push(`stuck ${itemLine(t)}`);
  if (!v.now && v.review.length === 0 && v.next.length === 0 && v.stuck.length === 0) lines.push("Nothing queued. Add work with: wk add task \"<title>\"");
  return lines;
}

function nextData(v: NextView) {
  return {
    now: v.now ? summary(v.now) : null,
    review: v.review.map(summary),
    next: v.next.map(summary),
    next_total: v.nextTotal,
    stuck: v.stuck.map(summary),
  };
}

export function next(_ctx: Ctx, store: Store): Result {
  const v = nextView(store);
  return result(nextLines(v), nextData(v));
}

/** True when no principle file has a single numbered rule. */
export function noPrinciples(ctx: Ctx): boolean {
  const dir = principlesDir(ctx);
  if (!fs.existsSync(dir)) return true;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .every((f) => readRules(path.join(dir, f)).length === 0);
}

export function brief(ctx: Ctx, store: Store): Result {
  startSession(ctx);
  const handoff = readHandoff(ctx);
  const v = nextView(store, 3);
  const lines: string[] = [];
  // The principles notice goes first so the line cap can never hide it.
  const empty = noPrinciples(ctx);
  const emptyPlan = (["epic", "task", "idea", "decision", "learning"] as Kind[]).every(
    (k) => store.list(k, { archived: "both" }).length === 0,
  );
  if (emptyPlan) lines.push("Empty plan. Offer onboarding (wk guide onboarding).");
  const about = readProject(ctx);
  lines.push(about ? `Project: ${about.split("\n")[0]}` : "No project summary yet.");
  if (empty) lines.push("No principles yet.");
  // Early in the output, so the line cap never hides the workflow from a fresh session.
  const git = ctx.git ? gitLine(ctx) : null;
  if (git) lines.push(git);
  const age = handoffAge(ctx, store);
  if (handoff) {
    const note = age.stale ? `${age.written}, older than the latest task change` : age.written;
    lines.push(`Handoff (${note}):`, ...handoff.split("\n").map((l) => `  ${l}`));
  } else lines.push("Handoff: none yet.");
  lines.push(...nextLines(v));
  return result(lines, { project: about || null, handoff: handoff || null, ...nextData(v), no_principles: empty, empty_plan: emptyPlan, handoff_written: age.written, handoff_stale: age.stale, git: ctx.git ? ctx.config.git : null });
}

export function show(_ctx: Ctx, store: Store, rawId: string): Result {
  const item = store.get(rawId);
  const lines: string[] = [`${item.id} ${label(item)}${item.archived ? " (archived)" : ""}`];
  const skip = new Set(["id", "title"]);
  const meta: string[] = [];
  for (const [k, v] of Object.entries(item.data)) {
    if (skip.has(k) || v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (v === false) continue;
    meta.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  }
  if (meta.length) lines.push(meta.join(" | "));
  if (item.body) lines.push("", ...item.body.split("\n"));
  return { lines, data: summary(item), full: true };
}

const LS_KINDS: Record<string, Kind> = {
  tasks: "task", task: "task", ideas: "idea", idea: "idea", decisions: "decision", decision: "decision",
  epics: "epic", epic: "epic", learnings: "learning", learning: "learning",
};

export interface LsOpts {
  epic?: string;
  tag?: string;
  status?: string;
  archived?: boolean;
}

export function ls(_ctx: Ctx, store: Store, rawKind: string | undefined, opts: LsOpts): Result {
  const kind = LS_KINDS[(rawKind ?? "tasks").toLowerCase()];
  if (!kind) throw new WkError(`Unknown list "${rawKind}". Use: ${Object.values(KINDS).map((k) => k.dir).join(", ")}`);
  let items = store.list(kind, { archived: opts.archived === true });
  if (opts.epic) {
    const epic = store.get(opts.epic, "epic").id;
    items = items.filter((i) => str(i, "epic") === epic);
  }
  if (opts.tag) {
    const tag = opts.tag.toLowerCase();
    items = items.filter((i) => tags(i).includes(tag));
  }
  if (opts.status) items = items.filter((i) => str(i, "status") === opts.status);
  const lines = items.map((i) => {
    const s = str(i, "status");
    return s ? `${s.padEnd(6)} ${itemLine(i)}` : itemLine(i);
  });
  if (lines.length === 0) lines.push(`No ${KINDS[kind].dir} match.`);
  return result(lines, items.map(summary));
}

interface EpicProgress {
  epic: Item;
  done: number;
  total: number;
  tasks: Item[];
}

function epicProgress(store: Store, epic: Item): EpicProgress {
  const all = store.list("task", { archived: "both" }).filter((t) => str(t, "epic") === epic.id);
  return { epic, done: all.filter((t) => status(t) === "done").length, total: all.length, tasks: all };
}

const ORDER = ["now", "review", "next", "later", "done"];

export function statusView(_ctx: Ctx, store: Store, opts: { epic?: string }): Result {
  if (opts.epic) {
    const epic = store.get(opts.epic, "epic");
    const p = epicProgress(store, epic);
    const tasks = [...p.tasks].sort((a, b) => ORDER.indexOf(status(a)) - ORDER.indexOf(status(b)));
    const lines = [`${epic.id} ${label(epic)}  ${progressBar(p.done, p.total)}  ${p.done}/${p.total}`];
    for (const t of tasks) lines.push(`  ${status(t).padEnd(5)} ${itemLine(t)}`);
    return result(lines, { epic: summary(epic), done: p.done, total: p.total, tasks: tasks.map(summary) });
  }

  const epics = store.list("epic").filter((e) => str(e, "status") !== "done");
  const progress = epics.map((e) => epicProgress(store, e));
  const width = Math.max(0, ...epics.map((e) => `${e.id} ${label(e)}`.length));
  const lines: string[] = [];
  const shown = (t: Item) => ["now", "review", "next"].includes(status(t));
  for (const p of progress) {
    const head = `${p.epic.id} ${label(p.epic)}`.padEnd(width);
    lines.push(`${head}  ${progressBar(p.done, p.total)}  ${p.done}/${p.total}`);
    const active = p.tasks.filter((t) => !t.archived && shown(t));
    active.sort((a, b) => ORDER.indexOf(status(a)) - ORDER.indexOf(status(b)));
    for (const t of active) lines.push(`  ${status(t).padEnd(5)} ${itemLine(t)}`);
  }
  const loose = store.list("task").filter((t) => !str(t, "epic") && shown(t));
  if (loose.length) {
    lines.push("No epic");
    for (const t of loose) lines.push(`  ${status(t).padEnd(5)} ${itemLine(t)}`);
  }
  const later = store.list("task").filter((t) => status(t) === "later").length;
  const ideas = store.list("idea").length;
  lines.push(`later   ${later} task${later === 1 ? "" : "s"}, ${ideas} idea${ideas === 1 ? "" : "s"}`);
  return result(lines, {
    epics: progress.map((p) => ({ id: p.epic.id, title: label(p.epic), done: p.done, total: p.total })),
    later_tasks: later,
    ideas,
  });
}

const RULE = /^\s*\d+[.)]\s+\S/;

function readRules(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => RULE.test(l))
    .map((l) => l.trim());
}

export function principles(ctx: Ctx, _store: Store, opts: { tags?: string }): Result {
  const dir = principlesDir(ctx);
  const wanted = (opts.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
    const counts = files.map((f) => `${path.basename(f, ".md")} (${readRules(path.join(dir, f)).length})`);
    return result([`Tags: ${counts.join(", ") || "none"}`, "Use: wk principles --tags <tag,tag>"], {
      tags: files.map((f) => path.basename(f, ".md")),
    });
  }
  const lines: string[] = [];
  const data: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const tag of wanted) {
    const file = path.join(dir, `${tag}.md`);
    const rules = readRules(file);
    data[tag] = rules;
    if (rules.length === 0) {
      missing.push(tag);
      continue;
    }
    lines.push(`${tag}:`, ...rules.map((r) => `  ${r}`));
  }
  for (const tag of missing) lines.push(`No ${tag} principles yet (${path.join(dir, `${tag}.md`)}).`);
  return result(lines, { rules: data, missing });
}
