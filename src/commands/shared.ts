import { WkError } from "../output.js";
import { isSimilar } from "../similar.js";
import { isOpen } from "../model.js";
import type { Item, Store } from "../store.js";

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))];
}

/** Stops with "Similar: …" when a title is close to an open task. */
export function guardSimilar(title: string, pool: Item[], force: boolean | undefined): void {
  if (force) return;
  const hits = pool.filter((i) => isSimilar(title, i.title));
  if (hits.length === 0) return;
  const lines = hits.slice(0, 3).map((h) => `Similar: ${h.id} ${h.title}`);
  lines.push("Update or merge the existing item, or rerun with --force.");
  throw new WkError(lines.join("\n"));
}

export function openTasks(store: Store): Item[] {
  return store.list().filter(isOpen);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
