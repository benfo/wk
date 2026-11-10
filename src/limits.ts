import { WkError } from "./output.js";

export const LIMITS = {
  title: 70,
  taskBody: 6,
  decisionWhy: 2,
  decisionRejected: 1,
  note: 2, // ideas and learnings
  handoff: 5,
  project: 8,
} as const;

export function lineCount(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split("\n").length;
}

export function checkTitle(title: string, what = "Title"): string {
  const t = title.trim();
  if (!t) throw new WkError(`${what} is empty.`);
  if (t.includes("\n")) throw new WkError(`${what} must be one line.`);
  if (t.length > LIMITS.title) {
    throw new WkError(`${what} is ${t.length} characters, limit is ${LIMITS.title}. Shorten it.`);
  }
  return t;
}

export function checkLines(text: string, max: number, what: string): string {
  const n = lineCount(text);
  if (n > max) throw new WkError(`${what} is ${n} lines, limit is ${max}. Shorten it.`);
  return text.trim();
}
