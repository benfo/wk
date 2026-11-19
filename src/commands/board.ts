import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { result, type Result } from "../output.js";
import type { Ctx } from "../context.js";
import { byQueue, daysBetween, isDue, isQueued, isWaiting, state, when } from "../model.js";
import { str, tagsOf, touchesOf, type Item, type Project, type Store } from "../store.js";
import { readSummary, projectTasks } from "./homes.js";
import { activePrinciples } from "./knowledge.js";
import { readHandoff, workflowLine } from "./views.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const RECENT_DAYS = 7;

interface View {
  homeNames: Record<string, string>;
}

/** "Name: Daily Dad Joke CLI" reads better as "Daily Dad Joke CLI". */
function headline(summary: string, fallback: string): string {
  const first = summary.split("\n")[0]?.trim() ?? "";
  const text = first.replace(/^[A-Za-z][\w ]{0,20}:\s+/, "") || fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function homeLabel(v: View, item: Item): string {
  return v.homeNames[item.home.name] ?? item.home.name;
}

/** One quiet line of facts under a title: where it lives, its timing, its tags. */
function meta(v: View, item: Item, opts: { home?: boolean; when?: boolean } = {}): string {
  const parts: string[] = [];
  parts.push(`<code>${item.id}</code>`);
  if (opts.home !== false) parts.push(`<span>${esc(homeLabel(v, item))}</span>`);
  if (opts.when && when(item) && !isQueued(item)) parts.push(`<span class="when">${esc(when(item))}</span>`);
  for (const t of tagsOf(item)) parts.push(`<span class="tag">#${esc(t)}</span>`);
  return `<div class="meta">${parts.join("")}</div>`;
}

function row(v: View, item: Item, opts: { home?: boolean; when?: boolean; note?: string } = {}): string {
  const note = opts.note ? `<div class="note">${esc(opts.note)}</div>` : "";
  return `<li class="row" data-id="${item.id}"><div class="title">${esc(item.title)}</div>${meta(v, item, opts)}${note}</li>`;
}

function bar(done: number, total: number, long = false): string {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const label = long ? `${done} of ${total} tasks done` : `${done}/${total}`;
  return `<div class="progress"><div class="bar" role="img" aria-label="${done} of ${total} done"><span style="width:${pct}%"></span></div><span class="num">${label}</span></div>`;
}

function group(title: string, items: string[], opts: { tone?: string; count?: number } = {}): string {
  if (items.length === 0) return "";
  const count = opts.count ?? items.length;
  return `<section class="group${opts.tone ? ` ${opts.tone}` : ""}"><h3>${esc(title)}<span class="num">${count}</span></h3><ul>${items.join("")}</ul></section>`;
}

function testsOf(item: Item): string[] {
  return item.body.split("\n").filter((l) => /^Test:\s*/i.test(l)).map((l) => l.replace(/^Test:\s*/i, ""));
}

/** Keeps the page and the live script in step: the script swaps #app and flashes rows it hasn't seen. */
const LIVE_SCRIPT = `<script>
(function () {
  var dot = document.getElementById("live");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function ids() { var s = {}; document.querySelectorAll("[data-id]").forEach(function (e) { s[e.getAttribute("data-id") + "|" + e.textContent] = 1; }); return s; }
  function swap(html) {
    var before = ids();
    var scroll = {};
    document.querySelectorAll("[data-pane]").forEach(function (p) { scroll[p.getAttribute("data-pane")] = p.scrollTop; });
    var next = new DOMParser().parseFromString(html, "text/html").getElementById("app");
    if (!next) return;
    document.getElementById("app").replaceWith(next);
    document.querySelectorAll("[data-pane]").forEach(function (p) { p.scrollTop = scroll[p.getAttribute("data-pane")] || 0; });
    if (reduce) return;
    document.querySelectorAll("[data-id]").forEach(function (e) {
      if (!before[e.getAttribute("data-id") + "|" + e.textContent]) e.classList.add("fresh");
    });
  }
  function connect() {
    var es = new EventSource("/events");
    es.onopen = function () { dot.className = "live on"; dot.title = "Live: updates as the plan changes"; };
    es.onerror = function () { dot.className = "live off"; dot.title = "Reconnecting"; };
    es.onmessage = function () { fetch("/", { cache: "no-store" }).then(function (r) { return r.text(); }).then(swap); };
  }
  connect();
})();
</script>`;

const CSS = `
:root{color-scheme:light dark;
--bg:#f6f6f4;--surface:#ffffff;--text:#1b1c1e;--text-2:#5d6066;--text-3:#8a8d93;--line:rgba(20,22,26,.09);
--accent:#3d5afe;--accent-soft:rgba(61,90,254,.09);--attn:#b45309;--attn-soft:rgba(180,83,9,.09);--ok:#15803d}
@media (prefers-color-scheme:dark){:root{
--bg:#111214;--surface:#18191c;--text:#ececed;--text-2:#a3a6ad;--text-3:#73767d;--line:rgba(255,255,255,.08);
--accent:#8c9eff;--accent-soft:rgba(140,158,255,.12);--attn:#f0a35c;--attn-soft:rgba(240,163,92,.12);--ok:#5bd38a}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
code,.mono{font:12px/1.4 ui-monospace,"Cascadia Mono",Consolas,monospace}
ul{list-style:none}
#app{height:100vh;display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:16px;padding:16px 24px 24px;max-width:1600px;margin:0 auto}

.top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
.top h1{font-size:16px;font-weight:600;letter-spacing:-.005em}
.top .wf{color:var(--text-3);font-size:12px;margin-left:12px}
.stats{display:flex;gap:16px;align-items:center;color:var(--text-2);font-size:12px;font-variant-numeric:tabular-nums}
.stats b{color:var(--text);font-weight:600}
.stats .hot b{color:var(--attn)}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--text-3)}
.live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--text-3)}
.live.on::before{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 20%,transparent)}
.live.off::before{background:var(--attn)}

.hero{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:24px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:24px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--accent)}
.hero.idle::before{background:var(--line)}
.eyebrow{font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px;display:flex;gap:8px;align-items:center}
.hero.idle .eyebrow{color:var(--text-3)}
.hero h2{font-size:28px;line-height:1.2;font-weight:650;letter-spacing:-.02em;text-wrap:balance;max-width:32ch}
.hero.idle h2{font-weight:600}
.hero .meta{margin-top:12px}
.hero .body{margin-top:12px;color:var(--text-2);max-width:68ch}
.hero .body li{padding:2px 0}
.hero .progress{margin-top:16px;max-width:360px}
.handoff{border-left:1px solid var(--line);padding-left:24px;min-width:0}
.handoff h3{font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:8px}
.handoff pre{white-space:pre-wrap;color:var(--text-2);font:12.5px/1.55 ui-monospace,"Cascadia Mono",Consolas,monospace}

.panes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;min-height:0}
.pane{display:flex;flex-direction:column;min-height:0;background:var(--surface);border:1px solid var(--line);border-radius:12px}
.pane>header{display:flex;justify-content:space-between;align-items:baseline;padding:16px 16px 8px}
.pane>header h2{font-size:13px;font-weight:600}
.pane>header .num{color:var(--text-3);font-size:12px}
.scroll{overflow:auto;padding:0 16px 16px;min-height:0;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.group+.group{margin-top:16px}
.group h3{display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:var(--text-2);padding:8px 0 4px}
.group h3 .num{color:var(--text-3);font-weight:400}
.group.attn h3{color:var(--attn)}
.group.attn .row{box-shadow:inset 2px 0 0 var(--attn);padding-left:10px}

.row{padding:8px 0;border-top:1px solid var(--line);transition:background-color 1.2s ease}
.group h3+ul .row:first-child{border-top:0}
.row .title{font-weight:500;line-height:1.35}
.row .note{color:var(--text-2);font-size:12px;margin-top:2px}
.row.fresh{background:var(--accent-soft);transition:none}
.meta{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;margin-top:4px;color:var(--text-3);font-size:12px}
.meta code{color:var(--text-3)}
.meta .tag{color:var(--text-2)}
.meta .when{color:var(--attn)}

.queue{counter-reset:q}
.queue .row{display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:4px}
.queue .row::before{counter-increment:q;content:counter(q);grid-row:span 2;color:var(--text-3);font:12px/1.6 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}

.progress{display:flex;align-items:center;gap:8px}
.bar{flex:1;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.bar span{display:block;height:100%;background:var(--accent);border-radius:3px}
.progress .num{font-size:12px;color:var(--text-3);font-variant-numeric:tabular-nums;min-width:3.5ch;text-align:right}
.project{padding:8px 0;border-top:1px solid var(--line)}
.group h3+ul .project:first-child{border-top:0}
.project .name{display:flex;justify-content:space-between;gap:8px;font-weight:500}
.project .progress{margin-top:6px}
.project .meta{margin-top:6px}
details.area{border-top:1px solid var(--line);padding:8px 0}
.group h3+ul details.area:first-child{border-top:0}
details.area summary{cursor:pointer;display:flex;justify-content:space-between;gap:8px;list-style:none}
details.area summary::-webkit-details-marker{display:none}
details.area summary .n{color:var(--text-3);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
details.area .desc{color:var(--text-3);font-size:12px;margin-top:2px}
details.area ol{list-style:none;margin-top:8px;display:grid;gap:8px}
details.area ol li{padding-left:12px;border-left:2px solid var(--line)}
details.area .why{color:var(--text-2);font-size:12px}
details.area .why.missing{color:var(--attn)}
.kind{color:var(--text-3);font-size:12px}
.know .title{font-weight:400;font-size:13px;color:var(--text-2)}
.project .name code{color:var(--text-3)}
.calm{color:var(--text-3);padding:8px 0 16px}
.empty{color:var(--text-3);padding:24px 0;text-align:center}
.later{margin-top:16px;color:var(--text-2)}
.later summary{cursor:pointer;font-size:12px;font-weight:600;padding:8px 0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

@media (max-width:1100px){.panes{grid-template-columns:repeat(2,minmax(0,1fr))}.pane.side{grid-column:span 2}}
@media (max-width:760px){#app{height:auto;padding:16px}.hero{grid-template-columns:1fr;padding:16px 16px 16px 20px}.handoff{border-left:0;border-top:1px solid var(--line);padding:16px 0 0}.panes{grid-template-columns:1fr}.pane.side{grid-column:auto}.scroll{overflow:visible}.hero h2{font-size:22px}}
@media (prefers-reduced-motion:reduce){.row{transition:none}}
`;

/** The plan as one HTML page. Fits one screen on a laptop; each pane scrolls on its own. No network, no scripts unless live. */
export function boardHtml(ctx: Ctx, store: Store, opts: { live?: boolean } = {}): string {
  const projects = store.projects();
  const v: View = { homeNames: Object.fromEntries(projects.map((p) => [p.id, p.title])) };
  const all = store.list();
  const tasks = all.filter((i) => i.kind === "task");
  const now = tasks.find((t) => state(t) === "now");
  const review = tasks.filter((t) => state(t) === "review");
  const inbox = tasks.filter((t) => state(t) === "inbox");
  const queue = tasks.filter((t) => isQueued(t) && !isWaiting(t)).sort(byQueue);
  const due = tasks.filter((t) => isDue(t) && state(t) === "open" && !isQueued(t));
  const waiting = tasks.filter((t) => isWaiting(t) && state(t) !== "done");
  const later = tasks.filter((t) => state(t) === "open" && !isQueued(t) && !isDue(t) && !isWaiting(t) && when(t) !== "someday");
  const someday = tasks.filter((t) => state(t) === "open" && when(t) === "someday" && !isDue(t));
  const recent = tasks
    .filter((t) => state(t) === "done" && daysBetween(str(t, "done_on") || str(t, "updated"), ctx.today) <= RECENT_DAYS)
    .sort((a, b) => str(b, "done_on").localeCompare(str(a, "done_on")));
  const needsYou = review.length + due.length + inbox.length;

  // Top line: what this is, and the few counts worth a glance.
  const live = opts.live ? '<span id="live" class="live" title="Connecting">live</span>' : "";
  const stat = (n: number, label: string, hot = false) => `<span class="${hot && n ? "hot" : ""}"><b>${n}</b> ${label}</span>`;
  const top = `<header class="top"><div><h1>${esc(headline(readSummary(ctx), path.basename(ctx.base)))}<span class="wf">${esc(workflowLine(ctx)?.replace(/^Workflow: /, "") ?? "")}</span></h1></div>
<div class="stats">${stat(needsYou, needsYou === 1 ? "needs you" : "need you", true)}${stat(queue.length, "queued")}${stat(recent.length, "done this week")}<span>${ctx.today}</span>${live}</div></header>`;

  // The hero: the task in progress, or what comes next.
  const handoff = readHandoff(ctx);
  const handoffBlock = handoff ? `<aside class="handoff"><h3>Handoff</h3><pre>${esc(handoff)}</pre></aside>` : `<aside class="handoff"><h3>Handoff</h3><pre>None yet.</pre></aside>`;
  let hero: string;
  if (now) {
    const p = now.home.type === "project" ? projects.find((x) => x.id === now.home.name) : undefined;
    const prog = p ? projectTasks(store, p) : null;
    const body = now.body.split("\n").filter((l) => l.trim()).slice(0, 3).map((l) => `<li>${esc(l)}</li>`).join("");
    hero = `<section class="hero" data-id="${now.id}"><div><div class="eyebrow">In progress</div><h2>${esc(now.title)}</h2>${meta(v, now)}
${body ? `<ul class="body">${body}</ul>` : ""}${prog ? bar(prog.done, prog.total, true) : ""}</div>${handoffBlock}</section>`;
  } else {
    const first = review[0] ?? queue[0];
    const label = review[0] ? "Waiting for you to try" : first ? "Nothing in progress. Up next" : "Nothing in progress";
    hero = `<section class="hero idle"><div><div class="eyebrow">${esc(label)}</div><h2>${first ? esc(first.title) : "Nothing in progress."}</h2>${first ? meta(v, first) : ""}</div>${handoffBlock}</section>`;
  }

  // Pane 1: the queue, in order, then what sleeps.
  const queueRows = queue.map((t) => row(v, t));
  const sleeping = [...later, ...someday];
  const laterBlock = sleeping.length
    ? `<details class="later"><summary>Later and someday (${sleeping.length})</summary><ul>${sleeping.map((t) => row(v, t, { when: true })).join("")}</ul></details>`
    : "";
  const paneNext = `<section class="pane"><header><h2>Up next</h2><span class="num">${queue.length} queued</span></header>
<div class="scroll" data-pane="next">${queueRows.length ? `<ul class="queue">${queueRows.join("")}</ul>` : '<p class="empty">Nothing queued.</p>'}${laterBlock}</div></section>`;

  // Pane 2: what needs a person: review, due, inbox, then waits.
  const needs = [
    group("Ready for you to try", review.map((t) => row(v, t, { note: testsOf(t)[0] ? `Try: ${testsOf(t)[0]}` : undefined })), { tone: "attn" }),
    group("Due", due.map((t) => row(v, t, { when: true })), { tone: "attn" }),
    group("Inbox, to sort", inbox.map((t) => row(v, t, { home: false })), { tone: "attn" }),
    group("Waiting", waiting.map((t) => row(v, t, { note: `On ${str(t, "wait")}` }))),
  ].join("");
  const doneBlock = group("Done this week", recent.map((t) => row(v, t)));
  const paneNeeds = `<section class="pane"><header><h2>Needs you</h2><span class="num">${needsYou ? needsYou : ""}</span></header>
<div class="scroll" data-pane="needs">${needsYou || waiting.length ? needs : '<p class="calm">Nothing needs you right now.</p>'}${doneBlock}</div></section>`;

  // Pane 3: the shape of the plan: projects, areas and their principles, recent knowledge.
  const openProjects = projects.filter((p: Project) => p.data.state !== "done");
  const projectRows = openProjects.map((p) => {
    const { done, total } = projectTasks(store, p);
    const touches = touchesOf(p).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    return `<li class="project" data-id="${p.id}"><div class="name"><span>${esc(p.title)}</span><code>${p.id}</code></div>${bar(done, total)}${touches ? `<div class="meta">${touches}</div>` : ""}</li>`;
  });
  const areaRows = store.areas().map((a) => {
    const rules = activePrinciples(store, a);
    const open = tasks.filter((t) => t.home.name === a && state(t) !== "done").length;
    const list = rules
      .map((r) => {
        const ok = str(r, "instead") && str(r, "because");
        const why = ok ? `instead of ${esc(str(r, "instead"))}; because ${esc(str(r, "because"))}` : "Needs instead and because";
        return `<li><div>${esc(r.title)}</div><div class="why${ok ? "" : " missing"}">${why}</div></li>`;
      })
      .join("");
    return `<li><details class="area"><summary><span>${esc(a)}</span><span class="n">${open} open, ${rules.length} ${rules.length === 1 ? "rule" : "rules"}</span></summary><div class="desc">${esc(store.areaDescription(a).split("\n")[0])}</div>${list ? `<ol>${list}</ol>` : ""}</details></li>`;
  });
  const knowledge = all
    .filter((i) => (i.kind === "decision" || i.kind === "learning") && !str(i, "superseded_by"))
    .sort((a, b) => str(b, "created").localeCompare(str(a, "created")))
    .slice(0, 6)
    .map((i) => `<li class="row" data-id="${i.id}"><div class="title">${esc(i.title)}</div><div class="meta"><span class="kind">${i.kind}</span><span>${esc(homeLabel(v, i))}</span></div></li>`);
  const side = [
    group("Projects", projectRows, { count: openProjects.length }),
    group("Areas and principles", areaRows),
    knowledge.length ? `<section class="group know"><h3>Recent decisions and learnings</h3><ul>${knowledge.join("")}</ul></section>` : "",
  ].join("");
  const paneSide = `<section class="pane side"><header><h2>Plan</h2></header>
<div class="scroll" data-pane="side">${side}</div></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>wk board</title><style>${CSS}</style></head><body>
<div id="app">
${top}
${hero}
<div class="panes">${paneNext}${paneNeeds}${paneSide}</div>
</div>${opts.live ? LIVE_SCRIPT : ""}</body></html>
`;
}

/** Where the board goes: per machine, outside the plan, so a committed plan never churns. */
export function boardPath(ctx: Ctx): string {
  const key = createHash("sha1").update(path.resolve(ctx.root).toLowerCase()).digest("hex").slice(0, 12);
  return path.join(ctx.home, "boards", `${path.basename(ctx.base).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${key}.html`);
}

/** Opens a file or URL in the default browser; best effort. */
export function openUrl(target: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // The path is printed anyway.
  }
}

export function board(ctx: Ctx, store: Store, opts: { out?: string; open?: boolean }): Result {
  const file = opts.out ? path.resolve(ctx.cwd, opts.out) : boardPath(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, boardHtml(ctx, store));
  if (opts.open) openUrl(file);
  return result([`Board: ${file}`, opts.open ? "Opened in your browser." : "Open it in a browser, or rerun with --open."], { file });
}
