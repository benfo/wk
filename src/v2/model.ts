import { WkError } from "../output.js";
import { str, tagsOf, type Item } from "./store.js";

export const STATES = ["inbox", "open", "now", "review", "done"] as const;
export type State = (typeof STATES)[number];

/** Horizons: where an open task sits until someone picks it. */
export const HORIZONS = ["next", "queue", "later", "someday"] as const;
/** Triggers: an open task sleeps until its moment, then shows as due. */
export const TRIGGERS = ["after", "end", "start", "on"] as const;

export function state(item: Item): string {
  return str(item, "state");
}

export function when(item: Item): string {
  return str(item, "when");
}

export function isTask(item: Item): boolean {
  return item.kind === "task";
}

/** Not finished: inbox, open, now or review. */
export function isOpen(item: Item): boolean {
  return isTask(item) && state(item) !== "done";
}

export function isWaiting(item: Item): boolean {
  return str(item, "wait") !== "";
}

export function isDue(item: Item): boolean {
  return str(item, "due") !== "";
}

/** In the queue: open, horizon next or queue, not waiting. Due items join once moved. */
export function isQueued(item: Item): boolean {
  return isTask(item) && state(item) === "open" && ["next", "queue"].includes(when(item));
}

export function rank(item: Item): number {
  const r = item.data.rank;
  return typeof r === "number" ? r : Number.MAX_SAFE_INTEGER;
}

export function byQueue(a: Item, b: Item): number {
  return rank(a) - rank(b) || str(a, "created").localeCompare(str(b, "created")) || a.id.localeCompare(b.id);
}

/** The trigger kind of a `when`, or null for a horizon. */
export function triggerOf(w: string): { kind: (typeof TRIGGERS)[number]; arg: string } | null {
  const m = /^(after|end|start|on):(.+)$/.exec(w);
  return m ? { kind: m[1] as (typeof TRIGGERS)[number], arg: m[2] } : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks a `when` and normalises its argument through `resolve` (ids to full ids, area names).
 * Horizons pass through; triggers need a target.
 */
export function parseWhen(raw: string, resolve: { item: (id: string) => string; project: (id: string) => string; area: (name: string) => string }): string {
  const w = raw.trim().toLowerCase();
  if ((HORIZONS as readonly string[]).includes(w)) return w;
  const t = triggerOf(w);
  if (!t) {
    throw new WkError(`Unknown when "${raw}". Use next, queue, later, someday, after:<id>, end:<project>, start:<area> or on:<YYYY-MM-DD>.`);
  }
  switch (t.kind) {
    case "after":
      return `after:${resolve.item(t.arg)}`;
    case "end":
      return `end:${resolve.project(t.arg)}`;
    case "start":
      return `start:${resolve.area(t.arg)}`;
    case "on":
      if (!DATE.test(t.arg) || Number.isNaN(Date.parse(t.arg))) throw new WkError(`on: needs a date like 2026-12-01, not "${t.arg}".`);
      return `on:${t.arg}`;
  }
}

/** "r8vn Banner border shifts right [waiting: design] [due]" */
export function itemLine(item: Item): string {
  let line = `${item.id} ${item.title}`;
  if (isWaiting(item)) line += ` [waiting: ${str(item, "wait")}]`;
  if (isDue(item)) line += " [due]";
  return line;
}

/** A short label for an item's place: "core", "ui", or a project id with its title. */
export function tagLine(item: Item): string {
  const tags = tagsOf(item);
  return tags.length ? ` #${tags.join(" #")}` : "";
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
