export const LINE_LIMIT = 10;

/** What every command returns. `lines` is the plain-text view, `data` the --json view. */
export interface Result {
  lines: string[];
  data: unknown;
  /** Skip the line cap (used by `wk show`, which prints one item in full). */
  full?: boolean;
}

export class WkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WkError";
  }
}

export function result(lines: string[], data: unknown = { lines }): Result {
  return { lines, data };
}

export function render(res: Result, opts: { json?: boolean; all?: boolean }): string {
  if (opts.json) return JSON.stringify(res.data, null, 2);
  const lines = res.lines;
  if (opts.all || res.full || lines.length <= LINE_LIMIT) return lines.join("\n");
  const keep = lines.slice(0, LINE_LIMIT - 1);
  keep.push(`… ${lines.length - keep.length} more lines (--all)`);
  return keep.join("\n");
}

export function progressBar(done: number, total: number, width = 10): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Lets callers pass multi-line text as a literal "\n" (handy in PowerShell). */
export function unescapeText(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
}
