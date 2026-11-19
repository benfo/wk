import fs from "node:fs";
import path from "node:path";
import { progressBar, result, unescapeText, WkError, type Result } from "../../output.js";
import type { Ctx } from "../context.js";
import { checkLines, checkTitle, LIMITS } from "../limits.js";
import { byQueue, isOpen, isQueued, itemLine, state } from "../model.js";
import { touchesOf, type Project, type Store } from "../store.js";
import { SUMMARY_FILE } from "./init.js";
import { parseTags, plural } from "./shared.js";

export const PROJECT_TEMPLATE = "## Goal\n\n## Acceptance";

/** Checks that every touched area exists. */
export function checkTouches(store: Store, raw: string | undefined): string[] {
  const touches = parseTags(raw);
  for (const t of touches) {
    if (!store.areas().includes(t)) throw new WkError(`No area "${t}". Create it first: wk area new ${t} "<description>"`);
  }
  return touches;
}

export function projectNew(ctx: Ctx, store: Store, rawTitle: string, opts: { touches?: string; body?: string }): Result {
  const title = checkTitle(rawTitle, "Project title");
  if (store.projects().some((p) => p.title.toLowerCase() === title.toLowerCase() && p.data.state !== "done")) {
    throw new WkError(`A project called "${title}" is already open.`);
  }
  const touches = checkTouches(store, opts.touches);
  const body = opts.body !== undefined ? unescapeText(opts.body) : PROJECT_TEMPLATE;
  const p = store.createProject(title, body, { state: "open", touches });
  const lines = [`Project ${p.id} ${title}${touches.length ? ` (touches ${touches.join(", ")})` : ""}`];
  lines.push(`Add tasks with: wk add "<title>" --in ${p.id}`);
  return result(lines, { id: p.id, title, touches, dir: p.dir });
}

export function projectTasks(store: Store, p: Project) {
  const tasks = store.list().filter((i) => i.kind === "task" && i.home.name === p.id);
  return { tasks, done: tasks.filter((t) => state(t) === "done").length, total: tasks.length };
}

/** Every open project with progress, then each area's open count: the whole plan at a glance. */
export function projectList(_ctx: Ctx, store: Store): Result {
  const open = store.projects().filter((p) => p.data.state !== "done");
  const width = Math.max(0, ...open.map((p) => `${p.id} ${p.title}`.length));
  const lines: string[] = [];
  for (const p of open) {
    const { tasks, done, total } = projectTasks(store, p);
    lines.push(`${`${p.id} ${p.title}`.padEnd(width)}  ${progressBar(done, total)}  ${done}/${total}`);
    const active = tasks.filter((t) => ["now", "review"].includes(state(t)) || isQueued(t)).sort(byQueue).slice(0, 3);
    for (const t of active) lines.push(`  ${(state(t) === "open" ? "next" : state(t)).padEnd(6)} ${itemLine(t)}`);
  }
  const areaCounts = store.areas().map((a) => `${a} ${store.list().filter((i) => isOpen(i) && i.home.name === a).length}`);
  const inbox = store.list().filter((i) => i.home.type === "inbox").length;
  lines.push(`areas   ${areaCounts.join(" · ")}${inbox ? ` · inbox ${inbox}` : ""}`);
  if (open.length === 0) lines.unshift("No open projects. Start one: wk project new \"<title>\" --touches <areas>");
  return result(lines, { projects: open.map((p) => ({ id: p.id, title: p.title, ...projectTasks(store, p), tasks: undefined })) });
}

export function projectShow(_ctx: Ctx, store: Store, raw: string): Result {
  const p = store.project(raw);
  const { tasks, done, total } = projectTasks(store, p);
  const touches = touchesOf(p);
  const lines = [`${p.id} ${p.title}  ${progressBar(done, total)}  ${done}/${total}${p.data.state === "done" ? " (closed)" : ""}`];
  if (touches.length) lines.push(`touches: ${touches.join(", ")}`);
  if (p.body) lines.push("", ...p.body.split("\n"), "");
  const order = ["now", "review", "open", "inbox", "done"];
  for (const t of [...tasks].sort((a, b) => order.indexOf(state(a)) - order.indexOf(state(b)))) {
    lines.push(`  ${state(t).padEnd(6)} ${itemLine(t)}`);
  }
  const knowledge = store.list().filter((i) => i.kind !== "task" && i.home.name === p.id);
  for (const k of knowledge) lines.push(`  ${k.kind.padEnd(6)} ${k.id} ${k.title}`);
  return { lines, data: { ...p.data, title: p.title, body: p.body, done, total }, full: true };
}

export function areaNew(_ctx: Ctx, store: Store, name: string, rawDescription: string | undefined): Result {
  const description = checkLines(unescapeText(rawDescription ?? ""), LIMITS.areaDescription, "Area description");
  if (!description) throw new WkError(`Describe the area in a line: wk area new ${name} "<what it covers>"`);
  const home = store.createArea(name.trim().toLowerCase(), description);
  return result([`Area ${home.name}: ${description.split("\n")[0]}`], { name: home.name, description });
}

export function areaList(_ctx: Ctx, store: Store): Result {
  const lines = store.areas().map((a) => {
    const items = store.list().filter((i) => i.home.name === a);
    const open = items.filter(isOpen).length;
    const rules = items.filter((i) => i.kind === "principle" && !i.data.superseded_by).length;
    const desc = store.areaDescription(a).split("\n")[0];
    return `${a.padEnd(10)} ${plural(open, "open task")}, ${plural(rules, "principle")}  ${desc}`;
  });
  return result(lines, store.areas().map((a) => ({ name: a, description: store.areaDescription(a) })));
}

export function readSummary(ctx: Ctx): string {
  const file = path.join(ctx.root, SUMMARY_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim() : "";
}

export function summaryCmd(ctx: Ctx, _store: Store, raw: string | undefined): Result {
  if (raw === undefined) {
    const text = readSummary(ctx);
    if (!text) return result(['No summary yet. Write one: wk summary "What: …\\nWho: …\\nGoal: …\\nOut of scope: …\\nDone when: …"'], { summary: null });
    return { lines: text.split("\n"), data: { summary: text }, full: true };
  }
  const text = checkLines(unescapeText(raw), LIMITS.summary, "Summary");
  if (!text) throw new WkError("Summary is empty.");
  fs.writeFileSync(path.join(ctx.root, SUMMARY_FILE), text + "\n");
  return result([`Summary saved (${plural(text.split("\n").length, "line")}).`], { summary: text });
}
