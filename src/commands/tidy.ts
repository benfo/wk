import type { Ctx } from "../context.js";
import { checkLines, checkTitle, LIMITS } from "../limits.js";
import { result, unescapeText, WkError, type Result } from "../output.js";
import { isSimilar } from "../similar.js";
import { label, str, tags, text, type Item, type Store } from "../store.js";
import { openTasks, parseTags, requireEpic, status } from "./shared.js";

export const STALE_NEXT_DAYS = 30;
export const OLD_IDEA_DAYS = 60;
export const ARCHIVE_AFTER_DAYS = 7;

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function finishedEpics(store: Store): { epic: Item; total: number }[] {
  const tasks = store.list("task", { archived: "both" });
  return store
    .list("epic")
    .filter((e) => str(e, "status") !== "done")
    .map((epic) => ({ epic, mine: tasks.filter((t) => str(t, "epic") === epic.id) }))
    .filter(({ mine }) => mine.length > 0 && mine.every((t) => status(t) === "done"))
    .map(({ epic, mine }) => ({ epic, total: mine.length }));
}

function doneDate(item: Item): string {
  return str(item, "done_on") || str(item, "updated") || str(item, "created");
}

function archivable(ctx: Ctx, store: Store): Item[] {
  const old = (i: Item) => daysBetween(doneDate(i), ctx.today) > ARCHIVE_AFTER_DAYS;
  return [
    ...store.list("task").filter((t) => status(t) === "done" && old(t)),
    ...store.list("epic").filter((e) => str(e, "status") === "done" && old(e)),
  ];
}

function problems(ctx: Ctx, store: Store): string[] {
  const out: string[] = [];
  const pool = [...openTasks(store), ...store.list("idea")];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (isSimilar(text(pool[i]), text(pool[j]))) {
        out.push(`Duplicate? ${pool[i].id} ${label(pool[i])} / ${pool[j].id} ${label(pool[j])}`);
      }
    }
  }
  for (const t of store.list("task").filter((t) => status(t) === "next")) {
    const days = daysBetween(str(t, "updated") || str(t, "created"), ctx.today);
    if (days > STALE_NEXT_DAYS) out.push(`Stale: ${t.id} ${label(t)} untouched ${days} days`);
  }
  for (const idea of store.list("idea")) {
    const days = daysBetween(str(idea, "created"), ctx.today);
    if (days > OLD_IDEA_DAYS) out.push(`Old idea: ${idea.id} ${label(idea)} (${days} days)`);
  }
  for (const { epic, total } of finishedEpics(store)) {
    out.push(`Finished: ${epic.id} ${label(epic)}, all ${total} tasks done (tidy --fix closes it)`);
  }
  const epicIds = new Set(store.list("epic", { archived: "both" }).map((e) => e.id));
  for (const t of store.list("task")) {
    const epic = str(t, "epic");
    if (epic && !epicIds.has(epic)) out.push(`Missing epic: ${t.id} points at ${epic}`);
  }
  const old = archivable(ctx, store);
  if (old.length) out.push(`Archivable: ${old.length} done item${old.length === 1 ? "" : "s"} (tidy --fix)`);
  return out;
}

export function tidy(ctx: Ctx, store: Store, opts: { fix?: boolean }): Result {
  const fixed: string[] = [];
  if (opts.fix) {
    for (const { epic } of finishedEpics(store)) {
      epic.data.status = "done";
      epic.data.done_on = ctx.today;
      store.save(epic);
      fixed.push(`Closed ${epic.id} ${label(epic)}`);
    }
    const old = archivable(ctx, store);
    for (const item of old) store.archive(item);
    if (old.length) fixed.push(`Archived ${old.length}: ${old.map((i) => i.id).join(", ")}`);
  }
  const left = problems(ctx, store);
  const lines = [...fixed, ...left];
  if (lines.length === 0) lines.push("Plan is clean.");
  else if (left.length === 0) lines.push("Nothing else to tidy.");
  return result(lines, { fixed, problems: left });
}

function shorter(a: string, b: string): string {
  if (!a.trim()) return b;
  if (!b.trim()) return a;
  return b.length < a.length ? b : a;
}

export function merge(_ctx: Ctx, store: Store, rawKeep: string, rawDrop: string): Result {
  const keep = store.get(rawKeep, ["task", "idea"]);
  const drop = store.get(rawDrop, ["task", "idea"]);
  if (keep.id === drop.id) throw new WkError("Cannot merge an item into itself.");
  if (keep.kind === "idea" && drop.kind === "task") {
    throw new WkError(`Keep the task, drop the idea: wk merge ${drop.id} ${keep.id}`);
  }
  if (keep.archived || drop.archived) throw new WkError("Cannot merge archived items.");
  if (status(drop) === "now") throw new WkError(`${drop.id} is now. Keep it instead: wk merge ${drop.id} ${keep.id}`);

  if (keep.kind !== drop.kind) {
    // An idea folded into a task: the task keeps its own title and body.
    if (!str(keep, "epic") && str(drop, "epic")) keep.data.epic = str(drop, "epic");
  } else if (keep.kind === "task") {
    keep.data.title = shorter(str(keep, "title"), str(drop, "title"));
    const allTags = [...new Set([...tags(keep), ...tags(drop)])];
    keep.data.tags = allTags;
    if (!str(keep, "epic") && str(drop, "epic")) keep.data.epic = str(drop, "epic");
    if (drop.data.needs_decision === true) keep.data.needs_decision = true;
  } else if (!str(keep, "epic") && str(drop, "epic")) {
    keep.data.epic = str(drop, "epic");
  }
  if (keep.kind === drop.kind) keep.body = shorter(keep.body, drop.body);
  store.save(keep);
  store.remove(drop);
  return result([`Merged ${drop.id} into ${keep.id} ${label(keep)}`, `Deleted ${drop.id}`], {
    kept: keep.id,
    deleted: drop.id,
  });
}

export function supersede(_ctx: Ctx, store: Store, rawOld: string, rawNew: string): Result {
  const old = store.get(rawOld, "decision");
  const replacement = store.get(rawNew, "decision");
  if (old.id === replacement.id) throw new WkError("A decision cannot supersede itself.");
  if (str(old, "status") === "superseded") {
    throw new WkError(`${old.id} is already superseded by ${str(old, "superseded_by")}.`);
  }
  if (str(replacement, "status") === "superseded") throw new WkError(`${replacement.id} is itself superseded.`);
  old.data.status = "superseded";
  old.data.superseded_by = replacement.id;
  replacement.data.supersedes = old.id;
  store.save(old);
  store.save(replacement);
  return result([`${old.id} superseded by ${replacement.id} ${label(replacement)}`], {
    old: old.id,
    new: replacement.id,
  });
}

export interface EditOpts {
  title?: string;
  body?: string;
  tags?: string;
  epic?: string;
  needsDecision?: boolean;
}

export function edit(_ctx: Ctx, store: Store, rawId: string, opts: EditOpts): Result {
  const item = store.get(rawId);
  if (item.kind === "decision") {
    throw new WkError("Decisions are never edited. Record a new one and run: wk supersede <old> <new>");
  }
  if (item.archived) throw new WkError(`${item.id} is archived.`);
  const changes = ["title", "body", "tags", "epic", "needsDecision"].filter((k) => opts[k as keyof EditOpts] !== undefined);
  if (changes.length === 0) throw new WkError("Nothing to change. Use --title, --body, --tags, --epic or --needs-decision.");

  const note = item.kind === "idea" || item.kind === "learning";
  if (opts.title !== undefined) {
    if (note) throw new WkError(`${item.kind === "idea" ? "Ideas" : "Learnings"} have no title. Use --body.`);
    item.data.title = checkTitle(opts.title);
  }
  if (opts.body !== undefined) {
    const body = unescapeText(opts.body);
    if (item.kind === "task") item.body = checkLines(body, LIMITS.taskBody, "Task body");
    else if (note) {
      item.body = checkLines(body, LIMITS.note, item.kind === "idea" ? "Idea" : "Learning");
      if (!item.body) throw new WkError("Text is empty.");
    } else item.body = body;
  }
  if (opts.tags !== undefined) item.data.tags = parseTags(opts.tags);
  if (opts.epic !== undefined) {
    if (item.kind !== "task" && item.kind !== "idea") throw new WkError("Only tasks and ideas belong to an epic.");
    item.data.epic = opts.epic === "" || opts.epic === "none" ? null : requireEpic(store, opts.epic);
  }
  if (opts.needsDecision !== undefined) {
    if (item.kind !== "task") throw new WkError("Only tasks can need a decision.");
    item.data.needs_decision = opts.needsDecision;
  }
  store.save(item);
  return result([`Updated ${item.id} ${label(item)}`], { id: item.id, changed: changes });
}

