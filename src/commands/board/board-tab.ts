import { lastEvent } from "../../events.js";
import { byQueue, state, when } from "../../model.js";
import { str, type Item } from "../../store.js";
import { projectTasks } from "../homes.js";
import { readHandoff } from "../views.js";
import type { Board } from "./data.js";
import { capped, chip, clock, esc, group, hue, icon, key, kindOf, ring, row, testsOf, wakeLabel, type Kind } from "./parts.js";

/**
 * The Board tab, read top to bottom: where things stand now, what needs you, a few next, then the rest of
 * the plan by status and by project. One row size throughout; status is an icon shape, not a font size.
 */
export function boardTab(b: Board): string {
  const { v } = b;
  const next = b.queue.filter((t) => t !== b.heroItem);
  const parked = [...b.later, ...b.someday];
  const groups = [
    group("review", "Ready to try", b.review.length, b.review.map((t) => reviewRow(b, t)).join("")),
    group("due", "Due", b.due.length, b.due.map((t) => row(v, t, { right: esc(str(t, "due")) })).join("")),
    group("todo", b.heroItem ? "After that" : "Up next", next.length, capped(next.map((t) => row(v, t)), 5)),
    group("waiting", "Waiting", b.waiting.length, b.waiting.map((t) => row(v, t, { right: `on ${esc(str(t, "wait"))}` })).join("")),
    group("inbox", "Inbox, to sort", b.inbox.length, b.inbox.map((t) => row(v, t, { project: false })).join("")),
    group("sleeping", "Sleeping", b.sleeping.length, capped(b.sleeping.map((t) => row(v, t, { note: esc(wakeLabel(v, b.store, when(t))) })), 5)),
    group("later", "Later", parked.length, capped(parked.map((t) => row(v, t, { right: esc(when(t)) })), 5)),
  ].join("");
  return `<main class="tab tab-board">${focus(b)}${groups}${projects(b)}</main>`;
}

/** The card at the top: what's in progress, or what's next when nothing is, with the handoff and the last change. */
function focus(b: Board): string {
  const t = b.now ?? b.heroItem;
  const handoff = readHandoff(b.ctx);
  const last = b.events[0];
  const pulse = last
    ? `<div class="pulse">Last change ${clock(last.at, b.nowMs, "", " ago")}: ${esc(last.verb)} <span class="t2">${esc(last.title)}</span></div>`
    : "";
  const notes = `${handoff ? `<p class="handoff">${esc(handoff)}</p>` : ""}${pulse}`;
  if (!t) return `<section class="focus idle"><div class="fl">${icon("later")}<span class="lbl">Nothing in progress, nothing queued</span></div>${notes}</section>`;
  let facts = chip(b.v, t);
  if (b.now) {
    const started = lastEvent(b.events, t.id, "started");
    if (started) facts = `<span class="t3">${clock(started.at, b.nowMs, "started ", " ago")}</span>${facts}`;
    const p = b.openProjects.find((x) => x.id === t.home.name);
    if (p) {
      const { done, total } = projectTasks(b.store, p);
      facts += `<span class="t3 prog">${ring(done, total, 14, hue(b.v, p.id))}${done} of ${total}</span>`;
    }
  }
  const kind: Kind = b.now ? "now" : "todo";
  const label = b.now ? "In progress" : "Nothing in progress. Next up";
  return `<section class="focus ${b.now ? "working" : "idle"}"${b.now ? "" : hue(b.v, t.home.name)} data-key="${key(t)}">
<div class="fl">${icon(kind)}<span class="lbl">${label}</span>${facts}</div>
<h2 class="ft" title="id ${t.id}">${esc(t.title)}</h2>${notes}</section>`;
}

/** A task waiting for you to try it: what to try and how long it has waited. */
function reviewRow(b: Board, t: Item): string {
  const since = lastEvent(b.events, t.id, "ready to try");
  const tryIt = testsOf(t)[0];
  return row(b.v, t, { note: tryIt ? `Try: ${esc(tryIt)}` : undefined, right: since ? clock(since.at, b.nowMs, "", "") : undefined });
}

const ORDER: Kind[] = ["now", "review", "due", "todo", "waiting", "inbox", "sleeping", "later"];

/** Each open project with its progress ring; it opens to its tasks by status, done ones folded at the end. */
function projects(b: Board): string {
  const rows = b.openProjects.map((p) => {
    const { tasks: own, done, total } = projectTasks(b.store, p);
    const open = own
      .filter((t) => state(t) !== "done")
      .sort((x, y) => ORDER.indexOf(kindOf(x)) - ORDER.indexOf(kindOf(y)) || byQueue(x, y));
    const closed = own.filter((t) => state(t) === "done");
    const list = open.map((t) => row(b.v, t, { project: false, right: kindOf(t) === "later" ? esc(when(t)) : undefined })).join("");
    const doneList = closed.length
      ? `<li><details class="more"><summary>${closed.length} done</summary><ul>${closed.map((t) => row(b.v, t, { project: false })).join("")}</ul></details></li>`
      : "";
    return `<li data-key="${p.id}:${done}/${total}"${hue(b.v, p.id)}><details class="project" data-id="${p.id}"><summary title="id ${p.id}">${ring(done, total, 16)}<span class="pn">${esc(p.title)}</span><span class="c">${done}/${total}</span></summary><ul>${list || '<li class="empty">No open tasks.</li>'}${doneList}</ul></details></li>`;
  });
  return rows.length ? `<section class="projects"><h3>Projects<span class="c">${rows.length}</span></h3><ul>${rows.join("")}</ul></section>` : "";
}
