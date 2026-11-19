import { result, unescapeText, WkError, type Result } from "../../output.js";
import { isSimilar } from "../../similar.js";
import type { Ctx } from "../context.js";
import { checkLines, checkTitle, LIMITS } from "../limits.js";
import { isQueued, state } from "../model.js";
import { CORE_AREA, str, tagsOf, type Home, type Item, type Store } from "../store.js";
import { applyWhen, summary } from "./items.js";
import { parseTags } from "./shared.js";

/** Where knowledge lands by default: the now task's home, else core. */
export function currentHome(store: Store): Home {
  const now = store.list().find((i) => i.kind === "task" && state(i) === "now");
  if (now && now.home.type !== "inbox") return now.home;
  return store.area(CORE_AREA);
}

function homeFor(store: Store, raw: string | undefined): Home {
  const home = raw ? store.resolveHome(raw) : currentHome(store);
  if (home.type === "inbox") throw new WkError("The inbox is for unsorted jots.");
  return home;
}

/** Splits up to two lines of text into a title line and a body line. */
export function noteParts(raw: string, what: string): { title: string; body: string } {
  const text = checkLines(unescapeText(raw), LIMITS.note, what);
  if (!text) throw new WkError(`${what} is empty.`);
  const [first, ...rest] = text.split("\n");
  return { title: checkTitle(first, `${what}'s first line`), body: rest.join("\n") };
}

export function decide(_ctx: Ctx, store: Store, rawWhat: string, opts: { why?: string; rejected?: string; in?: string }): Result {
  const title = checkTitle(rawWhat, "Decision title");
  if (!opts.why?.trim()) throw new WkError('A decision needs a reason: --why "<why>"');
  const why = checkLines(unescapeText(opts.why), LIMITS.decisionWhy, "Why");
  const rejected = checkLines(unescapeText(opts.rejected ?? ""), LIMITS.decisionRejected, "Rejected");
  const body = [`Why: ${why.replace(/\n/g, "\n  ")}`, ...(rejected ? [`Rejected: ${rejected}`] : [])].join("\n");
  const home = homeFor(store, opts.in);
  const item = store.create("decision", home, title, body, {});
  return result([`Decision ${item.id} ${title} (${home.name})`], summary(item));
}

export function learn(_ctx: Ctx, store: Store, raw: string, opts: { in?: string }): Result {
  const { title, body } = noteParts(raw, "Learning");
  const home = homeFor(store, opts.in);
  const item = store.create("learning", home, title, body, {});
  return result([`Learning ${item.id} ${title} (${home.name})`], summary(item));
}

export function activePrinciples(store: Store, area: string): Item[] {
  return store.list().filter((i) => i.kind === "principle" && i.home.name === area && !str(i, "superseded_by"));
}

export interface PrincipleOpts {
  instead?: string;
  because?: string;
  in?: string;
  from?: string;
  test?: string;
}

/**
 * A principle earns its place only when a capable model would otherwise get it wrong, so it
 * names the default it overrides (instead) and the reason (because).
 */
export function principle(_ctx: Ctx, store: Store, rawRule: string, opts: PrincipleOpts): Result {
  const title = checkTitle(rawRule, "Principle");
  const instead = checkLines(unescapeText(opts.instead ?? ""), 1, "Instead");
  const because = checkLines(unescapeText(opts.because ?? ""), LIMITS.principleBecause, "Because");
  if (!instead) throw new WkError('Name the default it overrides: --instead "<what a model would do otherwise>". If there is none, it isn\'t a principle.');
  if (!because) throw new WkError('Say why: --because "<reason>"');
  const home = opts.in ? store.resolveHome(opts.in) : store.area(CORE_AREA);
  if (home.type !== "area") throw new WkError("Principles live in areas (core for everything).");
  const active = activePrinciples(store, home.name);
  if (active.length >= LIMITS.principlesPerArea) {
    throw new WkError(`${home.name} has ${active.length} principles, the limit. Supersede or drop one first.`);
  }
  const dup = active.find((p) => isSimilar(title, p.title));
  if (dup) throw new WkError(`Similar: ${dup.id} ${dup.title}\nEdit or supersede it instead.`);
  const source = opts.from ? store.get(opts.from) : undefined;
  if (source && !["learning", "decision"].includes(source.kind)) throw new WkError(`--from takes a learning or decision; ${source.id} is a ${source.kind}.`);
  const data: Record<string, string> = { instead, because };
  if (opts.test) data.test = opts.test.trim();
  if (source) data.from = source.id;
  const item = store.create("principle", home, title, "", data);
  if (source) {
    source.data.distilled_into = item.id;
    store.save(source);
  }
  return result([`Principle ${item.id} ${title} (${home.name})`], summary(item));
}

export function supersede(_ctx: Ctx, store: Store, rawOld: string, rawNew: string): Result {
  const old = store.get(rawOld);
  const replacement = store.get(rawNew);
  if (!["decision", "principle"].includes(old.kind)) throw new WkError("Only decisions and principles are superseded.");
  if (old.kind !== replacement.kind) throw new WkError(`${old.id} is a ${old.kind}; ${replacement.id} is a ${replacement.kind}.`);
  if (old.id === replacement.id) throw new WkError("An item can't supersede itself.");
  if (str(old, "superseded_by")) throw new WkError(`${old.id} is already superseded by ${str(old, "superseded_by")}.`);
  if (str(replacement, "superseded_by")) throw new WkError(`${replacement.id} is itself superseded.`);
  old.data.superseded_by = replacement.id;
  replacement.data.supersedes = old.id;
  store.save(old);
  store.save(replacement);
  return result([`${old.id} superseded by ${replacement.id} ${replacement.title}`], { old: old.id, new: replacement.id });
}

export interface EditOpts {
  title?: string;
  body?: string;
  tags?: string;
  instead?: string;
  because?: string;
  ref?: string;
}

export function edit(_ctx: Ctx, store: Store, raw: string, opts: EditOpts): Result {
  const item = store.get(raw);
  if (item.kind === "decision") throw new WkError("Decisions are never edited. Record a new one and run: wk supersede <old> <new>");
  if (item.archived) throw new WkError(`${item.id} is archived.`);
  const changes = (Object.keys(opts) as (keyof EditOpts)[]).filter((k) => opts[k] !== undefined);
  if (changes.length === 0) throw new WkError("Nothing to change. Use --title, --body, --tags, --instead, --because or --ref.");
  if (opts.title !== undefined) item.title = checkTitle(opts.title, `${item.kind[0].toUpperCase()}${item.kind.slice(1)} title`);
  if (opts.body !== undefined) {
    const max = item.kind === "task" ? LIMITS.taskBody : item.kind === "learning" ? LIMITS.note - 1 : LIMITS.taskBody;
    item.body = checkLines(unescapeText(opts.body), max, `${item.kind} body`);
  }
  if (opts.tags !== undefined) item.data.tags = parseTags(opts.tags);
  if (opts.instead !== undefined || opts.because !== undefined) {
    if (item.kind !== "principle") throw new WkError("Only principles have --instead and --because.");
    if (opts.instead !== undefined) item.data.instead = checkLines(unescapeText(opts.instead), 1, "Instead");
    if (opts.because !== undefined) item.data.because = checkLines(unescapeText(opts.because), LIMITS.principleBecause, "Because");
  }
  if (opts.ref !== undefined) item.data.ref = opts.ref.trim() || null;
  store.save(item);
  return result([`Updated ${item.id} ${item.title}`], { id: item.id, changed: changes, file: item.file });
}

export function drop(_ctx: Ctx, store: Store, raw: string): Result {
  const item = store.get(raw);
  if (item.archived) throw new WkError(`${item.id} is archived.`);
  if (["decision", "principle"].includes(item.kind)) throw new WkError(`${item.kind}s are superseded, not dropped: wk supersede <old> <new>`);
  if (state(item) === "now") throw new WkError(`${item.id} is now. Check or wait it first.`);
  if (state(item) === "done") throw new WkError(`${item.id} is already done.`);
  store.remove(item);
  return result([`Dropped ${item.id} ${item.title}`], { deleted: item.id });
}

function shorter(a: string, b: string): string {
  if (!a.trim()) return b;
  if (!b.trim()) return a;
  return b.length < a.length ? b : a;
}

/** Folds one item into another of the same kind and deletes the duplicate. */
export function merge(_ctx: Ctx, store: Store, rawKeep: string, rawDrop: string): Result {
  const keep = store.get(rawKeep);
  const gone = store.get(rawDrop);
  if (keep.id === gone.id) throw new WkError("Can't merge an item into itself.");
  if (keep.kind !== gone.kind) throw new WkError(`${keep.id} is a ${keep.kind}; ${gone.id} is a ${gone.kind}. Merge items of one kind.`);
  if (["decision", "principle"].includes(keep.kind)) throw new WkError(`${keep.kind}s are superseded, not merged.`);
  if (keep.archived || gone.archived) throw new WkError("Can't merge archived items.");
  if (state(gone) === "now") throw new WkError(`${gone.id} is now. Keep it instead: wk merge ${gone.id} ${keep.id}`);
  keep.title = shorter(keep.title, gone.title);
  keep.body = shorter(keep.body, gone.body);
  keep.data.tags = [...new Set([...tagsOf(keep), ...tagsOf(gone)])];
  // A someday idea merged into a queued task leaves the task's timing alone; the reverse queues it.
  if (keep.kind === "task" && !isQueued(keep) && isQueued(gone)) applyWhen(store, keep, "queue");
  store.save(keep);
  store.remove(gone);
  return result([`Merged ${gone.id} into ${keep.id} ${keep.title}`, `Deleted ${gone.id}`], { kept: keep.id, deleted: gone.id });
}
