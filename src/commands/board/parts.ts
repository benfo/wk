import { isDue, isQueued, isWaiting, state, triggerOf, when } from "../../model.js";
import { str, type Item, type Store } from "../../store.js";

/** Small HTML pieces every part of the board shares. */

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface View {
  homeNames: Record<string, string>;
  /** Each project's colour slot, in plan order, so a project keeps its colour when others close. */
  hues: Record<string, number>;
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

/** "Story across the eras: the Kestrel thread" fits a chip as "Story across the eras". */
export function shortName(name: string): string {
  return name.replace(/:.*$/, "");
}

/** A key that changes when the row's meaning changes, so the live page can flash what's new. */
export function key(item: Item): string {
  return esc(`${item.id}:${str(item, "state")}:${str(item, "when")}:${str(item, "due")}:${str(item, "wait")}:${item.title}`);
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

export function testsOf(item: Item): string[] {
  return item.body.split("\n").filter((l) => /^Test:\s*/i.test(l)).map((l) => l.replace(/^Test:\s*/i, ""));
}

/** Where a task stands. Each has its own icon shape, so colour is never the only signal. */
export type Kind = "now" | "review" | "due" | "todo" | "waiting" | "sleeping" | "later" | "inbox" | "done";

export const KIND_LABEL: Record<Kind, string> = {
  now: "In progress",
  review: "Ready to try",
  due: "Due",
  todo: "Up next",
  waiting: "Waiting",
  sleeping: "Sleeping",
  later: "Later",
  inbox: "Inbox",
  done: "Done",
};

export function kindOf(t: Item): Kind {
  const s = state(t);
  if (s === "now") return "now";
  if (s === "review") return "review";
  if (s === "done") return "done";
  if (s === "inbox") return "inbox";
  if (isDue(t)) return "due";
  if (isWaiting(t)) return "waiting";
  if (isQueued(t)) return "todo";
  if (triggerOf(when(t))) return "sleeping";
  return "later";
}

/**
 * Status icons in the manner of an issue tracker: an empty ring to do, half full in progress, a tick when done.
 * Drawn in currentColor; each status sets its own colour (`.s-<kind>` in the stylesheet), so the shape and the
 * colour say the same thing.
 */
export function icon(kind: Kind): string {
  const ring = (dash = "") => `<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"${dash}/>`;
  const line = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`;
  const body: Record<Kind, string> = {
    later: ring(' stroke-dasharray="2.2 2.2"'),
    inbox: ring(' stroke-dasharray="2.2 2.2"') + '<circle cx="7" cy="7" r="1.6" fill="currentColor"/>',
    sleeping: ring(' stroke-dasharray="0.6 2.6" stroke-linecap="round"'),
    todo: ring(),
    waiting: ring() + line("M5.6 5v4M8.4 5v4"),
    due: ring() + line("M7 4.2V7.4l2 1.2"),
    now: ring() + '<path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor"/>',
    review: ring() + '<path d="M7 3.5A3.5 3.5 0 1 1 3.5 7H7Z" fill="currentColor"/>',
    done: '<circle cx="7" cy="7" r="6.25" fill="currentColor"/><path d="M4.4 7.2 6.2 9l3.5-3.7" fill="none" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  return `<svg class="ic s-${kind}" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="${KIND_LABEL[kind]}">${body[kind]}</svg>`;
}

/** Six project colours; a project keeps its colour wherever it shows (chips, rings). Areas stay grey. */
const HUES = 6;

/** The style that gives an element its project's colour, or nothing for an area. */
export function hue(v: View, home: string): string {
  const n = v.hues[home];
  return n === undefined ? "" : ` style="--pc:var(--p${(n % HUES) + 1})"`;
}

/** Where an item lives, as a small chip in its project's colour. */
export function chip(v: View, item: Item): string {
  return `<span class="chip"${hue(v, item.home.name)}>${esc(shortName(homeLabel(v, item)))}</span>`;
}

/** Project progress as a small ring that fills clockwise, in the project's colour when `style` gives one. */
export function ring(done: number, total: number, size = 16, style = ""): string {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const f = total ? done / total : 0;
  const mid = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${done} of ${total} done"${style}><circle cx="${mid}" cy="${mid}" r="${r}" fill="none" class="ring-track" stroke-width="2"/><circle cx="${mid}" cy="${mid}" r="${r}" fill="none" class="ring-fill" stroke-width="2" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${mid} ${mid})"/></svg>`;
}

/** One task: status icon, title (with an optional note under it), then quiet facts and its project on the right. */
export function row(v: View, t: Item, opts: { project?: boolean; right?: string; note?: string; kind?: Kind } = {}): string {
  const note = opts.note ? `<div class="note">${opts.note}</div>` : "";
  const right = opts.right ? `<span class="m">${opts.right}</span>` : "";
  return `<li class="r" data-key="${key(t)}" title="id ${t.id}">${icon(opts.kind ?? kindOf(t))}<div class="body"><div class="tt">${esc(t.title)}</div>${note}</div>${right}${opts.project === false ? "" : chip(v, t)}</li>`;
}

/** A status group: a header bar with the icon, name and count, then its rows. Folds like a tracker's groups. */
export function group(kind: Kind | null, name: string, count: number, rows: string, opts: { tone?: string; open?: boolean } = {}): string {
  if (!count) return "";
  return `<details class="g${kind ? ` s-${kind}` : ""}${opts.tone ? ` ${opts.tone}` : ""}"${opts.open === false ? "" : " open"}><summary>${kind ? icon(kind) : ""}<b>${esc(name)}</b><span class="c">${count}</span></summary><ul>${rows}</ul></details>`;
}

/** The first few rows, then the rest behind "N more". */
export function capped(rows: string[], show: number): string {
  if (rows.length <= show + 1) return rows.join("");
  return `${rows.slice(0, show).join("")}<li><details class="more"><summary>${rows.length - show} more</summary><ul>${rows.slice(show).join("")}</ul></details></li>`;
}
