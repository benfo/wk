import path from "node:path";
import { result, unescapeText, WkError, type Result } from "../../output.js";
import type { Ctx } from "../context.js";
import { checkLines, LIMITS } from "../limits.js";
import { state } from "../model.js";
import { str, type Item, type Store } from "../store.js";
import { nowTask } from "./flow.js";
import { summary } from "./items.js";
import { plural } from "./shared.js";

/** A jot's title: its first line, cut at a word boundary to the title limit; the full text stays in the body. */
function jotParts(text: string): { title: string; body: string } {
  const [first, ...rest] = text.split("\n");
  if (first.length <= LIMITS.title) return { title: first, body: rest.join("\n") };
  const cut = first.slice(0, LIMITS.title - 1).replace(/\s+\S*$/, "");
  return { title: `${cut || first.slice(0, LIMITS.title - 1)}…`, body: text };
}

/**
 * Captures a thought with no questions: into the inbox, linked to the task it came up in.
 * Sorting happens at the check-in, when the user is out of the zone anyway.
 */
export function jot(ctx: Ctx, store: Store, raw: string, opts: { file?: string[] }): Result {
  const text = checkLines(unescapeText(raw ?? ""), LIMITS.note, "Jot");
  if (!text) throw new WkError("Jot is empty.");
  const { title, body } = jotParts(text);
  const now = nowTask(store);
  const inbox = store.resolveHome("inbox");
  const item = store.create("task", inbox, title, body, { state: "inbox", ...(now ? { from: now.id } : {}) });
  const files = (opts.file ?? []).map((f) => store.attach(item, path.resolve(ctx.cwd, f)));
  const lines = [`Jotted ${item.id} ${title}`];
  if (files.length) lines.push(`Attached: ${files.join(", ")}`);
  return result(lines, { ...summary(item), attached: files });
}

export function inboxItems(store: Store): Item[] {
  return store.list().filter((i) => state(i) === "inbox").sort((a, b) => str(a, "created").localeCompare(str(b, "created")));
}

export function inbox(_ctx: Ctx, store: Store): Result {
  const items = inboxItems(store);
  const lines = items.map((i) => `${i.id} ${i.title}${str(i, "from") ? ` (from ${str(i, "from")})` : ""}`);
  if (lines.length === 0) lines.push("Inbox is empty.");
  else lines.push(`Sort each: wk move <id> --in <home> [--when <when>], or wk drop <id>. Knowledge: wk decide / wk learn, then drop the jot.`);
  return result(lines, items.map(summary));
}

/** `wk check`: what was jotted during this task, for sorting at the check-in. */
export function checkCaptured(_ctx: Ctx, store: Store, item: Item): string[] {
  const captured = inboxItems(store).filter((i) => str(i, "from") === item.id);
  if (captured.length === 0) return [];
  return [
    `Captured: ${plural(captured.length, "jot")} to sort at the check-in, with a suggested home and when for each:`,
    ...captured.slice(0, 5).map((i) => `  ${i.id} ${i.title}`),
  ];
}

/** `wk brief`: how many jots wait for sorting. */
export function briefInbox(_ctx: Ctx, store: Store): string[] {
  const n = inboxItems(store).length;
  return n ? [`Inbox: ${n} to sort (wk inbox).`] : [];
}
