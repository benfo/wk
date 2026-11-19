import { state, when } from "../../model.js";
import { str, type Item } from "../../store.js";
import { activePrinciples } from "../knowledge.js";
import type { Board } from "./data.js";
import { esc, homeLabel, line, row, wakeLabel } from "./parts.js";

/** The Plan tab. Left: work that isn't moving yet. Right: what got done and what the plan knows. */
export function planView(b: Board): string {
  const { v, store } = b;
  const parked = [...b.later, ...b.someday];
  const left = [
    section("Inbox, to sort", b.inbox.length, `<ul>${b.inbox.map((t) => row(v, t, { home: false })).join("")}</ul>`),
    section("Waiting", b.waiting.length, `<ul>${b.waiting.map((t) => row(v, t, { note: `On ${str(t, "wait")}` })).join("")}</ul>`),
    section("Wakes up later", b.sleeping.length, byLabel(b.sleeping, (t) => wakeLabel(v, store, when(t)), (t) => row(v, t))),
    section("Later and someday", parked.length, byLabel(parked, (t) => homeLabel(v, t), (t) => row(v, t, { home: false, when: true }))),
  ].join("");
  const areas = areaRows(b);
  const knowledge = knowledgeRows(b);
  const right = [
    section("Done this week", b.recent.length, `<ul>${b.recent.map(line).join("")}</ul>`),
    section("Areas and principles", areas.length, `<ul>${areas.join("")}</ul>`),
    section("Recent decisions and learnings", knowledge.length, `<ul>${knowledge.join("")}</ul>`),
  ].join("");
  return `<main class="view plan"><div class="cols"><div>${left || '<p class="empty">Nothing parked.</p>'}</div><div>${right}</div></div></main>`;
}

function section(heading: string, n: number, inner: string): string {
  return n ? `<section class="group"><h3>${esc(heading)}<span class="pill">${n}</span></h3>${inner}</section>` : "";
}

/** Items under a small heading per label, in first-seen order. */
function byLabel(items: Item[], label: (t: Item) => string, render: (t: Item) => string): string {
  const groups = new Map<string, Item[]>();
  for (const t of items) groups.set(label(t), [...(groups.get(label(t)) ?? []), t]);
  return [...groups.entries()].map(([l, ts]) => `<h4>${esc(l)}</h4><ul>${ts.map(render).join("")}</ul>`).join("");
}

/** Each area opens to its principles, each with what it replaces and why. */
function areaRows(b: Board): string[] {
  return b.store.areas().map((a) => {
    const rules = activePrinciples(b.store, a);
    const open = b.tasks.filter((t) => t.home.name === a && state(t) !== "done").length;
    const list = rules
      .map((r) => {
        const ok = str(r, "instead") && str(r, "because");
        const why = ok ? `instead of ${esc(str(r, "instead"))}; because ${esc(str(r, "because"))}` : "Needs instead and because";
        return `<li><div>${esc(r.title)}</div><div class="why${ok ? "" : " missing"}">${why}</div></li>`;
      })
      .join("");
    return `<li><details class="area"><summary><span>${esc(a)}</span><span class="n">${open} open, ${rules.length} ${rules.length === 1 ? "rule" : "rules"}</span></summary><div class="desc">${esc(b.store.areaDescription(a).split("\n")[0])}</div>${list ? `<ol>${list}</ol>` : ""}</details></li>`;
  });
}

/** The six newest decisions and learnings still in force. */
function knowledgeRows(b: Board): string[] {
  return b.all
    .filter((i) => (i.kind === "decision" || i.kind === "learning") && !str(i, "superseded_by"))
    .sort((x, y) => str(y, "created").localeCompare(str(x, "created")))
    .slice(0, 6)
    .map((i) => `<li class="row" data-key="${i.id}" title="${i.id}"><div class="title">${esc(i.title)}</div><div class="meta"><span class="kind">${i.kind}</span><span>${esc(homeLabel(b.v, i))}</span></div></li>`);
}
