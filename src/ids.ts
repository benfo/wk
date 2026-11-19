import { randomInt } from "node:crypto";

/** No 0, 1, i, l or o: ids are read aloud and typed by hand. */
export const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const ID_LENGTH = 4;
export const SLUG_MAX = 40;

const ID_CHARS = `[${ID_ALPHABET}]{${ID_LENGTH}}`;
/** An item file: `<id>-<slug>.md`. `area.md` and `project.md` never match. */
export const ITEM_FILE = new RegExp(`^(${ID_CHARS})-[a-z0-9-]*\\.md$`);
/** A project folder: `<id>-<slug>`. */
export const ID_DIR = new RegExp(`^(${ID_CHARS})-[a-z0-9-]*$`);

export function isIdPrefix(raw: string): boolean {
  return new RegExp(`^[${ID_ALPHABET}]{1,${ID_LENGTH}}$`).test(raw);
}

/** A fresh id not in `taken`. `pick` is swappable so tests can force collisions. */
export function newId(taken: Set<string>, pick: (n: number) => number = randomInt): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = "";
    for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[pick(ID_ALPHABET.length)];
    if (!taken.has(id)) return id;
  }
  throw new Error("Could not find a free id after 1000 tries.");
}

/** Lowercase ASCII words joined by dashes, cut at a word boundary to SLUG_MAX characters. */
export function slugify(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // drop the accents NFKD split off: é becomes e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > SLUG_MAX) break;
    slug = next;
  }
  return slug || (words[0] ?? "item").slice(0, SLUG_MAX);
}
