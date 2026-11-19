import { isQueued, when } from "../../model.js";
import { str, type Item, type Store } from "../../store.js";

/** Small HTML pieces every part of the board shares. */

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface View {
  homeNames: Record<string, string>;
}

/** "Name: Daily Dad Joke CLI" reads better as "Daily Dad Joke CLI". */
export function headline(summary: string, fallback: string): string {
  const first = summary.split("\n")[0]?.trim() ?? "";
  const text = first.replace(/^[A-Za-z][\w ]{0,20}:\s+/, "") || fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function homeLabel(v: View, item: Item): string {
  return v.homeNames[item.home.name] ?? item.home.name;
}

/** One quiet line under a title: why it's listed, where it lives and its timing. Ids stay in hover titles. */
export function meta(v: View, item: Item, opts: { home?: boolean; when?: boolean; kind?: string } = {}): string {
  const parts: string[] = [];
  if (opts.kind) parts.push(`<span class="kind">${esc(opts.kind)}</span>`);
  if (opts.home !== false) parts.push(`<span>${esc(homeLabel(v, item))}</span>`);
  if (opts.when && when(item) && !isQueued(item)) parts.push(`<span class="when">${esc(when(item))}</span>`);
  return parts.length ? `<div class="meta">${parts.join("")}</div>` : "";
}

/** A key that changes when the row's meaning changes, so the live page can flash what's new. */
export function key(item: Item): string {
  return esc(`${item.id}:${str(item, "state")}:${str(item, "when")}:${str(item, "due")}:${str(item, "wait")}:${item.title}`);
}

export function row(v: View, item: Item, opts: { home?: boolean; when?: boolean; kind?: string; note?: string; since?: string } = {}): string {
  const note = opts.note ? `<div class="note">${esc(opts.note)}</div>` : "";
  const since = opts.since ? `<div class="note">${opts.since}</div>` : "";
  return `<li class="row" data-key="${key(item)}" title="${item.id}"><div class="title">${esc(item.title)}</div>${meta(v, item, opts)}${note}${since}</li>`;
}

/** A one-line row: just the title, for long lists like what got done. */
export function line(item: Item): string {
  return `<li class="line" data-key="${key(item)}" title="${item.id}">${esc(item.title)}</li>`;
}

/** "just now", "12 min", "3 h", "2 d": short enough for a glance. */
export function ago(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / (60 * 24))} d`;
}

/** A relative time the live page keeps ticking; `prefix` and `suffix` wrap the number. */
export function clock(iso: string, nowMs: number, prefix = "", suffix = ""): string {
  const t = ago(iso, nowMs);
  const text = t === "just now" ? (suffix ? `${prefix}just now` : `${prefix}a moment`) : `${prefix}${t}${suffix}`;
  return `<time class="ago" datetime="${esc(iso)}" data-prefix="${esc(prefix)}" data-suffix="${esc(suffix)}">${esc(text)}</time>`;
}

/** Plain words for a trigger: when a sleeping item comes back. */
export function wakeLabel(v: View, store: Store, w: string): string {
  const [kind, arg] = [w.slice(0, w.indexOf(":")), w.slice(w.indexOf(":") + 1)];
  if (kind === "after") {
    const target = store.list().find((i) => i.id === arg);
    return `After “${target ? target.title : arg}” is done`;
  }
  if (kind === "end") return `When ${v.homeNames[arg] ?? arg} ends`;
  if (kind === "start") return `Next time work starts in ${arg}`;
  if (kind === "on") return `On ${arg}`;
  return w;
}

export function bar(done: number, total: number, long = false): string {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const label = long ? `${done} of ${total} tasks done` : `${done}/${total}`;
  return `<div class="progress"><div class="bar" role="img" aria-label="${done} of ${total} done"><span style="width:${pct}%"></span></div><span class="num">${label}</span></div>`;
}

export function group(title: string, items: string[], opts: { tone?: string; count?: number } = {}): string {
  if (items.length === 0) return "";
  const count = opts.count ?? items.length;
  return `<section class="group${opts.tone ? ` ${opts.tone}` : ""}"><h3>${esc(title)}<span class="pill">${count}</span></h3><ul>${items.join("")}</ul></section>`;
}

export function testsOf(item: Item): string[] {
  return item.body.split("\n").filter((l) => /^Test:\s*/i.test(l)).map((l) => l.replace(/^Test:\s*/i, ""));
}
