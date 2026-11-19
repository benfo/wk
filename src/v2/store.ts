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

export class Store {
  private cache: Item[] | null = null;

  constructor(private ctx: Ctx) {}

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
    const prefix = raw.trim().toLowerCase();
    if (!isIdPrefix(prefix)) throw new WkError(`"${raw}" is not an id. Ids look like r8vn.`);
    let matches = this.list().filter((i) => i.id.startsWith(prefix));
    if (matches.length === 0) matches = this.archived().filter((i) => i.id.startsWith(prefix));
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
