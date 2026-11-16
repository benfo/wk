import fs from "node:fs";
import path from "node:path";
import { writeCounters, type Prefix } from "./config.js";
import type { Ctx } from "./context.js";
import { parse, stringify, type Data } from "./frontmatter.js";
import { WkError } from "./output.js";

export type Kind = "epic" | "task" | "idea" | "decision" | "learning";

interface KindInfo {
  prefix: Prefix;
  dir: string;
  order: string[];
}

export const KINDS: Record<Kind, KindInfo> = {
  epic: { prefix: "E", dir: "epics", order: ["id", "title", "status", "tags", "ref", "created", "updated", "done_on"] },
  task: {
    prefix: "T",
    dir: "tasks",
    order: [
      "id", "title", "epic", "status", "rank", "tags", "ref", "blocked", "blocked_reason", "needs_decision", "checked",
      "created", "updated", "done_on",
    ],
  },
  idea: { prefix: "I", dir: "ideas", order: ["id", "epic", "created", "updated"] },
  decision: {
    prefix: "D",
    dir: "decisions",
    order: ["id", "title", "status", "supersedes", "superseded_by", "created", "updated"],
  },
  learning: { prefix: "L", dir: "learnings", order: ["id", "created", "updated"] },
};

export const ARCHIVE_DIR = "archive";

const BY_PREFIX: Record<string, Kind> = Object.fromEntries(
  Object.entries(KINDS).map(([kind, info]) => [info.prefix, kind as Kind]),
);

export interface Item {
  kind: Kind;
  id: string;
  data: Data;
  body: string;
  file: string;
  archived: boolean;
}

export function formatId(prefix: Prefix, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** Accepts "t-31", "T31" or "T-031" and returns "T-031", or null if it is not an id. */
export function normaliseId(raw: string): string | null {
  const m = /^([ETIDL])-?(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return formatId(m[1].toUpperCase() as Prefix, Number(m[2]));
}

export function kindOf(id: string): Kind {
  return BY_PREFIX[id[0]];
}

function idNumber(id: string): number {
  return Number(id.split("-")[1]);
}

/** A task's place in the queue: its `rank` once moved with `wk move`, else its id number. */
export function queueRank(item: Item): number {
  const r = item.data.rank;
  return typeof r === "number" ? r : idNumber(item.id);
}

export function str(item: Item, key: string): string {
  const v = item.data[key];
  return v === null || v === undefined ? "" : String(v);
}

export function tags(item: Item): string[] {
  const v = item.data.tags;
  return Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
}

/** The one-line label used in lists: the title, or the first line of an idea or learning. */
export function label(item: Item): string {
  const t = str(item, "title");
  if (t) return t;
  const first = item.body.split("\n")[0] ?? "";
  return first.length > 70 ? first.slice(0, 69) + "…" : first;
}

/** The text compared for duplicates: the title, or the whole body for ideas and learnings. */
export function text(item: Item): string {
  return str(item, "title") || item.body;
}

export class Store {
  private cache = new Map<string, Item[]>();

  constructor(private ctx: Ctx) {}

  private dirFor(kind: Kind): string {
    return path.join(this.ctx.root, KINDS[kind].dir);
  }

  private read(file: string, archived: boolean): Item | null {
    const id = normaliseId(path.basename(file, ".md"));
    if (!id) return null;
    const { data, body } = parse(fs.readFileSync(file, "utf8"));
    return { kind: kindOf(id), id, data: { ...data, id }, body, file, archived };
  }

  private readDir(dir: string, archived: boolean): Item[] {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => this.read(path.join(dir, f), archived))
      .filter((i): i is Item => i !== null);
  }

  private archivedItems(): Item[] {
    if (!this.cache.has("archive")) this.cache.set("archive", this.readDir(path.join(this.ctx.root, ARCHIVE_DIR), true));
    return this.cache.get("archive")!;
  }

  /** Active items of a kind, sorted by id (tasks by queue rank). `archived: true` lists archived ones, "both" lists all. */
  list(kind: Kind, opts: { archived?: boolean | "both" } = {}): Item[] {
    if (!this.cache.has(kind)) this.cache.set(kind, this.readDir(this.dirFor(kind), false));
    const active = this.cache.get(kind)!.filter((i) => i.kind === kind);
    const archived = this.archivedItems().filter((i) => i.kind === kind);
    const picked = opts.archived === true ? archived : opts.archived === "both" ? [...active, ...archived] : active;
    return [...picked].sort((a, b) => kind === "task" ? queueRank(a) - queueRank(b) : idNumber(a.id) - idNumber(b.id));
  }

  find(raw: string): Item | undefined {
    const id = normaliseId(raw);
    if (!id) return undefined;
    return this.list(kindOf(id), { archived: "both" }).find((i) => i.id === id);
  }

  get(raw: string, expect?: Kind | Kind[]): Item {
    const id = normaliseId(raw);
    if (!id) throw new WkError(`"${raw}" is not an id. Ids look like T-031.`);
    const item = this.find(id);
    if (!item) throw new WkError(`${id} not found.`);
    const allowed = expect === undefined ? null : Array.isArray(expect) ? expect : [expect];
    if (allowed && !allowed.includes(item.kind)) {
      throw new WkError(`${id} is a ${item.kind}, expected ${allowed.join(" or ")}.`);
    }
    return item;
  }

  create(kind: Kind, data: Data, body: string): Item {
    const { prefix } = KINDS[kind];
    const counters = { ...this.ctx.config.counters };
    let n = counters[prefix] + 1;
    // Never clobber a file, even if the counter was edited by hand.
    while (this.find(formatId(prefix, n))) n++;
    counters[prefix] = n;
    const id = formatId(prefix, n);
    const today = this.ctx.today;
    const item: Item = {
      kind,
      id,
      data: { id, ...data, created: today, updated: today },
      body,
      file: path.join(this.dirFor(kind), `${id}.md`),
      archived: false,
    };
    this.write(item);
    writeCounters(this.ctx.root, counters);
    this.ctx.config.counters = counters;
    this.list(kind); // make sure the cache exists before adding to it
    this.cache.get(kind)!.push(item);
    return item;
  }

  save(item: Item): void {
    item.data.updated = this.ctx.today;
    this.write(item);
  }

  private write(item: Item): void {
    fs.mkdirSync(path.dirname(item.file), { recursive: true });
    fs.writeFileSync(item.file, stringify(item.data, item.body, KINDS[item.kind].order));
  }

  archive(item: Item): void {
    if (item.archived) return;
    const dest = path.join(this.ctx.root, ARCHIVE_DIR, path.basename(item.file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(item.file, dest);
    this.drop(item);
    item.file = dest;
    item.archived = true;
    this.archivedItems().push(item);
  }

  remove(item: Item): void {
    fs.rmSync(item.file);
    this.drop(item);
  }

  private drop(item: Item): void {
    const key = item.archived ? "archive" : item.kind;
    const list = this.cache.get(key);
    if (list) this.cache.set(key, list.filter((i) => i !== item));
  }
}
