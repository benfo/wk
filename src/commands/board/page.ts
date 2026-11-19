import path from "node:path";
import type { Ctx } from "../../context.js";
import { currentBranch } from "../../git.js";
import type { Store } from "../../store.js";
import { readSummary } from "../homes.js";
import { boardTab } from "./board-tab.js";
import { collect, type Board } from "./data.js";
import { historyTab } from "./history-tab.js";
import { LIVE_SCRIPT } from "./live-script.js";
import { esc, headline } from "./parts.js";
import { CSS } from "./styles.js";

/**
 * The plan as one HTML page with two tabs: Board (where things stand, what needs you, what's next, the rest of
 * the plan) and History (done, recent changes, areas, knowledge). The tabs are plain HTML and CSS, so the
 * static page needs no scripts; live mode adds remembering the tab.
 */
export function boardHtml(ctx: Ctx, store: Store, opts: { live?: boolean } = {}): string {
  const b = collect(ctx, store);
  const title = headline(readSummary(ctx), path.basename(ctx.base));
  const firstNeed = b.review[0] ?? b.due[0];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${b.needsYou ? `(${b.needsYou}) ` : ""}${title} | wk`)}</title><style>${CSS}</style></head><body>
<div id="app" data-needs="${b.needsYou}" data-first="${esc(firstNeed ? `${b.review[0] ? "Ready for you" : "Due"}: ${firstNeed.title}` : "")}">
<input type="radio" name="tab" value="board" id="tab-board" class="tab-radio" checked><input type="radio" name="tab" value="history" id="tab-history" class="tab-radio">
${top(b, title, opts.live)}
${boardTab(b)}
${historyTab(b)}
</div>${opts.live ? LIVE_SCRIPT : ""}</body></html>
`;
}

/** Top line: what this is, the counts worth a glance, and the tabs. */
function top(b: Board, title: string, live?: boolean): string {
  const [name, ...more] = title.split(/(?<=\.)\s+/);
  const branch = b.ctx.git ? currentBranch(b.ctx.base) : null;
  const status = live ? '<button id="notify" class="notify" hidden>Notify me</button><span id="live" class="live" title="Connecting">live</span>' : "";
  const needs = b.needsYou ? `<span class="hot"><b>${b.needsYou}</b> ${b.needsYou === 1 ? "needs" : "need"} you</span>` : "";
  return `<header class="top"><h1><span${more.length ? ` title="${esc(more.join(" "))}"` : ""}>${esc(name.replace(/\.$/, ""))}</span>${branch ? `<span class="branch" title="Current git branch">${esc(branch)}</span>` : ""}</h1>
<div class="right">${needs}${status}<nav class="tabs" aria-label="Views"><label for="tab-board" title="Press 1">Board</label><label for="tab-history" title="Press 2">History</label></nav></div></header>`;
}
