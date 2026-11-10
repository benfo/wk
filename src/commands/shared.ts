import os from "node:os";
import path from "node:path";
import type { Ctx } from "../context.js";
import { WkError } from "../output.js";
import { isSimilar } from "../similar.js";
import { label, str, text, type Item, type Store } from "../store.js";

export const TASK_STATES = ["later", "next", "now", "review", "done"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export function status(item: Item): string {
  return str(item, "status");
}

export function isBlocked(item: Item): boolean {
  return item.data.blocked === true;
}

export function needsDecision(item: Item): boolean {
  return item.data.needs_decision === true;
}

export function openTasks(store: Store): Item[] {
  return store.list("task").filter((t) => status(t) !== "done");
}

export function nowTask(store: Store): Item | undefined {
  return store.list("task").find((t) => status(t) === "now");
}

/** "T-031 Refresh token endpoint [blocked: waiting on API] [needs decision]" */
export function itemLine(item: Item): string {
  let line = `${item.id} ${label(item)}`;
  if (isBlocked(item)) line += str(item, "blocked_reason") ? ` [blocked: ${str(item, "blocked_reason")}]` : " [blocked]";
  if (needsDecision(item)) line += " [needs decision]";
  return line;
}

export function summary(item: Item) {
  return { id: item.id, kind: item.kind, label: label(item), ...item.data, body: item.body, archived: item.archived };
}

/** Stops with "Similar: …" when the text is close to an open task or idea (or an epic, for epics). */
export function findSimilar(candidate: string, pool: Item[]): Item[] {
  return pool.filter((i) => isSimilar(candidate, text(i))).slice(0, 3);
}

export function guardSimilar(candidate: string, pool: Item[], force: boolean | undefined): void {
  if (force) return;
  const hits = findSimilar(candidate, pool);
  if (hits.length === 0) return;
  const lines = hits.map((h) => `Similar: ${h.id} ${label(h)}`);
  lines.push("Update or merge the existing item, or rerun with --force.");
  throw new WkError(lines.join("\n"));
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

export function requireEpic(store: Store, raw: string | undefined): string | null {
  if (!raw) return null;
  return store.get(raw, "epic").id;
}

export function principlesDir(ctx: Ctx): string {
  const dir = ctx.config.principles_dir;
  if (dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\")) return path.join(os.homedir(), dir.slice(1));
  return path.isAbsolute(dir) ? dir : path.join(ctx.root, dir);
}

export function assertState(item: Item, allowed: string[], action: string): void {
  if (!allowed.includes(status(item))) {
    throw new WkError(`${item.id} is ${status(item) || "unknown"}; cannot ${action}.`);
  }
}
