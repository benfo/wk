import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "./context.js";

/**
 * What wk knows about the current agent session: when `wk brief` last ran, which tasks were
 * finished since, the epic of the last task started, and a fresh-session recommendation
 * made at checkpoint. Kept per machine in ~/.wk/sessions/,
 * never in the plan, so a committed `.work/` doesn't churn.
 */
export interface Session {
  started: string;
  done: string[];
  /** The epic of the last task started this session; "" for a task without one. null: none yet. */
  lastEpic: string | null;
  /** The task whose checkpoint this session recommended a fresh session; `wk done` on it says to stop. */
  freshFor: string | null;
}

/** Tasks finished in one session before `wk done` recommends a fresh one. */
export const FRESH_AFTER_TASKS = 3;

function file(ctx: Ctx): string {
  // One file per plan folder, so two clones or stores never share a count.
  const key = createHash("sha1").update(path.resolve(ctx.root).toLowerCase()).digest("hex").slice(0, 12);
  return path.join(ctx.home, "sessions", `${key}.json`);
}

function blank(): Session {
  return { started: new Date().toISOString(), done: [], lastEpic: null, freshFor: null };
}

export function readSession(ctx: Ctx): Session {
  try {
    const raw = JSON.parse(fs.readFileSync(file(ctx), "utf8")) as Partial<Session>;
    return {
      started: typeof raw.started === "string" ? raw.started : blank().started,
      done: Array.isArray(raw.done) ? raw.done.map(String) : [],
      lastEpic: typeof raw.lastEpic === "string" ? raw.lastEpic : null,
      freshFor: typeof raw.freshFor === "string" ? raw.freshFor : null,
    };
  } catch {
    return blank();
  }
}

/** Best effort: session state only shapes advice, so a write failure must never fail a command. */
export function writeSession(ctx: Ctx, session: Session): void {
  try {
    fs.mkdirSync(path.dirname(file(ctx)), { recursive: true });
    fs.writeFileSync(file(ctx), JSON.stringify(session, null, 2) + "\n");
  } catch {
    // ignore
  }
}

/** `wk brief` is the first call of a session, so it starts a new count. */
export function startSession(ctx: Ctx): void {
  writeSession(ctx, blank());
}
