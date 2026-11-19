import { result, type Result } from "../../output.js";
import { isSimilar } from "../../similar.js";
import { writeConfig, type Ctx } from "../context.js";
import { daysBetween, isDue, isOpen, isQueued, isWaiting, state, when } from "../model.js";
import { CORE_AREA, str, type Item, type Store } from "../store.js";
import { inboxItems } from "./capture.js";
import { projectTasks } from "./homes.js";
import { activePrinciples } from "./knowledge.js";
import { plural } from "./shared.js";

export const REVIEW_EVERY_DAYS = 7;
export const STALE_DAYS = 30;
export const STALE_WAIT_DAYS = 7;
export const INBOX_NUDGE = 10;

/** Pairs of open tasks with near-identical titles. */
export function duplicates(store: Store): [Item, Item][] {
  const open = store.list().filter(isOpen);
  const out: [Item, Item][] = [];
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) if (isSimilar(open[i].title, open[j].title)) out.push([open[i], open[j]]);
  return out;
}

/** Everything a weekly review goes through, one line each, most urgent first. */
export function reviewLines(ctx: Ctx, store: Store): string[] {
  const out: string[] = [];
  const inbox = inboxItems(store);
  if (inbox.length) out.push(`Inbox: ${plural(inbox.length, "jot")} to sort: ${inbox.slice(0, 3).map((i) => `${i.id} ${i.title}`).join("; ")}`);
  for (const i of store.list().filter((t) => isDue(t) && state(t) === "open" && !isQueued(t))) out.push(`Due: ${i.id} ${i.title} (${when(i)})`);
  for (const i of store.list().filter((t) => isWaiting(t) && state(t) !== "done")) {
    const days = daysBetween(str(i, "wait_since") || str(i, "updated"), ctx.today);
    if (days > STALE_WAIT_DAYS) out.push(`Waiting ${days} days: ${i.id} ${i.title} on ${str(i, "wait")}`);
  }
  for (const i of store.list().filter((t) => t.kind === "task" && state(t) === "open" && ["later", "someday"].includes(when(t)))) {
    const days = daysBetween(str(i, "updated") || str(i, "created"), ctx.today);
    if (days > STALE_DAYS) out.push(`${when(i)} for ${days} days: ${i.id} ${i.title}. Queue, keep or drop?`);
  }
  for (const p of store.projects().filter((x) => x.data.state !== "done")) {
    const { tasks } = projectTasks(store, p);
    const open = tasks.filter((t) => state(t) !== "done");
    if (open.length === 0) out.push(`Project ${p.id} ${p.title} has nothing left: close it?`);
    else if (!open.some((t) => isQueued(t) || ["now", "review"].includes(state(t)))) out.push(`Project ${p.id} ${p.title} has nothing queued.`);
  }
  for (const a of store.areas().filter((x) => x !== CORE_AREA)) {
    const used = store.list().some((i) => i.home.name === a);
    if (used && activePrinciples(store, a).length === 0) out.push(`Area ${a} has no principles.`);
  }
  for (const r of store.list().filter((i) => i.kind === "principle" && !str(i, "superseded_by"))) {
    if (!str(r, "because") || !str(r, "instead")) out.push(`Principle ${r.id} ${r.title} lacks ${!str(r, "instead") ? "instead" : "because"}: would a model get it wrong without it?`);
  }
  for (const [a, b] of duplicates(store)) out.push(`Duplicate? ${a.id} ${a.title} / ${b.id} ${b.title}`);
  return out;
}

export function review(ctx: Ctx, store: Store, opts: { done?: boolean }): Result {
  if (opts.done) {
    ctx.config.reviewed = ctx.today;
    writeConfig(ctx.root, ctx.config);
    return result([`Review recorded (${ctx.today}).`], { reviewed: ctx.today });
  }
  const lines = reviewLines(ctx, store);
  if (lines.length === 0) lines.push("Nothing to review. Record it: wk review --done");
  else lines.push("Go through these with the user in short batches, then: wk review --done");
  return result(lines, { items: lines });
}

/** `wk brief`: nudge when a review is overdue or the inbox is piling up. */
export function briefReview(ctx: Ctx, store: Store): string[] {
  const inbox = inboxItems(store).length;
  if (inbox >= INBOX_NUDGE) return [`Review due: ${inbox} jots in the inbox (wk review, wk guide review).`];
  const last = ctx.config.reviewed;
  if (last) {
    const days = daysBetween(last, ctx.today);
    return days > REVIEW_EVERY_DAYS ? [`Review due: last one ${days} days ago (wk review, wk guide review).`] : [];
  }
  const oldest = store.list().map((i) => str(i, "created")).filter(Boolean).sort()[0];
  return oldest && daysBetween(oldest, ctx.today) > REVIEW_EVERY_DAYS ? ["Review due: none yet (wk review, wk guide review)."] : [];
}

/** `wk check`: the first problem, so the plan gets a little cleaner each task. */
export function checkTidy(_ctx: Ctx, store: Store): string[] {
  const d = duplicates(store)[0];
  return d ? [`Tidy: Duplicate? ${d[0].id} ${d[0].title} / ${d[1].id} ${d[1].title}`] : [];
}
