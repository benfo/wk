import { state } from "../../model.js";
import { str } from "../../store.js";
import { activePrinciples } from "../knowledge.js";
import type { Board } from "./data.js";
import { capped, chip, clock, esc, group, row } from "./parts.js";

/** The History tab: what got done, what changed, and what the plan has learned. */
export function historyTab(b: Board): string {
  const done = b.recent.map((t) => row(b.v, t, { right: esc(str(t, "done_on")) }));
  const changes = b.events.slice(0, 30).map(
    (e) => `<li class="act" data-key="${esc(e.at + e.id + e.verb)}">${clock(e.at, b.nowMs, "", " ago")}<span class="verb">${esc(e.verb)}</span><span class="what">${esc(e.title)}</span></li>`,
  );
  const areas = areaRows(b);
  const knowledge = b.all
    .filter((i) => (i.kind === "decision" || i.kind === "learning") && !str(i, "superseded_by"))
    .sort((x, y) => str(y, "created").localeCompare(str(x, "created")))
    .slice(0, 10)
    .map((i) => `<li class="r" data-key="${i.id}" title="id ${i.id}"><span class="kind">${i.kind}</span><div class="body"><div class="tt">${esc(i.title)}</div></div>${chip(b.v, i)}</li>`);
  const body = [
    group("done", "Done this week", done.length, capped(done, 12)),
    group(null, "Just happened", changes.length, changes.join("")),
    group(null, "Areas and principles", areas.length, areas.join("")),
    group(null, "Decisions and learnings", knowledge.length, knowledge.join("")),
  ].join("");
  return `<main class="tab tab-history">${body || '<p class="empty">Nothing yet.</p>'}</main>`;
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
    return `<li><details class="area"><summary><span>${esc(a)}</span><span class="c">${open} open, ${rules.length} ${rules.length === 1 ? "rule" : "rules"}</span></summary><div class="desc">${esc(b.store.areaDescription(a).split("\n")[0])}</div>${list ? `<ol>${list}</ol>` : ""}</details></li>`;
  });
}
