import { lastEvent } from "../../events.js";
import { byQueue, isDue, isQueued, isWaiting, state, triggerOf, when } from "../../model.js";
import type { Item } from "../../store.js";
import { projectTasks } from "../homes.js";
import { readHandoff } from "../views.js";
import type { Board } from "./data.js";
import { bar, clock, esc, group, key, meta, row, testsOf } from "./parts.js";

/** The Now tab: a glance beside your agent at what's happening, what needs you and what's next. */
export function nowView(b: Board): string {
  // A column with nothing to show drops out, so the other one moves left instead of leaving a hole.
  const cols = [queueList(b), projects(b) + activity(b)].filter(Boolean).map((c) => `<div>${c}</div>`).join("");
  return `<main class="view now">${hero(b)}${needsStrip(b)}<div class="cols">${cols}</div></main>`;
}

/** A long title steps down a size so the hero stays a headline, not a paragraph. */
const long = (t: Item) => (t.title.length > 70 ? ' class="long"' : "");

/** The task in progress (blue), or what comes next (neutral), beside the handoff. */
function hero(b: Board): string {
  const { now, heroItem, v } = b;
  const handoff = readHandoff(b.ctx);
  const handoffBlock = `<aside class="handoff"><h3>Handoff</h3><p>${handoff ? esc(handoff) : "None yet."}</p></aside>`;
  if (now) {
    const p = now.home.type === "project" ? b.openProjects.find((x) => x.id === now.home.name) : undefined;
    const prog = p ? projectTasks(b.store, p) : null;
    const body = now.body.split("\n").filter((l) => l.trim()).slice(0, 3).map((l) => `<li>${esc(l)}</li>`).join("");
    const started = lastEvent(b.events, now.id, "started");
    return `<section class="hero working" data-key="${key(now)}"><div><div class="eyebrow">In progress${started ? ` <span class="for">${clock(started.at, b.nowMs, "started ", " ago")}</span>` : ""}</div><h2${long(now)} title="id ${now.id}">${esc(now.title)}</h2>${meta(v, now)}
${body ? `<ul class="body">${body}</ul>` : ""}${prog ? bar(prog.done, prog.total, true) : ""}</div>${handoffBlock}</section>`;
  }
  const label = heroItem ? "Nothing in progress. Up next" : "Nothing in progress";
  return `<section class="hero idle"><div><div class="eyebrow">${label}</div><h2${heroItem ? `${long(heroItem)} title="id ${heroItem.id}"` : ""}>${heroItem ? esc(heroItem.title) : "Nothing in progress."}</h2>${heroItem ? meta(v, heroItem) : ""}</div>${handoffBlock}</section>`;
}

function inboxLine(b: Board): string {
  return b.inbox.length ? `<p class="aside">${b.inbox.length} in the inbox to sort, on the Plan tab.</p>` : "";
}

/** The amber strip: only when something asks you to act. The inbox is a quiet line. */
function needsStrip(b: Board): string {
  if (!b.needsYou) return "";
  const rows = [
    ...b.review.map((t) => {
      const since = lastEvent(b.events, t.id, "ready to try");
      const tryIt = testsOf(t)[0];
      return row(b.v, t, { kind: "Ready to try", note: tryIt ? `Try: ${tryIt}` : undefined, since: since ? `Waiting ${clock(since.at, b.nowMs, "for ")}` : undefined });
    }),
    ...b.due.map((t) => row(b.v, t, { kind: "Due", when: true })),
  ];
  return `<section class="needs"><h2>${b.needsYou} ${b.needsYou === 1 ? "needs" : "need"} you</h2><ul>${rows.join("")}</ul>${inboxLine(b)}</section>`;
}

/**
 * The queue in order. When the hero already shows the first queued task, this is what comes after it,
 * numbered on from 2; if that was the only one, the section steps aside.
 */
function queueList(b: Board): string {
  const inbox = b.needsYou ? "" : inboxLine(b);
  const rest = b.queue.filter((t) => t !== b.heroItem);
  if (b.heroItem && !rest.length) return inbox;
  const heading = b.heroItem ? "After that" : "Up next";
  const list = rest.length
    ? `<ul class="queue"${b.heroItem ? ' style="--from:1"' : ""}>${rest.map((t) => row(b.v, t)).join("")}</ul>`
    : '<p class="empty">Nothing queued.</p>';
  return `<section class="group"><h3>${heading}<span class="pill">${rest.length}</span></h3>${list}${inbox}</section>`;
}

/** Where a task stands, as a sort rank, a label and a tone. */
function status(b: Board, t: Item): [number, string, string] {
  const st = state(t);
  if (st === "now") return [0, "In progress", "st-now"];
  if (st === "review") return [1, "Ready to try", "st-attn"];
  if (isDue(t) && st === "open") return [2, "Due", "st-attn"];
  if (isQueued(t) && !isWaiting(t)) return [3, `Up next, ${b.queue.indexOf(t) + 1}`, ""];
  if (isWaiting(t)) return [4, "Waiting", ""];
  if (triggerOf(when(t))) return [5, "Sleeping", ""];
  return [6, when(t) || st, ""];
}

/** Each project with progress; it opens to its tasks, open ones in the order you'd meet them, done ones folded. */
function projects(b: Board): string {
  const rows = b.openProjects.map((p) => {
    const { tasks: own, done, total } = projectTasks(b.store, p);
    const open = own.filter((t) => state(t) !== "done").map((t) => [status(b, t), t] as const);
    open.sort((x, y) => x[0][0] - y[0][0] || (x[0][0] === 3 ? byQueue(x[1], y[1]) : 0));
    const closed = own.filter((t) => state(t) === "done");
    const list = open.map(([[, label, cls], t]) => `<li class="ptask" title="id ${t.id}"><span>${esc(t.title)}</span><span class="st ${cls}">${esc(label)}</span></li>`).join("");
    const doneList = closed.length
      ? `<details class="pdone"><summary>${closed.length} done</summary><ul>${closed.map((t) => `<li class="ptask" title="id ${t.id}"><span>${esc(t.title)}</span></li>`).join("")}</ul></details>`
      : "";
    return `<li data-key="${p.id}:${done}/${total}"><details class="project" data-id="${p.id}"><summary title="id ${p.id}"><div class="pname">${esc(p.title)}</div>${bar(done, total)}</summary><div class="ptasks">${list ? `<ul>${list}</ul>` : '<p class="empty">No open tasks.</p>'}${doneList}</div></details></li>`;
  });
  return group("Projects", rows, { count: b.openProjects.length });
}

/** The heartbeat: the last few changes, whoever made them. */
function activity(b: Board): string {
  const rows = b.events.slice(0, 3).map(
    (e) => `<li class="act" data-key="${esc(e.at + e.id + e.verb)}">${clock(e.at, b.nowMs, "", " ago")}<span class="verb">${esc(e.verb)}</span><span class="what">${esc(e.title)}</span></li>`,
  );
  return rows.length ? `<section class="group activity"><h3>Just happened</h3><ul>${rows.join("")}</ul></section>` : "";
}
