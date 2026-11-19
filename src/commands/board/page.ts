import path from "node:path";
import type { Ctx } from "../../context.js";
import { currentBranch } from "../../git.js";
import type { Store } from "../../store.js";
import { readSummary } from "../homes.js";
import { collect, type Board } from "./data.js";
import { LIVE_SCRIPT } from "./live-script.js";
import { nowView } from "./now.js";
import { esc, headline } from "./parts.js";
import { planView } from "./plan.js";
import { CSS } from "./styles.js";

/**
 * The plan as one HTML page with two tabs: Now (what's happening, what needs you, what's next) for a glance
 * beside your agent, and Plan (history, parked work, areas, knowledge). The tabs are plain HTML and CSS,
 * so the static page needs no scripts; live mode adds remembering the tab.
 */
export function boardHtml(ctx: Ctx, store: Store, opts: { live?: boolean } = {}): string {
  const b = collect(ctx, store);
  const title = headline(readSummary(ctx), path.basename(ctx.base));
  const firstNeed = b.review[0] ?? b.due[0];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${b.needsYou ? `(${b.needsYou}) ` : ""}${title} | wk`)}</title><style>${CSS}</style></head><body>
<div id="app" data-needs="${b.needsYou}" data-first="${esc(firstNeed ? `${b.review[0] ? "Ready for you" : "Due"}: ${firstNeed.title}` : "")}">
<input type="radio" name="tab" value="now" id="tab-now" class="tab-radio" checked><input type="radio" name="tab" value="plan" id="tab-plan" class="tab-radio">
${top(b, title, opts.live)}
${nowView(b)}
${planView(b)}
</div>${opts.live ? LIVE_SCRIPT : ""}</body></html>
`;
}

/** Top line: what this is, the few counts worth a glance, and the tabs. */
function top(b: Board, title: string, live?: boolean): string {
  const [name, ...more] = title.split(/(?<=\.)\s+/);
  const branch = b.ctx.git ? currentBranch(b.ctx.base) : null;
  const status = live ? '<button id="notify" class="notify" hidden>Notify me</button><span id="live" class="live" title="Connecting">live</span>' : "";
  const stat = (n: number, label: string, cls = "") => `<span class="${cls}"><b>${n}</b> ${label}</span>`;
  return `<header class="top"><h1><span>${esc(name)}${more.length ? ` <span class="sub">${esc(more.join(" "))}</span>` : ""}</span>${branch ? `<span class="branch" title="Current git branch"><code>${esc(branch)}</code></span>` : ""}</h1>
<div class="right"><div class="stats">${b.needsYou ? stat(b.needsYou, b.needsYou === 1 ? "needs you" : "need you", "hot") : ""}${stat(b.queue.length, "queued")}${status}</div>
<nav class="tabs" aria-label="Views"><label for="tab-now" title="Press 1">Now</label><label for="tab-plan" title="Press 2">Plan</label></nav></div></header>`;
}
