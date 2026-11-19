import type { Ctx } from "../context.js";
import { isDue, state, triggerOf, when } from "../model.js";
import { str, type Item, type Store } from "../store.js";
import { principleAreas } from "./principles.js";

type Match = (kind: string, arg: string) => boolean;

/**
 * Marks sleeping tasks whose trigger matches as due. A due task shows up until someone moves,
 * queues or drops it; nothing jumps into the queue on its own.
 */
export function fire(ctx: Ctx, store: Store, match: Match): Item[] {
  const fired: Item[] = [];
  for (const item of store.list()) {
    if (item.kind !== "task" || state(item) !== "open" || isDue(item)) continue;
    const t = triggerOf(when(item));
    if (t && match(t.kind, t.arg)) {
      item.data.due = ctx.today;
      store.save(item);
      fired.push(item);
    }
  }
  return fired;
}

export function dueLines(fired: Item[], why: string): string[] {
  if (fired.length === 0) return [];
  return [`Due now (${why}):`, ...fired.slice(0, 5).map((i) => `  ${i.id} ${i.title} (${i.home.name})`), ...(fired.length > 5 ? [`  +${fired.length - 5} more (wk ls due)`] : [])];
}

/** `wk done`: tasks waiting on this one wake up. */
export function doneTriggers(ctx: Ctx, store: Store, item: Item): string[] {
  return dueLines(fire(ctx, store, (k, arg) => k === "after" && arg === item.id), `after ${item.id}`);
}

/** `wk start`: work is beginning in these areas, so their start: items wake up. */
export function startTriggers(ctx: Ctx, store: Store, item: Item): string[] {
  const areas = principleAreas(store, item);
  const fired = fire(ctx, store, (k, arg) => k === "start" && areas.includes(arg));
  return fired.length ? ["", ...dueLines(fired, `work starts in ${areas.filter((a) => fired.some((f) => when(f) === `start:${a}`)).join(", ")}`)] : [];
}

/** `wk brief`: dated items whose day has come, then everything due. */
export function briefDue(ctx: Ctx, store: Store): string[] {
  fire(ctx, store, (k, arg) => k === "on" && arg <= ctx.today);
  const due = store.list().filter((i) => i.kind === "task" && state(i) === "open" && isDue(i));
  if (due.length === 0) return [];
  const shown = due.slice(0, 3).map((i) => `${i.id} ${i.title} (${str(i, "when")})`).join("; ");
  return [`Due: ${shown}${due.length > 3 ? `; +${due.length - 3} more` : ""}. Queue, reschedule or drop each.`];
}
