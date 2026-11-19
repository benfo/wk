import { result, unescapeText, WkError, type Result } from "../../output.js";
import type { Ctx } from "../context.js";
import { checkLines, checkTitle, LIMITS } from "../limits.js";
import { byQueue, isDue, isOpen, isQueued, isWaiting, itemLine, state, tagLine, when } from "../model.js";
import { CORE_AREA, KINDS, str, tagsOf, type Item, type Kind, type Store } from "../store.js";
import { guardSimilar, openTasks, parseTags } from "./shared.js";

export function addTask(ctx: Ctx, store: Store, rawTitle: string, opts: { body?: string; tags?: string; force?: boolean }): Result {
  const title = checkTitle(rawTitle, "Task title");
  const body = checkLines(unescapeText(opts.body ?? ""), LIMITS.taskBody, "Task body");
  guardSimilar(title, openTasks(store), opts.force);
  const home = store.area(CORE_AREA);
  const item = store.create("task", home, title, body, {
    state: "open", when: "queue", tags: parseTags(opts.tags), rank: bottomRank(store),
  });
  return result([`Added ${item.id} ${title} (${home.name})`], { id: item.id, title, home: home.name, file: item.file });
}

/** A rank just below the last queued task, so a new task joins the bottom of the queue. */
export function bottomRank(store: Store): number {
  const ranks = store.list().filter(isQueued).map((i) => i.data.rank).filter((r): r is number => typeof r === "number");
  return ranks.length ? Math.floor(Math.max(...ranks)) + 1 : 1;
}

/** A rank just above the first queued task. */
export function topRank(store: Store): number {
  const ranks = store.list().filter(isQueued).map((i) => i.data.rank).filter((r): r is number => typeof r === "number");
  return ranks.length ? Math.floor(Math.min(...ranks)) - 1 : 1;
}

export function show(_ctx: Ctx, store: Store, raw: string): Result {
  const item = store.get(raw);
  const facts = [item.kind, str(item, "state"), str(item, "when"), item.home.name].filter(Boolean);
  if (item.archived) facts.push("archived");
  const lines = [`${item.id}  ${facts.join(" · ")}`, item.title];
  const tags = tagsOf(item);
  if (tags.length) lines.push(`tags: ${tags.join(", ")}`);
  for (const key of ["due", "wait", "from", "was", "ref"]) if (str(item, key)) lines.push(`${key}: ${str(item, key)}`);
  lines.push(`created ${str(item, "created")} · updated ${str(item, "updated")}`);
  if (item.body) lines.push("", ...item.body.split("\n"));
  return { lines, data: summary(item), full: true };
}

export function summary(item: Item) {
  return { ...item.data, title: item.title, body: item.body, home: item.home.name, archived: item.archived };
}

const KIND_WORDS: Record<string, Kind> = Object.fromEntries(KINDS.flatMap((k) => [[k, k], [`${k}s`, k]]));
const STATE_ORDER = ["now", "review", "open", "inbox", "done"];

/** One word of `wk ls`: true when it names the item's kind, state, when, home, tag or id. */
function matches(item: Item, word: string): boolean {
  if (KIND_WORDS[word]) return item.kind === KIND_WORDS[word];
  if (word === "due") return isDue(item);
  if (word === "waiting") return isWaiting(item);
  if (word === "queued") return isQueued(item);
  if (state(item) === word) return true;
  const w = when(item);
  if (w === word || w.startsWith(`${word}:`)) return true;
  if (item.home.name === word || (item.home.type === "project" && item.home.name.startsWith(word))) return true;
  if (tagsOf(item).includes(word.replace(/^#/, ""))) return true;
  return item.id === word;
}

/** Sooner first: queued, later, waiting on a trigger, someday. */
function whenOrder(item: Item): number {
  const w = when(item);
  if (w === "next" || w === "queue") return 0;
  if (w === "later") return 1;
  if (w === "someday") return 3;
  return 2;
}

function order(a: Item, b: Item): number {
  if (a.kind !== b.kind) return KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
  const s = STATE_ORDER.indexOf(state(a)) - STATE_ORDER.indexOf(state(b));
  if (s) return s;
  if (isQueued(a) !== isQueued(b)) return isQueued(a) ? -1 : 1;
  if (isDue(a) !== isDue(b)) return isDue(a) ? -1 : 1;
  const w = whenOrder(a) - whenOrder(b);
  return w || byQueue(a, b);
}

/** The left column: state once started, else when for tasks, else the kind. */
function column(item: Item): string {
  if (item.kind !== "task") return item.kind;
  const s = state(item);
  return s === "open" ? when(item).split(":")[0] : s;
}

export function ls(_ctx: Ctx, store: Store, rawWords: string[], opts: { archived?: boolean }): Result {
  const words = rawWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  const pool = opts.archived ? store.archived() : store.list();
  // No words: the open tasks, the list people ask for most.
  const picked = (words.length ? pool.filter((i) => words.every((w) => matches(i, w))) : pool.filter(isOpen)).sort(order);
  const lines = picked.map((i) => `${column(i).padEnd(7)} ${itemLine(i)} (${i.home.name})${tagLine(i)}`);
  if (lines.length === 0) lines.push(words.length ? `Nothing matches: ${words.join(" ")}` : "No open tasks.");
  return result(lines, picked.map(summary));
}

export function requireText(raw: string | undefined, what: string): string {
  const t = (raw ?? "").trim();
  if (!t) throw new WkError(`${what} is empty.`);
  return t;
}
