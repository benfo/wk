import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "./context.js";
import { str, type Store } from "./store.js";

/**
 * What changed in the plan, and when. Kept per machine in ~/.wk/events/, never in the plan, so a
 * committed plan doesn't churn. The board reads it for its activity feed and timers.
 */
export interface PlanEvent {
  /** ISO timestamp. */
  at: string;
  verb: string;
  id: string;
  title: string;
  /** Area name, project id or "inbox". */
  home: string;
}

const KEEP = 500;

interface Snap {
  kind: string;
  title: string;
  home: string;
  state: string;
  due: string;
  wait: string;
}

export type Snapshot = Map<string, Snap>;

export function eventsFile(ctx: Ctx): string {
  const key = createHash("sha1").update(path.resolve(ctx.root).toLowerCase()).digest("hex").slice(0, 12);
  return path.join(ctx.home, "events", `${key}.jsonl`);
}

/** Items and projects as they stand, keyed by id. */
export function snapshot(store: Store): Snapshot {
  const snap: Snapshot = new Map();
  for (const i of store.list()) {
    snap.set(i.id, { kind: i.kind, title: i.title, home: i.home.name, state: str(i, "state"), due: str(i, "due"), wait: str(i, "wait") });
  }
  for (const p of store.projects()) {
    snap.set(p.id, { kind: "project", title: p.title, home: p.id, state: String(p.data.state ?? ""), due: "", wait: "" });
  }
  return snap;
}

const CREATED: Record<string, string> = { decision: "decided", learning: "learned", principle: "new principle", project: "project started" };
const STATES: Record<string, string> = { now: "started", review: "ready to try", done: "done" };

/** Turns two snapshots into events, in reading order: new, state changes, moves, due, waits, removed. */
export function diff(before: Snapshot, after: Snapshot, archived: (id: string) => boolean): Omit<PlanEvent, "at">[] {
  const created: Omit<PlanEvent, "at">[] = [];
  const changed: Omit<PlanEvent, "at">[] = [];
  const moved: Omit<PlanEvent, "at">[] = [];
  const due: Omit<PlanEvent, "at">[] = [];
  const waits: Omit<PlanEvent, "at">[] = [];
  const removed: Omit<PlanEvent, "at">[] = [];
  const ev = (list: Omit<PlanEvent, "at">[], verb: string, id: string, s: Snap) => list.push({ verb, id, title: s.title, home: s.home });
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) {
      ev(created, a.kind === "task" ? (a.state === "inbox" ? "jotted" : "added") : (CREATED[a.kind] ?? "added"), id, a);
      continue;
    }
    if (a.state !== b.state) {
      if (a.kind === "project") {
        if (a.state === "done") ev(changed, "project closed", id, a);
      } else if (b.state === "inbox" && a.state === "open") ev(changed, "sorted", id, a);
      else if (STATES[a.state]) ev(changed, STATES[a.state], id, a);
      else if (b.state === "now" && a.state === "open") ev(changed, "paused", id, a);
    } else if (a.home !== b.home && a.kind !== "project") ev(moved, "moved", id, a);
    if (a.due && !b.due) ev(due, "due", id, a);
    if (a.wait && !b.wait) ev(waits, "waiting", id, a);
    if (!a.wait && b.wait && a.state !== "done") ev(waits, "no longer waiting", id, a);
  }
  for (const [id, b] of before) {
    if (after.has(id)) continue;
    // A closed project moves to the archive with its items; old done items are archived quietly.
    if (b.kind === "project") ev(removed, "project closed", id, b);
    else if (!archived(id)) ev(removed, "dropped", id, b);
  }
  return [...created, ...changed, ...moved, ...due, ...waits, ...removed];
}
/** Best effort: the log only feeds the board, so a write failure never fails a command. */
export function appendEvents(ctx: Ctx, events: Omit<PlanEvent, "at">[], at = new Date().toISOString()): void {
  if (events.length === 0) return;
  try {
    const file = eventsFile(ctx);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, events.map((e) => JSON.stringify({ at, ...e })).join("\n") + "\n");
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    if (lines.length > KEEP * 1.2) fs.writeFileSync(file, lines.slice(-KEEP).join("\n") + "\n");
  } catch {
    // ignore
  }
}

/** Newest first. */
export function readEvents(ctx: Ctx, limit = KEEP): PlanEvent[] {
  try {
    const lines = fs.readFileSync(eventsFile(ctx), "utf8").split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as PlanEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is PlanEvent => e !== null)
      .reverse();
  } catch {
    return [];
  }
}

/** When an item last did something, e.g. when the now task was started. */
export function lastEvent(events: PlanEvent[], id: string, verb: string): PlanEvent | undefined {
  return events.find((e) => e.id === id && e.verb === verb);
}
