import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { result, type Result } from "../../output.js";
import type { Ctx } from "../context.js";
import { byQueue, daysBetween, isDue, isQueued, isWaiting, state, when } from "../model.js";
import { str, tagsOf, touchesOf, type Item, type Store } from "../store.js";
import { readSummary, projectTasks } from "./homes.js";
import { activePrinciples } from "./knowledge.js";
import { plural } from "./shared.js";
import { readHandoff, workflowLine } from "./views.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const RECENT_DAYS = 7;

let homeNames: Record<string, string> = {};
const homeName = (item: Item) => homeNames[item.home.name] ?? item.home.name;

function card(item: Item, extra = ""): string {
  const tags = tagsOf(item).map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
  const note = isWaiting(item) ? `<div class="note">waiting on ${esc(str(item, "wait"))}</div>` : "";
  const trigger = state(item) === "open" && !isQueued(item) && when(item) ? `<span class="when">${esc(when(item))}</span>` : "";
  return `<li class="card${isDue(item) ? " due" : ""}"><div class="title">${esc(item.title)}</div>
<div class="meta"><code>${item.id}</code><span class="home">${esc(homeName(item))}</span>${trigger}${tags}${extra}</div>${note}</li>`;
}

function column(title: string, items: Item[], hint: string, opts: { limit?: number; cls?: string } = {}): string {
  if (items.length === 0) return "";
  const limit = opts.limit ?? 50;
  const shown = items.slice(0, limit).map((i) => card(i)).join("\n");
  const more = items.length > limit ? `<li class="more">+${items.length - limit} more</li>` : "";
  const empty = items.length === 0 ? `<li class="empty">${esc(hint)}</li>` : "";
  return `<section class="col ${opts.cls ?? ""}"><h3>${esc(title)} <span class="count">${items.length}</span></h3><ul>${shown}${more}${empty}</ul></section>`;
}

function bar(done: number, total: number): string {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return `<div class="bar" title="${done}/${total}"><span style="width:${pct}%"></span></div><span class="pct">${done}/${total}</span>`;
}

/** The plan as one self-contained HTML page: no scripts, no network, light and dark. */
export function boardHtml(ctx: Ctx, store: Store): string {
  homeNames = Object.fromEntries(store.projects().map((p) => [p.id, p.title.length > 28 ? p.title.slice(0, 27) + "…" : p.title]));
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

  const columns: [string, Item[]][] = [["inbox", inbox], ["queue", queue], ["due", due], ["waiting", waiting], ["later", later], ["someday", someday], ["done this week", recent]];
  const empties = columns.filter(([, items]) => items.length === 0).map(([name]) => name);
  const emptyLine = empties.length ? `<p class="sub">Empty: ${esc(empties.join(", "))}.</p>` : "";
  const summary = readSummary(ctx);
  const handoff = readHandoff(ctx);
  const wf = workflowLine(ctx);

  const focus = [
    now ? `<div class="now"><span class="label">now</span><ul>${card(now)}</ul></div>` : `<div class="now idle"><span class="label">now</span><p>Nothing in progress.</p></div>`,
    ...review.map((r) => `<div class="now review"><span class="label">review</span><ul>${card(r)}</ul></div>`),
    handoff ? `<div class="handoff"><span class="label">handoff</span><pre>${esc(handoff)}</pre></div>` : "",
  ].join("\n");

  const projects = store
    .projects()
    .filter((p) => p.data.state !== "done")
    .map((p) => {
      const { tasks: pt, done, total } = projectTasks(store, p);
      const open = pt.filter((t) => state(t) !== "done").sort(byQueue);
      const touches = touchesOf(p).map((t) => `<span class="home">${esc(t)}</span>`).join("");
      const list = open.slice(0, 8).map((t) => `<li><span class="st st-${esc(state(t))}">${esc(state(t) === "open" ? when(t).split(":")[0] : state(t))}</span> ${esc(t.title)}</li>`).join("");
      return `<article class="project"><header><h3>${esc(p.title)}</h3><code>${p.id}</code></header>
<div class="progress">${bar(done, total)}</div><div class="meta">${touches}</div><ul class="plain">${list}${open.length > 8 ? `<li class="more">+${open.length - 8} more</li>` : ""}</ul></article>`;
    })
    .join("\n");

  const areas = store
    .areas()
    .map((a) => {
      const open = tasks.filter((t) => t.home.name === a && state(t) !== "done").length;
      const rules = activePrinciples(store, a)
        .map((r) => `<li><strong>${esc(r.title)}</strong><br><span class="why">${str(r, "instead") && str(r, "because") ? `instead of ${esc(str(r, "instead"))}; because ${esc(str(r, "because"))}` : "needs instead and because (wk review)"}</span></li>`)
        .join("");
      return `<details class="area"${rules ? " open" : ""}><summary><span class="home">${esc(a)}</span> ${open} open · ${plural(activePrinciples(store, a).length, "principle")} <span class="desc">${esc(store.areaDescription(a).split("\n")[0])}</span></summary>${rules ? `<ul class="rules">${rules}</ul>` : ""}</details>`;
    })
    .join("\n");

  const knowledge = all
    .filter((i) => (i.kind === "decision" || i.kind === "learning") && !str(i, "superseded_by"))
    .sort((a, b) => str(b, "created").localeCompare(str(a, "created")))
    .slice(0, 8)
    .map((i) => `<li><span class="kind kind-${i.kind}">${i.kind}</span> ${esc(i.title)} <span class="home">${esc(homeNames[i.home.name] ?? i.home.name)}</span></li>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>wk board</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--accent:#2f6fde;--due:#c2410c;--ok:#15803d;--chip:#eef0f4}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--panel:#1e1e1c;--ink:#ecebe6;--muted:#9b9a94;--line:#2e2d2a;--accent:#7aa7ff;--due:#fb923c;--ok:#4ade80;--chip:#2a2b30}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:32px 0 12px}h3{font-size:14px;margin:0 0 8px}
.top{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:baseline;justify-content:space-between}.sub{color:var(--muted);margin:4px 0 0}
.focus{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:16px}
.now,.handoff{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}.now .card{border:0;padding:0;margin:0}.now.idle p{margin:0;color:var(--muted)}
.label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:6px;font-weight:600}.review .label{color:var(--ok)}
pre{margin:0;white-space:pre-wrap;font:13px/1.45 ui-monospace,Consolas,monospace}
.board{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.col{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
.col h3{display:flex;justify-content:space-between}.count{color:var(--muted);font-weight:400}
ul{list-style:none;margin:0;padding:0}.card{border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:8px;background:var(--panel)}
.card.due{border-color:var(--due)}.title{font-weight:500}.meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;align-items:center}
code{font:12px ui-monospace,Consolas,monospace;color:var(--muted)}.home,.tag,.when{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--chip);color:var(--muted)}
.when{color:var(--due)}.note{font-size:12px;color:var(--muted);margin-top:4px}.empty,.more{color:var(--muted);font-size:12px;padding:4px 0}
.projects{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.project{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}.project header{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.progress{display:flex;align-items:center;gap:8px;margin:4px 0 8px}.bar{flex:1;height:8px;border-radius:999px;background:var(--chip);overflow:hidden}.bar span{display:block;height:100%;background:var(--ok)}.pct{font-size:12px;color:var(--muted)}
.plain li{padding:3px 0;border-top:1px solid var(--line)}.st{display:inline-block;min-width:56px;font-size:11px;color:var(--muted)}.st-now{color:var(--accent);font-weight:600}.st-review{color:var(--ok)}
.area{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}.area summary{cursor:pointer}.desc{color:var(--muted);margin-left:6px}
.rules{margin-top:8px}.rules li{padding:6px 0;border-top:1px solid var(--line)}.why{color:var(--muted);font-size:13px}
.know li{padding:4px 0;border-top:1px solid var(--line)}.kind{display:inline-block;min-width:68px;font-size:11px;color:var(--muted)}
.counts{display:flex;gap:16px;color:var(--muted);font-size:13px}
</style></head><body><main>
<div class="top"><div><h1>${esc(summary ? summary.split("\n")[0] : path.basename(ctx.base))}</h1>
<p class="sub">${esc(wf ?? "Workflow not set.")}</p></div><div class="counts"><span>${ctx.today}</span><span>${queue.length} queued</span><span>${inbox.length} in inbox</span><span>${due.length} due</span></div></div>
<div class="focus">${focus}</div>
<h2>Work</h2>
${emptyLine}
<div class="board">
${column("Inbox", inbox, "Nothing to sort.")}
${column("Queue", queue, "Nothing queued.", { limit: 12 })}
${column("Due", due, "Nothing due.", { cls: "due" })}
${column("Waiting", waiting, "Nothing waiting.")}
${column("Later", later, "Nothing later.", { limit: 8 })}
${column("Someday", someday, "No someday ideas.", { limit: 8 })}
${column("Done this week", recent, "Nothing finished this week.", { limit: 8 })}
</div>
<h2>Projects</h2>
${projects ? `<div class="projects">${projects}</div>` : '<p class="sub">No open projects.</p>'}
<h2>Areas and principles</h2>
${areas}
<h2>Recent decisions and learnings</h2>
${knowledge ? `<ul class="know">${knowledge}</ul>` : '<p class="sub">None yet.</p>'}
</main></body></html>
`;
}

/** Where the board goes: per machine, outside the plan, so a committed plan never churns. */
export function boardPath(ctx: Ctx): string {
  const key = createHash("sha1").update(path.resolve(ctx.root).toLowerCase()).digest("hex").slice(0, 12);
  return path.join(ctx.home, "boards", `${path.basename(ctx.base).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${key}.html`);
}

function openFile(file: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", file]] : process.platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
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
  if (opts.open) openFile(file);
  return result([`Board: ${file}`, opts.open ? "Opened in your browser." : "Open it in a browser, or rerun with --open."], { file });
}
