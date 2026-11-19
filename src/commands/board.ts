import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { result, type Result } from "../output.js";
import type { Ctx } from "../context.js";
import { byQueue, daysBetween, isDue, isQueued, isWaiting, state, triggerOf, when } from "../model.js";
import { lastEvent, readEvents } from "../events.js";
import { currentBranch } from "../git.js";
import { str, type Item, type Project, type Store } from "../store.js";
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

/** One quiet line under a title: why it's listed, where it lives and its timing. Ids stay in hover titles. */
function meta(v: View, item: Item, opts: { home?: boolean; when?: boolean; kind?: string } = {}): string {
  const parts: string[] = [];
  if (opts.kind) parts.push(`<span class="kind">${esc(opts.kind)}</span>`);
  if (opts.home !== false) parts.push(`<span>${esc(homeLabel(v, item))}</span>`);
  if (opts.when && when(item) && !isQueued(item)) parts.push(`<span class="when">${esc(when(item))}</span>`);
  return parts.length ? `<div class="meta">${parts.join("")}</div>` : "";
}

/** A key that changes when the row's meaning changes, so the live page can flash what's new. */
function key(item: Item): string {
  return esc(`${item.id}:${str(item, "state")}:${str(item, "when")}:${str(item, "due")}:${str(item, "wait")}:${item.title}`);
}

function row(v: View, item: Item, opts: { home?: boolean; when?: boolean; kind?: string; note?: string; since?: string } = {}): string {
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
  return `<section class="group${opts.tone ? ` ${opts.tone}` : ""}"><h3>${esc(title)}<span class="pill">${count}</span></h3><ul>${items.join("")}</ul></section>`;
}

function testsOf(item: Item): string[] {
  return item.body.split("\n").filter((l) => /^Test:\s*/i.test(l)).map((l) => l.replace(/^Test:\s*/i, ""));
}

/**
 * The live page: swaps #app in place when the plan changes (keeping the tab you are on), flashes
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
    var before = keys(), was = needs();
    app().replaceWith(next);
    document.title = doc.title;
    showTab(); showStatus(); notifyButton(); icon(needs()); tick();
    // Notify whenever you are not looking at the board: another window has focus, or the tab is hidden.
    if (needs() > was && (document.hidden || !document.hasFocus()) && "Notification" in window && Notification.permission === "granted") {
      send(app().getAttribute("data-first") || "Something needs you", document.title);
    }
    if (reduce) return;
    document.querySelectorAll("[data-key]").forEach(function (e) { if (!before[e.getAttribute("data-key")]) e.classList.add("fresh"); });
  }
  // The tab you are on survives refreshes and visits; 1 and 2 switch tabs.
  function savedTab() { try { return localStorage.getItem("wk-board-tab") || "now"; } catch (e) { return "now"; } }
  function pick(tab) {
    var r = document.getElementById("tab-" + tab);
    if (!r) return;
    r.checked = true;
    try { localStorage.setItem("wk-board-tab", tab); } catch (e) { /* storage blocked: the tab just isn't remembered */ }
  }
  function showTab() { var r = document.getElementById("tab-" + savedTab()); if (r) r.checked = true; }
  document.addEventListener("change", function (e) { if (e.target.name === "tab") pick(e.target.value); });
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(TEXTAREA|SELECT)$/.test(e.target.tagName) || (e.target.tagName === "INPUT" && e.target.type !== "radio")) return;
    if (e.key === "1") pick("now");
    if (e.key === "2") pick("plan");
  });
  function connect() {
    var es = new EventSource("/events");
    es.onopen = function () { status = "live"; showStatus(); };
    es.onerror = function () { status = "off"; showStatus(); };
    es.onmessage = function () { fetch("/", { cache: "no-store" }).then(function (r) { return r.text(); }).then(swap); };
  }
  status = "connecting"; showTab(); showStatus(); notifyButton(); icon(needs()); tick();
  setInterval(tick, 30000);
  connect();
})();
</script>`;

const CSS = `
:root{color-scheme:light dark;
--bg:#f7f7f5;--surface:#ffffff;--text:#18191b;--text-2:#55585e;--text-3:#7a7d84;--line:rgba(20,22,26,.08);--fill:rgba(20,22,26,.045);
--accent:#3651f0;--attn:#a14b08;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{
--bg:#101113;--surface:#17181b;--text:#ededee;--text-2:#a7aab1;--text-3:#7d8088;--line:rgba(255,255,255,.07);--fill:rgba(255,255,255,.045);
--accent:#8fa0ff;--attn:#f2a65e;--ok:#5bd38a}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:16px/1.5 "Inter var",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI Variable Text","Segoe UI",Roboto,sans-serif;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
code{font:13px/1.4 ui-monospace,"Cascadia Mono",Consolas,monospace}
ul,ol{list-style:none}
#app{max-width:1280px;margin:0 auto;padding:24px 32px 64px}

.tab-radio{position:absolute;opacity:0;pointer-events:none}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px 24px;flex-wrap:wrap;margin-bottom:32px}
.top h1{font-size:16px;font-weight:600;display:flex;align-items:baseline;gap:12px;min-width:0;flex:1 1 360px}
.top h1 .sub{font-weight:400;color:var(--text-3)}
.branch code{color:var(--text-3)}
.right{display:flex;align-items:center;gap:20px}
.stats{display:flex;gap:16px;align-items:center;color:var(--text-3);font-size:13px;font-variant-numeric:tabular-nums}
.stats b{color:var(--text-2);font-weight:600}
.stats .hot,.stats .hot b{color:var(--attn)}
.tabs{display:flex;gap:2px;padding:3px;background:var(--fill);border-radius:999px}
.tabs label{font-size:13px;font-weight:500;color:var(--text-2);padding:4px 14px;border-radius:999px;cursor:pointer;transition:background-color .15s,color .15s}
.tabs label:hover{color:var(--text)}
#tab-now:checked~.top label[for=tab-now],#tab-plan:checked~.top label[for=tab-plan]{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.12)}
#tab-now:focus-visible~.top label[for=tab-now],#tab-plan:focus-visible~.top label[for=tab-plan]{outline:2px solid var(--accent);outline-offset:2px}
#tab-now:checked~.plan,#tab-plan:checked~.now{display:none}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--text-3);font-size:13px}
.live::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--text-3)}
.live.on::before{background:var(--ok)}
.live.off::before{background:var(--attn)}
.notify{font:inherit;font-size:13px;color:var(--accent);background:none;border:0;cursor:pointer}

.hero{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:48px;padding:40px;border-radius:20px;background:var(--fill)}
.hero.working{background:color-mix(in srgb,var(--accent) 9%,var(--bg))}
.eyebrow{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-3);margin-bottom:12px}
.working .eyebrow{color:var(--accent)}
.working .eyebrow::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.hero h2{font-size:clamp(28px,1.6vw + 16px,40px);line-height:1.15;font-weight:650;letter-spacing:-.025em;text-wrap:balance;max-width:24ch}
.hero .meta{margin-top:16px}
.hero .body{margin-top:16px;color:var(--text-2);max-width:60ch}
.hero .body li{padding:2px 0}
.hero .progress{margin-top:20px;max-width:360px}
.handoff{min-width:0;align-self:center}
.handoff h3{font-size:13px;font-weight:600;color:var(--text-3);margin-bottom:8px}
.handoff p{color:var(--text-2);white-space:pre-wrap;max-width:56ch;display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}

.needs{margin-top:16px;padding:20px 24px;border-radius:16px;background:color-mix(in srgb,var(--attn) 11%,var(--bg))}
.needs h2{font-size:16px;font-weight:600;color:var(--attn);margin-bottom:4px}
.needs .row{border-color:color-mix(in srgb,var(--attn) 18%,transparent)}
.needs .row:last-child{border-bottom:0;padding-bottom:0}
.needs .kind{color:var(--attn);font-weight:500}
.aside{color:var(--text-3);font-size:13px;margin-top:12px}

.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:56px;margin-top:40px}
.group+.group{margin-top:40px}
.group h3{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-2);padding-bottom:8px}
.pill{display:inline-block;min-width:22px;padding:0 7px;border-radius:999px;background:var(--fill);color:var(--text-3);font-size:12px;font-weight:500;line-height:20px;text-align:center;font-variant-numeric:tabular-nums}
.group h4{font-size:13px;font-weight:500;color:var(--text-3);padding:16px 0 0}

.row{padding:12px 0;border-bottom:1px solid var(--line);transition:background-color 1.2s ease}
.row:last-child{border-bottom:0}
.row .title{line-height:1.4}
.row .note{color:var(--text-2);font-size:13px;margin-top:4px}
.fresh{background:color-mix(in srgb,var(--accent) 10%,transparent)!important;transition:none}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;margin-top:4px;color:var(--text-3);font-size:13px}
.meta .when{color:var(--text-3)}
.line{padding:6px 0;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{color:var(--text-3);padding:12px 0}

.queue{counter-reset:q var(--from,0)}
.queue .row{display:grid;grid-template-columns:28px minmax(0,1fr)}
.queue .row::before{counter-increment:q;content:counter(q);grid-row:span 3;color:var(--text-3);font-size:13px;line-height:1.75;font-variant-numeric:tabular-nums}

.progress{display:flex;align-items:center;gap:12px}
.bar{flex:1;height:6px;border-radius:999px;background:var(--fill);overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:var(--accent)}
.progress .num{font-size:13px;color:var(--text-3);font-variant-numeric:tabular-nums;min-width:4ch;text-align:right}
.project{padding:12px 0;border-bottom:1px solid var(--line)}
.project:last-child{border-bottom:0}
.project .progress{margin-top:8px}

.activity .act{display:grid;grid-template-columns:4.5em 5.5em minmax(0,1fr);gap:12px;padding:6px 0;font-size:13px;align-items:baseline}
.activity .act time,.activity .act .verb{color:var(--text-3);font-variant-numeric:tabular-nums}
.activity .act .what{color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

details.area{border-bottom:1px solid var(--line);padding:12px 0}
details.area:last-child{border-bottom:0}
details.area summary{cursor:pointer;display:flex;justify-content:space-between;gap:12px;list-style:none}
details.area summary::-webkit-details-marker{display:none}
details.area summary:hover{color:var(--accent)}
details.area summary .n{color:var(--text-3);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
details.area .desc{color:var(--text-3);font-size:13px;margin-top:4px}
details.area ol{margin-top:12px;display:grid;gap:8px}
details.area ol li{padding-left:12px;border-left:2px solid var(--line)}
details.area .why{color:var(--text-2);font-size:13px}
details.area .why.missing{color:var(--attn)}
.kind{color:var(--text-3)}
.for{color:var(--text-3);font-weight:400}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

@media (max-width:1000px){#app{padding:16px 16px 48px}.hero{grid-template-columns:1fr;gap:24px;padding:28px 24px}.cols{grid-template-columns:1fr;gap:40px}.top{margin-bottom:24px}}
@media (prefers-reduced-motion:reduce){.row,.tabs label{transition:none}}
`;

/**
 * The plan as one HTML page with two tabs: Now (what's happening, what needs you, what's next) for a glance
 * beside your agent, and Plan (history, parked work, areas, knowledge). The tabs are plain HTML and CSS,
 * so the static page needs no scripts; live mode adds remembering the tab.
 */
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
  // Only what asks you to act now counts; the inbox can wait for a sort.
  const needsYou = review.length + due.length;

  const title = headline(readSummary(ctx), path.basename(ctx.base));
  const branch = ctx.git ? currentBranch(ctx.base) : null;
  const firstNeed = review[0] ?? due[0];

  // Top line: what this is, the few counts worth a glance, and the tabs.
  const [name, ...more] = title.split(/(?<=\.)\s+/);
  const live = opts.live ? '<button id="notify" class="notify" hidden>Notify me</button><span id="live" class="live" title="Connecting">live</span>' : "";
  const stat = (n: number, label: string, cls = "") => `<span class="${cls}"><b>${n}</b> ${label}</span>`;
  const top = `<header class="top"><h1><span>${esc(name)}${more.length ? ` <span class="sub">${esc(more.join(" "))}</span>` : ""}</span>${branch ? `<span class="branch" title="Current git branch"><code>${esc(branch)}</code></span>` : ""}</h1>
<div class="right"><div class="stats">${needsYou ? stat(needsYou, needsYou === 1 ? "needs you" : "need you", "hot") : ""}${stat(queue.length, "queued")}${live}</div>
<nav class="tabs" aria-label="Views"><label for="tab-now" title="Press 1">Now</label><label for="tab-plan" title="Press 2">Plan</label></nav></div></header>`;

  // The hero: the task in progress (blue), or what comes next (neutral, and it then leaves the queue list).
  const handoff = readHandoff(ctx);
  const handoffBlock = `<aside class="handoff"><h3>Handoff</h3><p>${handoff ? esc(handoff) : "None yet."}</p></aside>`;
  let hero: string;
  let heroItem: Item | undefined;
  if (now) {
    const p = now.home.type === "project" ? projects.find((x) => x.id === now.home.name) : undefined;
    const prog = p ? projectTasks(store, p) : null;
    const body = now.body.split("\n").filter((l) => l.trim()).slice(0, 3).map((l) => `<li>${esc(l)}</li>`).join("");
    const started = lastEvent(events, now.id, "started");
    hero = `<section class="hero working" data-key="${key(now)}"><div><div class="eyebrow">In progress${started ? ` <span class="for">${clock(started.at, nowMs, "started ", " ago")}</span>` : ""}</div><h2 title="${now.id}">${esc(now.title)}</h2>${meta(v, now)}
${body ? `<ul class="body">${body}</ul>` : ""}${prog ? bar(prog.done, prog.total, true) : ""}</div>${handoffBlock}</section>`;
  } else {
    heroItem = queue[0];
    const label = heroItem ? "Nothing in progress. Up next" : "Nothing in progress";
    hero = `<section class="hero idle"><div><div class="eyebrow">${label}</div><h2${heroItem ? ` title="${heroItem.id}"` : ""}>${heroItem ? esc(heroItem.title) : "Nothing in progress."}</h2>${heroItem ? meta(v, heroItem) : ""}</div>${handoffBlock}</section>`;
  }

  // The amber strip: only when something asks you to act. The inbox is a quiet line.
  const inboxLine = inbox.length ? `<p class="aside">${inbox.length} in the inbox to sort, on the Plan tab.</p>` : "";
  const needRows = [
    ...review.map((t) => {
      const since = lastEvent(events, t.id, "ready to try");
      const tryIt = testsOf(t)[0];
      return row(v, t, { kind: "Ready to try", note: tryIt ? `Try: ${tryIt}` : undefined, since: since ? `Waiting ${clock(since.at, nowMs, "for ")}` : undefined });
    }),
    ...due.map((t) => row(v, t, { kind: "Due", when: true })),
  ];
  const needsStrip = needRows.length
    ? `<section class="needs"><h2>${needsYou} ${needsYou === 1 ? "needs" : "need"} you</h2><ul>${needRows.join("")}</ul>${inboxLine}</section>`
    : "";

  // Now, left: the queue. Right: projects and the heartbeat.
  const rest = queue.filter((t) => t !== heroItem);
  const queueBlock = `<section class="group"><h3>Up next<span class="pill">${queue.length}</span></h3>${
    rest.length ? `<ul class="queue"${heroItem ? ' style="--from:1"' : ""}>${rest.map((t) => row(v, t)).join("")}</ul>` : `<p class="empty">${heroItem ? "Nothing else queued." : "Nothing queued."}</p>`
  }${needRows.length ? "" : inboxLine}</section>`;
  const openProjects = projects.filter((p: Project) => p.data.state !== "done");
  const projectRows = openProjects.map((p) => {
    const { done, total } = projectTasks(store, p);
    return `<li class="project" data-key="${p.id}:${done}/${total}" title="${p.id}"><div>${esc(p.title)}</div>${bar(done, total)}</li>`;
  });
  const activity = events.slice(0, 3).map(
    (e) => `<li class="act" data-key="${esc(e.at + e.id + e.verb)}">${clock(e.at, nowMs, "", " ago")}<span class="verb">${esc(e.verb)}</span><span class="what">${esc(e.title)}</span></li>`,
  );
  const nowView = `<main class="view now">${hero}${needsStrip}<div class="cols"><div>${queueBlock}</div><div>${group("Projects", projectRows, { count: openProjects.length })}${
    activity.length ? `<section class="group activity"><h3>Just happened</h3><ul>${activity.join("")}</ul></section>` : ""
  }</div></div></main>`;

  // Plan, left: work that isn't moving yet. Right: what got done and what the plan knows.
  const byLabel = (items: Item[], label: (t: Item) => string, render: (t: Item) => string) => {
    const groups = new Map<string, Item[]>();
    for (const t of items) groups.set(label(t), [...(groups.get(label(t)) ?? []), t]);
    return [...groups.entries()].map(([l, ts]) => `<h4>${esc(l)}</h4><ul>${ts.map(render).join("")}</ul>`).join("");
  };
  const section = (heading: string, n: number, inner: string) => (n ? `<section class="group"><h3>${esc(heading)}<span class="pill">${n}</span></h3>${inner}</section>` : "");
  const parked = [...later, ...someday];
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
  const planView = `<main class="view plan"><div class="cols"><div>${[
    section("Inbox, to sort", inbox.length, `<ul>${inbox.map((t) => row(v, t, { home: false })).join("")}</ul>`),
    section("Waiting", waiting.length, `<ul>${waiting.map((t) => row(v, t, { note: `On ${str(t, "wait")}` })).join("")}</ul>`),
    section("Wakes up later", sleeping.length, byLabel(sleeping, (t) => wakeLabel(v, store, when(t)), (t) => row(v, t))),
    section("Later and someday", parked.length, byLabel(parked, (t) => homeLabel(v, t), (t) => row(v, t, { home: false, when: true }))),
  ].join("") || '<p class="empty">Nothing parked.</p>'}</div><div>${[
    section("Done this week", recent.length, `<ul>${recent.map(line).join("")}</ul>`),
    section("Areas and principles", areaRows.length, `<ul>${areaRows.join("")}</ul>`),
    section("Recent decisions and learnings", knowledge.length, `<ul>${knowledge.join("")}</ul>`),
  ].join("")}</div></div></main>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${needsYou ? `(${needsYou}) ` : ""}${title} | wk`)}</title><style>${CSS}</style></head><body>
<div id="app" data-needs="${needsYou}" data-first="${esc(firstNeed ? `${review[0] ? "Ready for you" : "Due"}: ${firstNeed.title}` : "")}">
<input type="radio" name="tab" value="now" id="tab-now" class="tab-radio" checked><input type="radio" name="tab" value="plan" id="tab-plan" class="tab-radio">
${top}
${nowView}
${planView}
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
