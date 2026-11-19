import { lineCount } from "../limits.js";
import { WkError } from "../output.js";

export const LIMITS = {
  title: 70,
  taskBody: 6,
  note: 2, // jots, learnings
  decisionWhy: 2,
  decisionRejected: 1,
  principleBecause: 2,
  areaDescription: 3,
  principlesPerArea: 15,
  handoff: 5,
  summary: 8,
} as const;

/** Refusals name the item and say how far over it is, so the agent knows how much to cut. */
export function checkTitle(title: string, what: string): string {
  const t = title.trim();
  if (!t) throw new WkError(`${what} is empty.`);
  if (t.includes("\n")) throw new WkError(`${what} must be one line.`);
  if (t.length > LIMITS.title) {
    throw new WkError(`${what} is ${t.length} characters, limit is ${LIMITS.title} (${t.length - LIMITS.title} over). Shorten it.`);
  }
  return t;
}

export function checkLines(text: string, max: number, what: string): string {
  const n = lineCount(text);
  if (n > max) throw new WkError(`${what} is ${n} lines, limit is ${max} (${n - max} over). Shorten it.`);
  return text.trim();
}
