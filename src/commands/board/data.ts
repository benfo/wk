import { nowIso, type Ctx } from "../../context.js";
import { readEvents, type PlanEvent } from "../../events.js";
import { byQueue, daysBetween, isDue, isQueued, isWaiting, state, triggerOf, when } from "../../model.js";
import { str, type Item, type Project, type Store } from "../../store.js";
import type { View } from "./parts.js";

const RECENT_DAYS = 7;

/** Everything the board shows, sorted into the lists each view reads. */
export interface Board {
  ctx: Ctx;
  store: Store;
  v: View;
  all: Item[];
  tasks: Item[];
  openProjects: Project[];
  /** The task in progress, if any. */
  now?: Item;
  /** With nothing in progress, the hero shows the first queued task, which then leaves the queue list. */
  heroItem?: Item;
  review: Item[];
  due: Item[];
  inbox: Item[];
  queue: Item[];
  waiting: Item[];
  sleeping: Item[];
  later: Item[];
  someday: Item[];
  recent: Item[];
  events: PlanEvent[];
  nowMs: number;
  /** Only what asks you to act now counts; the inbox can wait for a sort. */
  needsYou: number;
}

export function collect(ctx: Ctx, store: Store): Board {
  const projects = store.projects();
  const all = store.list();
  const tasks = all.filter((i) => i.kind === "task");
  const now = tasks.find((t) => state(t) === "now");
  const review = tasks.filter((t) => state(t) === "review");
  const due = tasks.filter((t) => isDue(t) && state(t) === "open" && !isQueued(t));
  const queue = tasks.filter((t) => isQueued(t) && !isWaiting(t)).sort(byQueue);
  const resting = tasks.filter((t) => state(t) === "open" && !isQueued(t) && !isDue(t) && !isWaiting(t));
  return {
    ctx,
    store,
    v: {
      homeNames: Object.fromEntries(projects.map((p) => [p.id, p.title])),
      hues: Object.fromEntries(projects.map((p, i) => [p.id, i])),
    },
    all,
    tasks,
    openProjects: projects.filter((p) => p.data.state !== "done"),
    now,
    heroItem: now ? undefined : queue[0],
    review,
    due,
    inbox: tasks.filter((t) => state(t) === "inbox"),
    queue,
    waiting: tasks.filter((t) => isWaiting(t) && state(t) !== "done"),
    sleeping: resting.filter((t) => triggerOf(when(t))),
    later: resting.filter((t) => when(t) === "later"),
    someday: resting.filter((t) => when(t) === "someday"),
    recent: tasks
      .filter((t) => state(t) === "done" && daysBetween(str(t, "done_on") || str(t, "updated"), ctx.today) <= RECENT_DAYS)
      .sort((a, b) => str(b, "done_on").localeCompare(str(a, "done_on"))),
    events: readEvents(ctx, 200),
    nowMs: Date.parse(nowIso()),
    needsYou: review.length + due.length,
  };
}
