import type { Ctx } from "../context.js";
import { readSession, writeSession } from "../session.js";
import { CORE_AREA, str, touchesOf, type Item, type Store } from "../store.js";
import { activePrinciples } from "./knowledge.js";

/** The areas whose principles apply to a task: core, its own area, and the areas its project touches. */
export function principleAreas(store: Store, item: Item): string[] {
  const areas = [CORE_AREA];
  if (item.home.type === "area") areas.push(item.home.name);
  if (item.home.type === "project") {
    const p = store.projects().find((x) => x.id === item.home.name);
    if (p) areas.push(...touchesOf(p));
  }
  const known = new Set(store.areas());
  return [...new Set(areas)].filter((a) => known.has(a));
}

export function principleLines(store: Store, areas: string[]): { lines: string[]; missing: string[]; data: Record<string, unknown[]> } {
  const lines: string[] = [];
  const missing: string[] = [];
  const data: Record<string, unknown[]> = {};
  for (const area of areas) {
    const rules = activePrinciples(store, area);
    data[area] = rules.map((r) => ({ id: r.id, rule: r.title, instead: str(r, "instead"), because: str(r, "because"), test: str(r, "test") || null }));
    if (rules.length === 0) {
      missing.push(area);
      continue;
    }
    lines.push(`${area}:`);
    for (const r of rules) {
      lines.push(`  ${r.title}`);
      const why = [str(r, "instead") && `instead of ${str(r, "instead")}`, str(r, "because") && `because ${str(r, "because")}`].filter(Boolean);
      if (why.length) lines.push(`    ${why.join("; ")}`);
      if (str(r, "test")) lines.push(`    enforced by ${str(r, "test")}`);
    }
  }
  return { lines, missing, data };
}

/** `wk start`: the principles that apply, and a one-time question per area that has none. */
export function startPrinciples(ctx: Ctx, store: Store, item: Item): string[] {
  const { lines, missing } = principleLines(store, principleAreas(store, item));
  const out = lines.length ? ["", "Principles:", ...lines] : [];
  const session = readSession(ctx);
  const ask = missing.filter((a) => a !== CORE_AREA && !session.asked.includes(a));
  if (ask.length) {
    out.push(`No ${ask.join(" or ")} principles yet. Ask once: capture a few now (wk guide principles), or carry on?`);
    writeSession(ctx, { ...session, asked: [...session.asked, ...ask] });
  }
  return out;
}

/** `wk brief`: nudge for a principles session while the plan has none at all. */
export function briefPrinciples(_ctx: Ctx, store: Store): string[] {
  const any = store.list().some((i) => i.kind === "principle");
  const work = store.list().some((i) => i.kind === "task");
  return !any && work ? ["No principles yet. Offer a principles session (wk guide principles)."] : [];
}
