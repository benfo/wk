import type { Ctx } from "../context.js";
import { isOpen } from "../model.js";
import { str, type Item, type Store } from "../store.js";

function linksOf(item: Item): string[] {
  const v = item.data.links;
  return Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
}

/**
 * `wk start`: what else matters for this task: items noticed while working on it, items it links
 * to or that link to it, and its project's decisions.
 */
export function startRelated(_ctx: Ctx, store: Store, item: Item): string[] {
  const live = (i: Item) => i !== item && (i.kind !== "task" || isOpen(i)) && !str(i, "superseded_by");
  const hits = new Map<string, Item>();
  for (const i of store.list()) {
    if (!live(i)) continue;
    if (str(i, "from") === item.id || linksOf(i).includes(item.id) || linksOf(item).includes(i.id)) hits.set(i.id, i);
  }
  if (item.home.type === "project") {
    for (const d of store.list().filter((i) => i.kind === "decision" && i.home.name === item.home.name && live(i))) hits.set(d.id, d);
  }
  if (hits.size === 0) return [];
  const list = [...hits.values()];
  return ["", "Related:", ...list.slice(0, 5).map((i) => `  ${i.kind === "task" ? "" : `${i.kind} `}${i.id} ${i.title} (${i.home.name})`), ...(list.length > 5 ? [`  +${list.length - 5} more`] : [])];
}
