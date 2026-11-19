import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { result, type Result } from "../output.js";
import type { Ctx } from "../context.js";
import { byQueue, daysBetween, isDue, isQueued, isWaiting, state, triggerOf, when } from "../model.js";
import { lastEvent, readEvents } from "../events.js";
import { currentBranch } from "../git.js";
import { str, tagsOf, type Item, type Project, type Store } from "../store.js";
import { readSummary, projectTasks } from "./homes.js";
import { activePrinciples } from "./knowledge.js";
import { readHandoff } from "./views.js";

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

/** One quiet line under a title: where it lives and its timing. The id and tags only where asked (the hero). */
function meta(v: View, item: Item, opts: { home?: boolean; when?: boolean; full?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.full) parts.push(`<code>${item.id}</code>`);
  if (opts.home !== false) parts.push(`<span>${esc(homeLabel(v, item))}</span>`);
  if (opts.when && when(item) && !isQueued(item)) parts.push(`<span class="when">${esc(when(item))}</span>`);
  if (opts.full) for (const t of tagsOf(item)) parts.push(`<span class="tag">#${esc(t)}</span>`);
  return parts.length ? `<div class="meta">${parts.join("")}</div>` : "";
}

/** A key that changes when the row's meaning changes, so the live page can flash what's new. */
function key(item: Item): string {
  return esc(`${item.id}:${str(item, "state")}:${str(item, "when")}:${str(item, "due")}:${str(item, "wait")}:${item.title}`);
}

function row(v: View, item: Item, opts: { home?: boolean; when?: boolean; note?: string; since?: string } = {}): string {
  const note = opts.note ? `<div class="note">${esc(opts.note)}</div>` : "";
  const since = opts.since ? `<div class="note">${opts.since}</div>` : "";
  return `<li class="row" data-key="${key(item)}" title="${item.id}"><div class="title">${esc(item.title)}</div>${meta(v, item, opts)}${note}${since}</li>`;
}

/** A one-line row: just the title, for long lists like what got done. */
function line(item: Item): string {
  return `<li class="line" data-key="${key(item)}" title="${item.id}">${esc(item.title)}</li>`;
}

/** "just now", "12 min", "3 h", "2 d": short enough for a glance. */
export function ago(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / (60 * 24))} d`;
}

/** A relative time the live page keeps ticking; `prefix` and `suffix` wrap the number. */
function clock(iso: string, nowMs: number, prefix = "", suffix = ""): string {
  const t = ago(iso, nowMs);
  const text = t === "just now" ? (suffix ? `${prefix}just now` : `${prefix}a moment`) : `${prefix}${t}${suffix}`;
  return `<time class="ago" datetime="${esc(iso)}" data-prefix="${esc(prefix)}" data-suffix="${esc(suffix)}">${esc(text)}</time>`;
}

/** Plain words for a trigger: when a sleeping item comes back. */
function wakeLabel(v: View, store: Store, w: string): string {
  const [kind, arg] = [w.slice(0, w.indexOf(":")), w.slice(w.indexOf(":") + 1)];
  if (kind === "after") {
    const target = store.list().find((i) => i.id === arg);
    return `After “${target ? target.title : arg}” is done`;
  }
  if (kind === "end") return `When ${v.homeNames[arg] ?? arg} ends`;
  if (kind === "start") return `Next time work starts in ${arg}`;
  if (kind === "on") return `On ${arg}`;
  return w;
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

/**
 * The live page: swaps #app in place when the plan changes (keeping each pane's scroll), flashes
 * rows it hasn't seen, ticks the relative times, puts the needs-you count in the tab title and icon,
 * and, if the user allowed it, sends a notification when something new needs them while the tab is hidden.
 */
const LIVE_SCRIPT = `<script>
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var status = "live";
  function app() { return document.getElementById("app"); }
  function keys() { var s = {}; document.querySelectorAll("[data-key]").forEach(function (e) { s[e.getAttribute("data-key")] = 1; }); return s; }
  function showStatus() {
    var dot = document.getElementById("live");
    if (!dot) return;
    dot.className = "live " + (status === "live" ? "on" : status === "off" ? "off" : "");
    dot.title = status === "live" ? "Live: updates as the plan changes" : "Reconnecting";
  }
  function needs() { return Number(app().getAttribute("data-needs") || 0); }
  function icon(n) {
    var c = document.createElement("canvas"); c.width = c.height = 32;
    var g = c.getContext("2d");
    g.fillStyle = "#3d5afe"; g.beginPath(); g.roundRect(2, 2, 28, 28, 7); g.fill();
    g.fillStyle = "#fff"; g.font = "bold 15px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("wk", 16, 17);
    if (n) { g.fillStyle = "#f59e0b"; g.beginPath(); g.arc(25, 7, 7, 0, 7); g.fill(); }
    var link = document.querySelector("link[rel=icon]") || document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    link.href = c.toDataURL();
  }
  function tick() {
    var now = Date.now();
    document.querySelectorAll("time.ago").forEach(function (t) {
      var m = Math.max(0, Math.round((now - Date.parse(t.getAttribute("datetime"))) / 60000));
      var n = m < 1 ? "" : m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d";
      var pre = t.getAttribute("data-prefix") || "", suf = t.getAttribute("data-suffix") || "";
      t.textContent = n ? pre + n + suf : (suf ? pre + "just now" : pre + "a moment");
    });
  }
  function send(title, body) {
    try { new Notification(title, { body: body, tag: "wk", renotify: true }); } catch (e) { console.warn("wk: notification failed", e); }
  }
  function notifyButton() {
    var b = document.getElementById("notify");
    if (!b) return;
    b.hidden = false;
    if (!("Notification" in window)) { b.textContent = "Notifications unsupported"; b.disabled = true; return; }
    var p = Notification.permission;
    if (p === "default") {
      b.textContent = "Notify me"; b.title = "Get a desktop notification when something new needs you";
      b.onclick = function () { Notification.requestPermission().then(function (r) { notifyButton(); if (r === "granted") send("wk notifications are on", "You will hear from this board when something new needs you."); }); };
    } else if (p === "granted") {
      b.remove();
    } else {
      b.textContent = "Notifications blocked"; b.title = "Allow notifications for this site in the browser (the icon left of the address), then reload.";
      b.onclick = null;
    }
  }
  function swap(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var next = doc.getElementById("app");
    if (!next) return;
    var before = keys(), was = needs(), scroll = {};
    document.querySelectorAll("[data-pane]").forEach(function (p) { scroll[p.getAttribute("data-pane")] = p.scrollTop; });
    app().replaceWith(next);
    document.title = doc.title;
    document.querySelectorAll("[data-pane]").forEach(function (p) { p.scrollTop = scroll[p.getAttribute("data-pane")] || 0; });
    showStatus(); notifyButton(); icon(needs()); tick();
    // Notify whenever you are not looking at the board: another window has focus, or the tab is hidden.
    if (needs() > was && (document.hidden || !document.hasFocus()) && "Notification" in window && Notification.permission === "granted") {
      send(app().getAttribute("data-first") || "Something needs you", document.title);
    }
    if (reduce) return;
    document.querySelectorAll("[data-key]").forEach(function (e) { if (!before[e.getAttribute("data-key")]) e.classList.add("fresh"); });
  }
  function connect() {
    var es = new EventSource("/events");
    es.onopen = function () { status = "live"; showStatus(); };
    es.onerror = function () { status = "off"; showStatus(); };
    es.onmessage = function () { fetch("/", { cache: "no-store" }).then(function (r) { return r.text(); }).then(swap); };
  }
  status = "connecting"; showStatus(); notifyButton(); icon(needs()); tick();
  setInterval(tick, 30000);
  connect();
})();
</script>`;

const CSS = `
:root{color-scheme:light dark;
--bg:#f6f6f4;--surface:#ffffff;--text:#1b1c1e;--text-2:#5d6066;--text-3:#7d8087;--line:rgba(20,22,26,.09);
--accent:#3d5afe;--accent-soft:rgba(61,90,254,.09);--attn:#b45309;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{
--bg:#111214;--surface:#18191c;--text:#ececed;--text-2:#a3a6ad;--text-3:#7c7f86;--line:rgba(255,255,255,.08);
--accent:#8c9eff;--accent-soft:rgba(140,158,255,.12);--attn:#f0a35c;--ok:#5bd38a}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
code{font:12px/1.4 ui-monospace,"Cascadia Mono",Consolas,monospace}
ul,ol{list-style:none}
#app{height:100vh;display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:24px;padding:24px 32px 0;max-width:1280px;margin:0 auto}

.top{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
.top h1{font-size:14px;font-weight:600;display:flex;align-items:baseline;gap:12px;min-width:0}
.top h1 .sub{font-weight:400;color:var(--text-3)}
.branch code{color:var(--text-3)}
.stats{display:flex;gap:16px;align-items:center;color:var(--text-3);font-size:12px;font-variant-numeric:tabular-nums}
.stats b{color:var(--text-2);font-weight:600}
.stats .hot,.stats .hot b{color:var(--attn)}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--text-3)}
.live::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--text-3)}
.live.on::before{background:var(--ok)}
.live.off::before{background:var(--attn)}

.hero{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:48px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:32px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--accent)}
.hero.idle::before{display:none}
.eyebrow{font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px}
.hero.idle .eyebrow{color:var(--text-3)}
.hero h2{font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-.02em;text-wrap:balance;max-width:30ch}
.hero .meta{margin-top:12px}
.hero .body{margin-top:16px;color:var(--text-2);max-width:68ch}
.hero .body li{padding:2px 0}
.hero .progress{margin-top:16px;max-width:360px}
.handoff{min-width:0;align-self:center}
.handoff h3{font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:8px}
.handoff p{color:var(--text-2);white-space:pre-wrap;max-width:60ch;display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden}

.panes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:48px;min-height:0}
.pane{display:flex;flex-direction:column;min-height:0}
.scroll{overflow:auto;min-height:0;padding:0 4px 32px 0;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.group+.group,.group+details,details+details{margin-top:32px}
.group h3,.fold>summary{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;font-weight:600;color:var(--text-3);padding-bottom:8px;border-bottom:1px solid var(--line)}
.group h3 .num,.fold .num{font-weight:400;font-variant-numeric:tabular-nums}
.group.attn h3{color:var(--attn)}
.group.attn .row{box-shadow:inset 2px 0 0 var(--attn);padding-left:12px}

.row{padding:12px 0;border-bottom:1px solid var(--line);transition:background-color 1.2s ease}
.row .title{line-height:1.4}
.row .note{color:var(--text-2);font-size:12px;margin-top:4px}
.fresh{background:var(--accent-soft)!important;transition:none}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;margin-top:4px;color:var(--text-3);font-size:12px}
.meta code{color:var(--text-3)}
.meta .when{color:var(--attn)}
.line{padding:6px 0;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.queue{counter-reset:q var(--from,0)}
.queue .row{display:grid;grid-template-columns:24px minmax(0,1fr)}
.queue .row::before{counter-increment:q;content:counter(q);grid-row:span 3;color:var(--text-3);font-size:12px;line-height:1.7;font-variant-numeric:tabular-nums}

.progress{display:flex;align-items:center;gap:12px}
.bar{flex:1;height:4px;border-radius:2px;background:var(--line);overflow:hidden}
.bar span{display:block;height:100%;background:var(--accent)}
.progress .num{font-size:12px;color:var(--text-3);font-variant-numeric:tabular-nums;min-width:4ch;text-align:right}
.project{padding:12px 0;border-bottom:1px solid var(--line)}
.project .progress{margin-top:8px}

.fold>summary{cursor:pointer;list-style:none}
.fold>summary::-webkit-details-marker{display:none}
.fold>summary::after{content:"Show";font-weight:400;color:var(--text-3);margin-left:auto;padding-left:12px}
.fold[open]>summary::after{content:"Hide"}
.fold>summary .num{margin-left:8px}
.fold>summary:hover{color:var(--text-2)}
.fold>ul,.fold>ol{margin-top:4px}
details.area{border-bottom:1px solid var(--line);padding:12px 0}
details.area summary{cursor:pointer;display:flex;justify-content:space-between;gap:12px;list-style:none}
details.area summary::-webkit-details-marker{display:none}
details.area summary .n{color:var(--text-3);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
details.area .desc{color:var(--text-3);font-size:12px;margin-top:4px}
details.area ol{margin-top:12px;display:grid;gap:8px}
details.area ol li{padding-left:12px;border-left:2px solid var(--line)}
details.area .why{color:var(--text-2);font-size:12px}
details.area .why.missing{color:var(--attn)}
.kind{color:var(--text-3)}
.calm{color:var(--text-3);padding:12px 0}
.for{color:var(--text-3);font-weight:400}
.wake h4{font-size:12px;font-weight:400;color:var(--text-3);padding:12px 0 0}
.activity .act{display:grid;grid-template-columns:5em 5.5em minmax(0,1fr);gap:12px;padding:6px 0;font-size:12px;align-items:baseline}
.activity .act time{color:var(--text-3);font-variant-numeric:tabular-nums}
.activity .act .verb{color:var(--text-3)}
.activity .act .what{color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.notify{font:inherit;font-size:12px;color:var(--accent);background:none;border:0;cursor:pointer}
.empty{color:var(--text-3);padding:12px 0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

@media (max-width:900px){#app{height:auto;padding:16px}.hero{grid-template-columns:1fr;gap:24px;padding:24px}.panes{grid-template-columns:1fr;gap:32px}.scroll{overflow:visible}.hero h2{font-size:22px}}
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
  const resting = tasks.filter((t) => state(t) === "open" && !isQueued(t) && !isDue(t) && !isWaiting(t));
  const later = resting.filter((t) => when(t) === "later");
  const sleeping = resting.filter((t) => triggerOf(when(t)));
  const events = readEvents(ctx, 200);
  const nowMs = Date.now();
  const someday = resting.filter((t) => when(t) === "someday");
  const recent = tasks
    .filter((t) => state(t) === "done" && daysBetween(str(t, "done_on") || str(t, "updated"), ctx.today) <= RECENT_DAYS)
    .sort((a, b) => str(b, "done_on").localeCompare(str(a, "done_on")));
  const needsYou = review.length + due.length + inbox.length;

  const title = headline(readSummary(ctx), path.basename(ctx.base));
  const branch = ctx.git ? currentBranch(ctx.base) : null;
  const firstNeed = review[0] ?? due[0] ?? inbox[0];
  // Top line: what this is, and the few counts worth a glance. The workflow is for agents; `wk brief` has it.
  const live = opts.live ? '<button id="notify" class="notify" hidden>Notify me</button><span id="live" class="live" title="Connecting">live</span>' : "";
  const stat = (n: number, label: string, cls = "") => `<span class="${cls}"><b>${n}</b> ${label}</span>`;
  const [name, ...more] = title.split(/(?<=\.)\s+/);
  const top = `<header class="top"><h1><span>${esc(name)}${more.length ? ` <span class="sub">${esc(more.join(" "))}</span>` : ""}</span>${branch ? `<span class="branch" title="Current git branch"><code>${esc(branch)}</code></span>` : ""}</h1>
<div class="stats">${needsYou ? stat(needsYou, needsYou === 1 ? "needs you" : "need you", "hot") : ""}${stat(queue.length, "queued")}${stat(recent.length, "done this week")}${live}</div></header>`;

  // The hero: the task in progress, or what comes next (which then leaves the queue list).
  const handoff = readHandoff(ctx);
  const handoffBlock = `<aside class="handoff"><h3>Handoff</h3><p>${handoff ? esc(handoff) : "None yet."}</p></aside>`;
  let hero: string;
  let heroItem: Item | undefined;
  if (now) {
    const p = now.home.type === "project" ? projects.find((x) => x.id === now.home.name) : undefined;
    const prog = p ? projectTasks(store, p) : null;
    const body = now.body.split("\n").filter((l) => l.trim()).slice(0, 3).map((l) => `<li>${esc(l)}</li>`).join("");
    const started = lastEvent(events, now.id, "started");
    hero = `<section class="hero" data-key="${key(now)}"><div><div class="eyebrow">In progress${started ? ` <span class="for">${clock(started.at, nowMs, "started ", " ago")}</span>` : ""}</div><h2>${esc(now.title)}</h2>${meta(v, now, { full: true })}
${body ? `<ul class="body">${body}</ul>` : ""}${prog ? bar(prog.done, prog.total, true) : ""}</div>${handoffBlock}</section>`;
  } else {
    heroItem = queue[0];
    const label = heroItem ? "Nothing in progress. Up next" : "Nothing in progress";
    hero = `<section class="hero idle"><div><div class="eyebrow">${label}</div><h2>${heroItem ? esc(heroItem.title) : "Nothing in progress."}</h2>${heroItem ? meta(v, heroItem, { full: true }) : ""}</div>${handoffBlock}</section>`;
  }

  // Left: what needs a person, then the queue, waits, and what sleeps.
  const needs = [
    group(
      "Ready for you to try",
      review.map((t) => {
        const since = lastEvent(events, t.id, "ready to try");
        return row(v, t, { note: testsOf(t)[0] ? `Try: ${testsOf(t)[0]}` : undefined, since: since ? `Waiting ${clock(since.at, nowMs, "for ")}` : undefined });
      }),
      { tone: "attn" },
    ),
    group("Due", due.map((t) => row(v, t, { when: true })), { tone: "attn" }),
    group("Inbox, to sort", inbox.map((t) => row(v, t, { home: false })), { tone: "attn" }),
  ].join("");
  const rest = queue.filter((t) => t !== heroItem);
  const queueBlock = `<section class="group"><h3>Up next<span class="num">${queue.length} queued</span></h3>${
    rest.length ? `<ul class="queue"${heroItem ? ' style="--from:1"' : ""}>${rest.map((t) => row(v, t)).join("")}</ul>` : `<p class="empty">${heroItem ? "Nothing else queued." : "Nothing queued."}</p>`
  }</section>`;
  const waitBlock = group("Waiting", waiting.map((t) => row(v, t, { note: `On ${str(t, "wait")}` })));
  const wakes = new Map<string, Item[]>();
  for (const t of sleeping) wakes.set(when(t), [...(wakes.get(when(t)) ?? []), t]);
  const wakeBlock = wakes.size
    ? `<section class="group wake"><h3>Wakes up later<span class="num">${sleeping.length}</span></h3>${[...wakes.entries()]
        .map(([w, items]) => `<h4>${esc(wakeLabel(v, store, w))}</h4><ul>${items.map((t) => row(v, t)).join("")}</ul>`)
        .join("")}</section>`
    : "";
  const fold = (label: string, n: number, inner: string) =>
    n ? `<details class="fold"><summary>${esc(label)}<span class="num">${n}</span></summary>${inner}</details>` : "";
  const parked = [...later, ...someday];
  const paneNext = `<section class="pane">
<div class="scroll" data-pane="next">${needs}${queueBlock}${waitBlock}${wakeBlock}${fold("Later and someday", parked.length, `<ul>${parked.map((t) => row(v, t, { when: true })).join("")}</ul>`)}</div></section>`;

  // Right: the shape of the plan. Projects open; the rest folded until asked for.
  const openProjects = projects.filter((p: Project) => p.data.state !== "done");
  const projectRows = openProjects.map((p) => {
    const { done, total } = projectTasks(store, p);
    return `<li class="project" data-key="${p.id}:${done}/${total}" title="${p.id}"><div>${esc(p.title)}</div>${bar(done, total)}</li>`;
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
    .map((i) => `<li class="row" data-key="${i.id}" title="${i.id}"><div class="title">${esc(i.title)}</div><div class="meta"><span class="kind">${i.kind}</span><span>${esc(homeLabel(v, i))}</span></div></li>`);
  const activity = events.slice(0, 5).map(
    (e) => `<li class="act" data-key="${esc(e.at + e.id + e.verb)}">${clock(e.at, nowMs, "", " ago")}<span class="verb">${esc(e.verb)}</span><span class="what">${esc(e.title)}</span></li>`,
  );
  const side = [
    group("Projects", projectRows, { count: openProjects.length }),
    activity.length ? `<section class="group activity"><h3>Just happened</h3><ul>${activity.join("")}</ul></section>` : "",
    fold("Done this week", recent.length, `<ul>${recent.map(line).join("")}</ul>`),
    fold("Areas and principles", areaRows.length, `<ul>${areaRows.join("")}</ul>`),
    fold("Recent decisions and learnings", knowledge.length, `<ul>${knowledge.join("")}</ul>`),
  ].join("");
  const paneSide = `<section class="pane side">
<div class="scroll" data-pane="side">${side}</div></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${needsYou ? `(${needsYou}) ` : ""}${title} | wk`)}</title><style>${CSS}</style></head><body>
<div id="app" data-needs="${needsYou}" data-first="${esc(firstNeed ? `Ready for you: ${firstNeed.title}` : "")}">
${top}
${hero}
<div class="panes">${paneNext}${paneSide}</div>
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
