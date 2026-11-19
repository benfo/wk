import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { findRoot, wkHome } from "../../context.js";
import { parse, type Data } from "../../frontmatter.js";
import { repoTop } from "../../git.js";
import { result, WkError, type Result } from "../../output.js";
import { BRANCH_MODES, CONFIG_FILE, configText, defaultConfig, parseConfig, type BranchMode, type CommitMode, type Ctx } from "../context.js";
import { AREA_NAME, CORE_AREA, Store, type Home, type Item, type Kind, type Project } from "../store.js";
import { ensureLayout, PRESET_SEEDS, SESSION_FILE, SUMMARY_FILE } from "./init.js";

interface V1Item {
  id: string;
  kind: "epic" | "task" | "idea" | "decision" | "learning";
  data: Data;
  body: string;
  archived: boolean;
}

const V1_DIRS: Record<string, V1Item["kind"]> = { epics: "epic", tasks: "task", ideas: "idea", decisions: "decision", learnings: "learning" };
const V1_PREFIX: Record<string, V1Item["kind"]> = { E: "epic", T: "task", I: "idea", D: "decision", L: "learning" };
const V1_FILE = /^([ETIDL])-(\d+)\.md$/;

function readV1(root: string): V1Item[] {
  const out: V1Item[] = [];
  const readDir = (dir: string, archived: boolean) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const m = V1_FILE.exec(f);
      if (!m) continue;
      const { data, body } = parse(fs.readFileSync(path.join(dir, f), "utf8"));
      out.push({ id: `${m[1]}-${m[2]}`, kind: V1_PREFIX[m[1]], data, body, archived });
    }
  };
  for (const d of Object.keys(V1_DIRS)) readDir(path.join(root, d), false);
  readDir(path.join(root, "archive"), true);
  return out;
}

const s = (d: Data, k: string): string => (d[k] === null || d[k] === undefined ? "" : String(d[k]));
const tagsOf = (d: Data): string[] => (Array.isArray(d.tags) ? d.tags : typeof d.tags === "string" && d.tags ? [d.tags] : []);
const firstLine = (text: string) => {
  const [first, ...rest] = text.trim().split("\n");
  return { title: (first ?? "").trim() || "(untitled)", body: rest.join("\n").trim() };
};
const yearOf = (d: Data, today: string) => (s(d, "done_on") || s(d, "updated") || s(d, "created") || today).slice(0, 4);

/** Rules from a v1 principle file: one numbered line each. */
function readRules(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => /^\s*\d+[.)]\s+(.+)$/.exec(l)?.[1]?.trim()).filter((r): r is string => !!r);
}

function gitDirty(base: string, root: string): boolean {
  const r = spawnSync("git", ["status", "--porcelain", "--", root], { cwd: base, encoding: "utf8", windowsHide: true });
  return r.status === 0 && r.stdout.trim() !== "";
}

function tracked(base: string, root: string): boolean {
  const r = spawnSync("git", ["ls-files", "--", root], { cwd: base, encoding: "utf8", windowsHide: true });
  return r.status === 0 && r.stdout.trim() !== "";
}

/**
 * Converts a v1 plan in place. The mapping is mechanical, so code does it; the judgment calls
 * (which principles survive, the someday pile) are left to `wk guide migrate`.
 */
export function migrate(cwd: string, today: string, opts: { home?: string; pick?: (n: number) => number }): Result {
  const found = findRoot(cwd, opts.home);
  if (!found) throw new WkError("No wk plan found to migrate.");
  const { root, base } = found;
  const raw = (yaml.load(fs.readFileSync(path.join(root, CONFIG_FILE), "utf8")) ?? {}) as Record<string, unknown>;
  if (typeof raw.version === "number" && raw.version >= 2) return result(["Already a v2 plan. Nothing to migrate."], { migrated: false });
  const git = repoTop(base) !== null;
  const isTracked = git && tracked(base, root);
  if (isTracked && gitDirty(base, root)) {
    throw new WkError("The plan folder has uncommitted changes. Commit or stash them first, so the conversion is one diff to review.");
  }

  // Read everything v1 first; nothing is touched until the whole plan has been read.
  const items = readV1(root);
  const v1git = (raw.git ?? {}) as Record<string, unknown>;
  const principlesDir = typeof raw.principles_dir === "string" && raw.principles_dir ? raw.principles_dir : "principles";
  const pdir = principlesDir.startsWith("~") ? path.join(os.homedir(), principlesDir.slice(1)) : path.isAbsolute(principlesDir) ? principlesDir : path.join(root, principlesDir);
  const ruleFiles = fs.existsSync(pdir) ? fs.readdirSync(pdir).filter((f) => f.endsWith(".md")) : [];
  const rules = Object.fromEntries(ruleFiles.map((f) => [path.basename(f, ".md").toLowerCase(), readRules(path.join(pdir, f))]).filter(([, r]) => r.length > 0)) as Record<string, string[]>;
  const summary = fs.existsSync(path.join(root, "project.md")) ? fs.readFileSync(path.join(root, "project.md"), "utf8") : "";
  const handoff = fs.existsSync(path.join(root, "handoff.md")) ? fs.readFileSync(path.join(root, "handoff.md"), "utf8") : "";

  // Keep a copy when git can't bring the old plan back.
  let backup: string | null = null;
  if (!isTracked) {
    backup = `${root}.v1-backup`;
    fs.rmSync(backup, { recursive: true, force: true });
    fs.cpSync(root, backup, { recursive: true });
  }
  for (const e of fs.readdirSync(root)) fs.rmSync(path.join(root, e), { recursive: true, force: true });

  const preset = git ? "software" : "general";
  const config = parseConfig({});
  Object.assign(config, defaultConfig(raw.store === "home" || raw.store === "local" || raw.store === "ignore" ? raw.store : "repo", preset));
  const branch = v1git.branch === "epic" ? "project" : (v1git.branch as string);
  config.workflow.git.branch = BRANCH_MODES.includes(branch as BranchMode) ? (branch as BranchMode) : null;
  config.workflow.git.commit = v1git.commit === "checkpoint" ? "check" : ["ask", "task"].includes(v1git.commit as string) ? (v1git.commit as CommitMode) : null;
  const allTags = new Set([...PRESET_SEEDS[preset].tags, ...items.flatMap((i) => tagsOf(i.data))]);
  config.tags = [...allTags].sort();
  fs.writeFileSync(path.join(root, CONFIG_FILE), configText(config));
  ensureLayout(root, config.store);
  fs.writeFileSync(path.join(root, SUMMARY_FILE), summary.trim() ? summary.trim() + "\n" : "");
  fs.writeFileSync(path.join(root, SESSION_FILE), handoff.trim() ? handoff.trim() + "\n" : "");

  const ctx: Ctx = { cwd, base, root, config, today, git, home: wkHome(opts.home), pick: opts.pick };
  const store = new Store(ctx);

  // Areas: one per principle file that has rules.
  const areaNames: Record<string, string> = {};
  for (const tag of Object.keys(rules)) {
    const name = AREA_NAME.test(tag) ? tag : tag.replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "").slice(0, 30) || "rules";
    areaNames[tag] = name;
    if (name !== CORE_AREA && !store.areas().includes(name)) store.createArea(name, `Migrated from v1 principles/${tag}.md.`);
  }
  for (const [tag, list] of Object.entries(rules)) {
    for (const rule of list) {
      const item = store.create("principle", store.area(areaNames[tag]), rule, "", {});
      item.data.instead = "";
      item.data.because = "";
      store.persist(item);
    }
  }

  // Projects: one per epic.
  const projectOf: Record<string, Project> = {};
  const map: Record<string, string> = {};
  for (const e of items.filter((i) => i.kind === "epic")) {
    const tasks = items.filter((i) => s(i.data, "epic") === e.id);
    const touches = [...new Set(tasks.flatMap((t) => tagsOf(t.data)).filter((t) => areaNames[t]).map((t) => areaNames[t]))].filter((a) => a !== CORE_AREA);
    const done = s(e.data, "status") === "done";
    const p = store.createProject(s(e.data, "title") || e.id, e.body, { state: done ? "done" : "open", touches, was: e.id, ...(s(e.data, "ref") ? { ref: s(e.data, "ref") } : {}) });
    for (const k of ["created", "updated", "done_on"]) if (s(e.data, k)) p.data[k] = s(e.data, k);
    store.persistProject(p);
    projectOf[e.id] = p;
    map[e.id] = p.id;
  }
  const homeOf = (i: V1Item): Home => {
    const p = projectOf[s(i.data, "epic")];
    return p ? store.projectHome(p) : store.area(CORE_AREA);
  };

  // Queue order: v1 ranks, else id order.
  const v1rank = (i: V1Item) => (typeof i.data.rank === "number" ? i.data.rank : Number(i.id.split("-")[1]));
  const queued = items.filter((i) => i.kind === "task" && s(i.data, "status") === "next").sort((a, b) => v1rank(a) - v1rank(b));

  const created: { v1: V1Item; item: Item }[] = [];
  for (const i of items.filter((x) => x.kind !== "epic")) {
    const d = i.data;
    const kind: Kind = i.kind === "idea" ? "task" : (i.kind as Kind);
    const parts = i.kind === "task" || i.kind === "decision" ? { title: s(d, "title") || i.id, body: i.body } : firstLine(i.body);
    const data: Data = { was: i.id };
    if (i.kind === "task") {
      const status = s(d, "status");
      data.state = ["now", "review", "done"].includes(status) ? status : "open";
      data.when = status === "later" ? "later" : "queue";
      if (status === "next") data.rank = queued.indexOf(i) + 1;
      if (d.blocked === true) data.wait = s(d, "blocked_reason") || "unblock";
      else if (d.needs_decision === true) data.wait = "decision";
      if (data.wait) data.wait_since = s(d, "updated") || today;
      if (Array.isArray(d.checked)) data.checked = d.checked;
    } else if (i.kind === "idea") {
      data.state = "open";
      data.when = "someday";
    }
    if (tagsOf(d).length) data.tags = tagsOf(d);
    if (s(d, "ref")) data.ref = s(d, "ref");
    const item = store.create(kind, homeOf(i), parts.title, parts.body, data);
    for (const k of ["created", "updated", "done_on"]) if (s(d, k)) item.data[k] = s(d, k);
    store.persist(item);
    created.push({ v1: i, item });
    map[i.id] = item.id;
  }
  // Supersession between decisions, now by new ids.
  for (const { v1, item } of created) {
    if (v1.kind !== "decision") continue;
    for (const k of ["superseded_by", "supersedes"]) if (s(v1.data, k) && map[s(v1.data, k)]) item.data[k] = map[s(v1.data, k)];
    store.persist(item);
  }

  // Archive: finished epics move whole; archived loose items move on their own.
  let archived = 0;
  for (const { v1, item } of created) {
    if (v1.archived && item.home.type === "area") {
      store.archive(item, yearOf(v1.data, today));
      archived++;
    }
  }
  for (const e of items.filter((i) => i.kind === "epic")) {
    if (s(e.data, "status") === "done" || e.archived) {
      store.archiveProject(projectOf[e.id], yearOf(e.data, today));
      archived++;
    }
  }

  const count = (k: V1Item["kind"]) => items.filter((i) => i.kind === k).length;
  const ruleCount = Object.values(rules).reduce((n, r) => n + r.length, 0);
  const lines = [
    `Migrated to v2: ${count("epic")} epics → projects, ${count("task")} tasks, ${count("idea")} ideas → someday tasks, ${count("decision")} decisions, ${count("learning")} learnings.`,
    `${ruleCount} principles in ${Object.keys(rules).length} areas, each still needing instead and because.`,
    `${archived} archived. Old ids still work: wk show T-013.`,
    backup ? `Backup of the v1 plan: ${backup}` : "The v1 plan is in git history.",
    "Next: wk init (refreshes the skills), then follow wk guide migrate with the user.",
  ];
  return result(lines, { migrated: true, map, backup });
}
