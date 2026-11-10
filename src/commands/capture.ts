import type { Ctx } from "../context.js";
import { checkLines, checkTitle, LIMITS } from "../limits.js";
import { result, unescapeText, WkError, type Result } from "../output.js";
import { label, type Store } from "../store.js";
import { isSimilar } from "../similar.js";
import { findSimilar, guardSimilar, openTasks, parseTags, requireEpic } from "./shared.js";

export interface AddTaskOpts {
  epic?: string;
  tags?: string;
  later?: boolean;
  body?: string;
  needsDecision?: boolean;
  force?: boolean;
}

export function addTask(_ctx: Ctx, store: Store, rawTitle: string, opts: AddTaskOpts): Result {
  const title = checkTitle(rawTitle);
  const body = checkLines(unescapeText(opts.body ?? ""), LIMITS.taskBody, "Task body");
  const epic = requireEpic(store, opts.epic);
  guardSimilar(title, [...openTasks(store), ...store.list("idea")], opts.force);
  const item = store.create(
    "task",
    {
      title,
      epic,
      status: opts.later ? "later" : "next",
      tags: parseTags(opts.tags),
      ref: null,
      blocked: false,
      needs_decision: opts.needsDecision === true,
    },
    body,
  );
  return result([`${item.id} ${title}`], { id: item.id, title, status: item.data.status });
}

/** "- [ ] Title", "* Title", "1. Title" and "Title" all give "Title". Blank and # lines are skipped. */
export function parseTitleList(input: string): { line: number; title: string }[] {
  return input
    .split(/\r?\n/)
    .map((raw, i) => ({
      line: i + 1,
      title: raw
        .trim()
        .replace(/^(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim(),
    }))
    .filter(({ title }) => title !== "" && !title.startsWith("#"));
}

/**
 * Adds one task per line, all or nothing: every title is checked against the limits, open
 * tasks and ideas, and the other lines first. Any problem means nothing is added.
 */
export function addTasks(_ctx: Ctx, store: Store, input: string, opts: AddTaskOpts): Result {
  if (opts.body) throw new WkError("--body can't be used with --from. Add notes later with wk edit.");
  const entries = parseTitleList(input);
  if (entries.length === 0) throw new WkError("No titles found. Give one title per line.");
  const epic = requireEpic(store, opts.epic);
  const pool = [...openTasks(store), ...store.list("idea")];
  const problems: string[] = [];
  const accepted: { line: number; title: string }[] = [];
  for (const { line, title } of entries) {
    try {
      checkTitle(title);
    } catch (e) {
      problems.push(`line ${line}: ${(e as Error).message}`);
      continue;
    }
    if (!opts.force) {
      const hit = findSimilar(title, pool)[0];
      if (hit) {
        problems.push(`line ${line}: "${title}" is similar to ${hit.id} ${label(hit)}`);
        continue;
      }
      const twin = accepted.find((a) => isSimilar(a.title, title));
      if (twin) {
        problems.push(`line ${line}: "${title}" is similar to line ${twin.line}`);
        continue;
      }
    }
    accepted.push({ line, title });
  }
  if (problems.length) {
    throw new WkError([`Nothing added. Fix these and rerun (or --force for duplicates):`, ...problems].join("\n"));
  }
  const created = accepted.map(({ title }) =>
    store.create(
      "task",
      {
        title,
        epic,
        status: opts.later ? "later" : "next",
        tags: parseTags(opts.tags),
        ref: null,
        blocked: false,
        needs_decision: opts.needsDecision === true,
      },
      "",
    ),
  );
  const lines = [`Added ${created.length} task${created.length === 1 ? "" : "s"}:`, ...created.map((t) => `${t.id} ${label(t)}`)];
  return result(lines, { added: created.map((t) => ({ id: t.id, title: label(t) })) });
}

export const EPIC_TEMPLATE = "## Scope\n\n## Out of scope\n\n## Acceptance\n";

export function addEpic(_ctx: Ctx, store: Store, rawTitle: string, opts: { tags?: string; force?: boolean }): Result {
  const title = checkTitle(rawTitle);
  guardSimilar(title, store.list("epic").filter((e) => e.data.status !== "done"), opts.force);
  const item = store.create("epic", { title, status: "open", tags: parseTags(opts.tags), ref: null }, EPIC_TEMPLATE);
  return result([`${item.id} ${title}`], { id: item.id, title });
}

export function idea(_ctx: Ctx, store: Store, raw: string, opts: { epic?: string; force?: boolean }): Result {
  const body = checkLines(unescapeText(raw), LIMITS.note, "Idea");
  if (!body) throw new WkError("Idea is empty.");
  const epic = requireEpic(store, opts.epic);
  guardSimilar(body, [...openTasks(store), ...store.list("idea")], opts.force);
  const item = store.create("idea", { epic }, body);
  return result([`Captured as ${item.id}`], { id: item.id, text: body });
}

export function decide(_ctx: Ctx, store: Store, rawWhat: string, opts: { why?: string; rejected?: string }): Result {
  const what = checkTitle(rawWhat, "What");
  if (!opts.why?.trim()) throw new WkError('A decision needs a reason: --why "<why>"');
  const why = checkLines(unescapeText(opts.why), LIMITS.decisionWhy, "Why");
  const rejected = checkLines(unescapeText(opts.rejected ?? ""), LIMITS.decisionRejected, "Rejected");
  let body = `## Why\n\n${why}\n`;
  if (rejected) body += `\n## Rejected\n\n${rejected}\n`;
  const item = store.create("decision", { title: what, status: "active", supersedes: null, superseded_by: null }, body);
  return result([`Recorded ${item.id} ${label(item)}`], { id: item.id, what, why, rejected: rejected || null });
}

export function learn(_ctx: Ctx, store: Store, raw: string): Result {
  const body = checkLines(unescapeText(raw), LIMITS.note, "Learning");
  if (!body) throw new WkError("Learning is empty.");
  const item = store.create("learning", {}, body);
  return result([`Recorded ${item.id}`], { id: item.id, text: body });
}
