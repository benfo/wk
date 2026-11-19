import fs from "node:fs";
import path from "node:path";
import { parse, stringify, type Data } from "../frontmatter.js";
import { WkError } from "../output.js";
import type { Ctx } from "./context.js";
import { ID_DIR, ITEM_FILE, isIdPrefix, newId, slugify } from "./ids.js";

export const KINDS = ["task", "decision", "learning", "principle"] as const;
export type Kind = (typeof KINDS)[number];

export const INBOX_DIR = "inbox";
export const AREAS_DIR = "areas";
export const PROJECTS_DIR = "projects";
export const ARCHIVE_DIR = "archive";
export const AREA_FILE = "area.md";
export const CORE_AREA = "core";

/** Frontmatter key order, so files read the same and diffs stay small. */
const ORDER = ["id", "kind", "state", "when", "tags", "from", "links", "rank", "wait", "ref", "created", "updated", "done_on"];

export interface Home {
  type: "inbox" | "area" | "project";
  /** The area name, the project id, or "inbox". */
  name: string;
  dir: string;
}

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  data: Data;
  file: string;
  home: Home;
  archived: boolean;
}

export function str(item: Item, key: string): string {
  const v = item.data[key];
  return v === null || v === undefined ? "" : String(v);
}

export function tagsOf(item: Item): string[] {
  const v = item.data.tags;
  return Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
}

/** The title is the body's first `# ` heading; the rest is the body. */
function splitTitle(text: string): { title: string; body: string } {
  const m = /^# (.*)\r?\n?/.exec(text);
  if (!m) return { title: "", body: text };
  return { title: m[1].trim(), body: text.slice(m[0].length).replace(/^\s*\n/, "").trimEnd() };
}

function joinTitle(title: string, body: string): string {
  return body.trim() ? `# ${title}\n\n${body.trim()}` : `# ${title}`;
}

export const PROJECT_FILE = "project.md";
const PROJECT_ORDER = ["id", "kind", "state", "touches", "was", "ref", "created", "updated", "done_on"];
export const AREA_NAME = /^[a-z0-9][a-z0-9-]{0,29}$/;

export interface Project {
  id: string;
  title: string;
  body: string;
  data: Data;
  dir: string;
  archived: boolean;
}

export function touchesOf(p: Project): string[] {
  const v = p.data.touches;
  return Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
}

export class Store {
  private cache: Item[] | null = null;
  private projectCache: Project[] | null = null;

  constructor(private ctx: Ctx) {}

  get root(): string {
    return this.ctx.root;
  }

  private readProject(dir: string, archived: boolean): Project | null {
    const m = ID_DIR.exec(path.basename(dir));
    const file = path.join(dir, PROJECT_FILE);
    if (!m || !fs.existsSync(file)) return null;
    const { data, body } = parse(fs.readFileSync(file, "utf8"));
    const split = splitTitle(body);
    return { id: m[1], title: split.title, body: split.body, data: { ...data, id: m[1] }, dir, archived };
  }

  /** Open and closed projects that aren't archived. */
  projects(): Project[] {
    if (!this.projectCache) {
      const dir = path.join(this.ctx.root, PROJECTS_DIR);
      this.projectCache = fs.existsSync(dir)
        ? fs.readdirSync(dir).map((d) => this.readProject(path.join(dir, d), false)).filter((p): p is Project => p !== null)
        : [];
    }
    return this.projectCache;
  }

  archivedProjects(): Project[] {
    const out: Project[] = [];
    const dir = path.join(this.ctx.root, ARCHIVE_DIR);
    if (!fs.existsSync(dir)) return out;
    for (const year of fs.readdirSync(dir)) {
      const yd = path.join(dir, year);
      if (!fs.statSync(yd).isDirectory()) continue;
      for (const d of fs.readdirSync(yd)) {
        const p = this.readProject(path.join(yd, d), true);
        if (p) out.push(p);
      }
    }
    return out;
  }

  project(raw: string): Project {
    const prefix = raw.trim().toLowerCase();
    const all = this.projects();
    let hits = all.filter((p) => p.id.startsWith(prefix) || p.data.was === raw.trim().toUpperCase());
    if (hits.length === 0) hits = this.archivedProjects().filter((p) => p.id.startsWith(prefix));
    if (hits.length === 0) throw new WkError(`No project ${raw}.`);
    if (hits.length > 1) throw new WkError(`${prefix} matches ${hits.length} projects: ${hits.map((p) => p.id).join(", ")}. Type more of the id.`);
    return hits[0];
  }

  projectHome(p: Project): Home {
    return { type: "project", name: p.id, dir: p.dir };
  }

  /** "inbox", an area name, or a project id (any unique start of it). */
  resolveHome(raw: string): Home {
    const w = raw.trim().toLowerCase();
    if (w === "inbox") return { type: "inbox", name: "inbox", dir: path.join(this.ctx.root, INBOX_DIR) };
    if (this.areas().includes(w)) return this.area(w);
    const projects = this.projects().filter((p) => p.id.startsWith(w) && p.data.state !== "done");
    if (projects.length === 1) return this.projectHome(projects[0]);
    if (projects.length > 1) throw new WkError(`${w} matches ${projects.length} projects. Type more of the id.`);
    throw new WkError(`No home "${raw}". Use inbox, an area (${this.areas().join(", ")}) or an open project id.`);
  }

  createProject(title: string, body: string, data: Data): Project {
    const id = newId(this.takenIds(), this.ctx.pick);
    const dir = path.join(this.ctx.root, PROJECTS_DIR, `${id}-${slugify(title)}`);
    const p: Project = { id, title, body, data: { id, kind: "project", ...data, created: this.ctx.today, updated: this.ctx.today }, dir, archived: false };
    this.writeProject(p);
    this.projects().push(p);
    return p;
  }

  saveProject(p: Project): void {
    p.data.updated = this.ctx.today;
    const want = path.join(path.dirname(p.dir), `${p.id}-${slugify(p.title)}`);
    if (want !== p.dir) {
      fs.renameSync(p.dir, want);
      p.dir = want;
      this.cache = null;
    }
    this.writeProject(p);
  }

  private writeProject(p: Project): void {
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(path.join(p.dir, PROJECT_FILE), stringify(p.data, joinTitle(p.title, p.body), PROJECT_ORDER));
  }

  /** Moves a closed project's whole folder to archive/<year>/. */
  archiveProject(p: Project, year: string): void {
    const dest = path.join(this.ctx.root, ARCHIVE_DIR, year, path.basename(p.dir));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(p.dir, dest);
    p.dir = dest;
    p.archived = true;
    this.cache = null;
    this.projectCache = null;
  }

  createArea(name: string, description: string): Home {
    if (!AREA_NAME.test(name)) throw new WkError(`Area names are lowercase letters, digits and dashes, like ui or front-end.`);
    if (this.areas().includes(name)) throw new WkError(`Area ${name} already exists.`);
    const dir = path.join(this.ctx.root, AREAS_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, AREA_FILE), `# ${name}\n\n${description}\n`);
    return { type: "area", name, dir };
  }

  areaDescription(name: string): string {
    const file = path.join(this.ctx.root, AREAS_DIR, name, AREA_FILE);
    return fs.existsSync(file) ? splitTitle(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).body.trim() : "";
  }

  /** Files that travel with an item: `<id>-<n>.<ext>` next to it. */
  attachments(item: Item): string[] {
    const dir = path.dirname(item.file);
    if (!fs.existsSync(dir)) return [];
    const re = new RegExp(`^${item.id}-\\d+\\.[a-z0-9]+$`, "i");
    return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f));
  }

  /** Copies a file next to the item as `<id>-<n>.<ext>` and lists it in `files`. */
  attach(item: Item, source: string): string {
    if (!fs.existsSync(source)) throw new WkError(`File not found: ${source}`);
    const n = this.attachments(item).length + 1;
    const name = `${item.id}-${n}${path.extname(source).toLowerCase() || ".bin"}`;
    fs.copyFileSync(source, path.join(path.dirname(item.file), name));
    const files = Array.isArray(item.data.files) ? item.data.files : [];
    item.data.files = [...files, name];
    this.write(item);
    return name;
  }

  /** Moves an item, and its attachments, to another home. */
  moveTo(item: Item, home: Home): void {
    if (item.home.dir === home.dir) return;
    fs.mkdirSync(home.dir, { recursive: true });
    for (const f of this.attachments(item)) fs.renameSync(f, path.join(home.dir, path.basename(f)));
    const dest = path.join(home.dir, path.basename(item.file));
    fs.renameSync(item.file, dest);
    item.file = dest;
    item.home = home;
  }

  /** Moves a finished item to archive/<year>/<home path>/, attachments too. */
  archive(item: Item, year: string): void {
    const rel = path.relative(this.ctx.root, path.dirname(item.file));
    const dir = path.join(this.ctx.root, ARCHIVE_DIR, year, rel);
    this.moveTo(item, { ...item.home, dir });
    item.archived = true;
    this.cache = (this.cache ?? []).filter((i) => i !== item);
  }

  remove(item: Item): void {
    for (const f of this.attachments(item)) fs.rmSync(f);
    fs.rmSync(item.file);
    this.cache = (this.cache ?? []).filter((i) => i !== item);
  }

  private homeDirs(): Home[] {
    const root = this.ctx.root;
    const homes: Home[] = [{ type: "inbox", name: "inbox", dir: path.join(root, INBOX_DIR) }];
    for (const name of this.areas()) homes.push({ type: "area", name, dir: path.join(root, AREAS_DIR, name) });
    const projects = path.join(root, PROJECTS_DIR);
    if (fs.existsSync(projects)) {
      for (const d of fs.readdirSync(projects)) {
        const m = ID_DIR.exec(d);
        if (m) homes.push({ type: "project", name: m[1], dir: path.join(projects, d) });
      }
    }
    return homes;
  }

  private read(file: string, home: Home, archived: boolean): Item | null {
    const m = ITEM_FILE.exec(path.basename(file));
    if (!m) return null;
    const { data, body } = parse(fs.readFileSync(file, "utf8"));
    const split = splitTitle(body);
    const kind = (KINDS as readonly string[]).includes(String(data.kind)) ? (data.kind as Kind) : "task";
    return { id: m[1], kind, title: split.title, body: split.body, data: { ...data, id: m[1] }, file, home, archived };
  }

  /** Names of the areas, from folders under areas/ that hold an area.md. */
  areas(): string[] {
    const dir = path.join(this.ctx.root, AREAS_DIR);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, AREA_FILE))).sort();
  }

  area(name: string): Home {
    if (!this.areas().includes(name)) throw new WkError(`No area "${name}". Areas: ${this.areas().join(", ")}`);
    return { type: "area", name, dir: path.join(this.ctx.root, AREAS_DIR, name) };
  }

  /** Every item that isn't archived. */
  list(): Item[] {
    if (!this.cache) {
      this.cache = [];
      for (const home of this.homeDirs()) {
        if (!fs.existsSync(home.dir)) continue;
        for (const f of fs.readdirSync(home.dir)) {
          const item = this.read(path.join(home.dir, f), home, false);
          if (item) this.cache.push(item);
        }
      }
    }
    return this.cache;
  }

  /** Archived items, read on demand: only lookups by id and `--archived` lists need them. */
  archived(): Item[] {
    const out: Item[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else {
          const home: Home = { type: "area", name: path.basename(dir), dir };
          const item = this.read(p, home, true);
          if (item) out.push(item);
        }
      }
    };
    walk(path.join(this.ctx.root, ARCHIVE_DIR));
    return out;
  }

  /** Every id in use anywhere in the plan, archive and project folders included. */
  private takenIds(): Set<string> {
    const taken = new Set<string>();
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const m = (e.isDirectory() ? ID_DIR : ITEM_FILE).exec(e.name);
        if (m) taken.add(m[1]);
        if (e.isDirectory()) walk(path.join(dir, e.name));
      }
    };
    walk(this.ctx.root);
    return taken;
  }

  /** Finds an item by its id or any unique start of it. */
  get(raw: string): Item {
    // A v1 id, kept as `was` by wk migrate, so old commit messages and handoffs still resolve.
    // "T-013" is always a v1 id; "t13" only when no v2 id starts that way ("d869" is a fine v2 id).
    const v1 = /^([ETIDL])(-?)(\d+)$/i.exec(raw.trim());
    const byWas = () => {
      const was = `${v1![1].toUpperCase()}-${v1![3].padStart(3, "0")}`;
      const hit = this.list().find((i) => i.data.was === was) ?? this.archived().find((i) => i.data.was === was);
      if (!hit) throw new WkError(`No item ${was}.`);
      return hit;
    };
    if (v1 && v1[2] === "-") return byWas();
    const prefix = raw.trim().toLowerCase();
    if (!isIdPrefix(prefix)) {
      if (v1) return byWas();
      throw new WkError(`"${raw}" is not an id. Ids look like r8vn.`);
    }
    let matches = this.list().filter((i) => i.id.startsWith(prefix));
    if (matches.length === 0) matches = this.archived().filter((i) => i.id.startsWith(prefix));
    if (matches.length === 0 && v1) return byWas();
    if (matches.length === 0) throw new WkError(`No item ${prefix}.`);
    if (matches.length > 1) {
      const ids = matches.slice(0, 5).map((i) => i.id).join(", ");
      throw new WkError(`${prefix} matches ${matches.length} items: ${ids}. Type more of the id.`);
    }
    return matches[0];
  }

  create(kind: Kind, home: Home, title: string, body: string, data: Data): Item {
    const id = newId(this.takenIds(), this.ctx.pick);
    const today = this.ctx.today;
    const item: Item = {
      id,
      kind,
      title,
      body,
      data: { id, kind, ...data, created: today, updated: today },
      file: path.join(home.dir, `${id}-${slugify(title)}.md`),
      home,
      archived: false,
    };
    this.write(item);
    this.list().push(item);
    return item;
  }

  /** Saves an item, renaming its file when the title changed. */
  save(item: Item): void {
    item.data.updated = this.ctx.today;
    const want = path.join(path.dirname(item.file), `${item.id}-${slugify(item.title)}.md`);
    if (want !== item.file) {
      fs.renameSync(item.file, want);
      item.file = want;
    }
    this.write(item);
  }

  private write(item: Item): void {
    fs.mkdirSync(path.dirname(item.file), { recursive: true });
    fs.writeFileSync(item.file, stringify(item.data, joinTitle(item.title, item.body), ORDER));
  }
}
