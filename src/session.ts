import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nowIso, type Ctx } from "./context.js";

/**
 * What wk knows about the current agent session. Kept per machine in ~/.wk/sessions/, never in
 * the plan, so a committed `.work/` doesn't churn.
 */
export interface Session {
  started: string;
  done: string[];
  /** Home of the last task started this session; null: none yet. */
  lastHome: string | null;
  /** The task whose check recommended a fresh session; `wk done` on it says to stop. */
  freshFor: string | null;
  /** Areas already asked about missing principles this session. */
  asked: string[];
}

/** Tasks finished in one session before `wk done` recommends a fresh one. */
export const FRESH_AFTER_TASKS = 3;

function file(ctx: Ctx): string {
  const key = createHash("sha1").update(path.resolve(ctx.root).toLowerCase()).digest("hex").slice(0, 12);
  return path.join(ctx.home, "sessions", `v2-${key}.json`);
}

function blank(): Session {
  return { started: nowIso(), done: [], lastHome: null, freshFor: null, asked: [] };
}

export function readSession(ctx: Ctx): Session {
  try {
    const raw = JSON.parse(fs.readFileSync(file(ctx), "utf8")) as Partial<Session>;
    return {
      started: typeof raw.started === "string" ? raw.started : blank().started,
      done: Array.isArray(raw.done) ? raw.done.map(String) : [],
      lastHome: typeof raw.lastHome === "string" ? raw.lastHome : null,
      freshFor: typeof raw.freshFor === "string" ? raw.freshFor : null,
      asked: Array.isArray(raw.asked) ? raw.asked.map(String) : [],
    };
  } catch {
    return blank();
  }
}

/** Best effort: session state only shapes advice, so a write failure never fails a command. */
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
