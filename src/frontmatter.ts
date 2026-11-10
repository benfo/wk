import matter from "gray-matter";

export type Value = string | number | boolean | null | string[] | undefined;
export type Data = Record<string, Value>;

/** Parses a markdown file with YAML frontmatter. Dates come back as YYYY-MM-DD strings. */
export function parse(text: string): { data: Data; body: string } {
  // Passing options disables gray-matter's content cache, so callers can mutate the result.
  const parsed = matter(text, { excerpt: false });
  const data: Data = {};
  for (const [key, raw] of Object.entries(parsed.data as Record<string, unknown>)) {
    data[key] = normalise(raw);
  }
  return { data, body: parsed.content.replace(/^\n+/, "").trimEnd() };
}

function normalise(raw: unknown): Value {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  return String(raw);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RISKY = /^[\s\-?:,[\]{}#&*!|>'"%@`]|[\s]$|: | #|^(true|false|null|yes|no|on|off|~)$|^[+-]?[\d.]/i;

function scalar(v: string): string {
  if (v === "") return '""';
  if (DATE.test(v)) return v;
  return RISKY.test(v) || v.includes("\n") ? JSON.stringify(v) : v;
}

/**
 * Writes frontmatter in a fixed key order with minimal quoting, so files stay
 * readable and diffs stay small. `undefined` keys are dropped, `null` prints empty.
 */
export function stringify(data: Data, body: string, order: string[]): string {
  const keys = [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))];
  const out = ["---"];
  for (const key of keys) {
    const v = data[key];
    if (v === undefined) continue;
    if (v === null) out.push(`${key}:`);
    else if (Array.isArray(v)) out.push(`${key}: [${v.map(scalar).join(", ")}]`);
    else if (typeof v === "string") out.push(`${key}: ${scalar(v)}`);
    else out.push(`${key}: ${String(v)}`);
  }
  out.push("---");
  const trimmed = body.trim();
  return out.join("\n") + "\n" + (trimmed ? trimmed + "\n" : "");
}
