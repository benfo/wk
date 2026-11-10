const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from",
  "is", "be", "it", "as", "into", "add", "make", "new", "use",
]);

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokens(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !STOP.has(w));
  return new Set((meaningful.length ? meaningful : words).map(stem));
}

/** Dice coefficient over stemmed, stop-word-free tokens. 1 means the same words. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

export const SIMILAR_THRESHOLD = 0.6;

export function isSimilar(a: string, b: string): boolean {
  return similarity(a, b) >= SIMILAR_THRESHOLD;
}
