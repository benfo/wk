import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../../frontmatter.js";
import { result, WkError, type Result } from "../../output.js";
import { writeConfig, type Ctx } from "../context.js";
import type { Item, Store } from "../store.js";
import { workflowLine } from "./views.js";

/** Works from src/v2/commands (tests) and dist/v2/commands or dist/commands (installed). */
function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "skills", "wk", "SKILL.md"))) return dir;
    dir = path.dirname(dir);
  }
  throw new WkError("wk's skills are missing from the package.");
}

export const PACKAGE_ROOT = findPackageRoot();
export const SKILLS = ["wk", "wk-setup"];
export const GUIDE_TOPICS = ["setup", "onboarding", "migrate", "triage", "review", "close", "principles"];
export const SKILLS_DIR = path.join(".claude", "skills");
export const AGENT_POINTER =
  "Track work with the `wk` CLI. At the start of every session run `wk guide` once (skip it if the wk skill is loaded), then `wk brief`.";

/** Prints the agent rules (the wk skill's body), or one guide. */
export function guide(topic?: string): Result {
  if (topic !== undefined && !GUIDE_TOPICS.includes(topic)) throw new WkError(`No guide "${topic}". Topics: ${GUIDE_TOPICS.join(", ")}.`);
  const file = topic ? path.join(PACKAGE_ROOT, "guides", `${topic}.md`) : path.join(PACKAGE_ROOT, "skills", "wk", "SKILL.md");
  if (!fs.existsSync(file)) throw new WkError(`Guide missing from package: ${file}`);
  const body = parse(fs.readFileSync(file, "utf8")).body.replace(/^\s+/, "");
  return { lines: body.split(/\r?\n/), data: { topic: topic ?? null, text: body }, full: true };
}

/** Copies both skills into the project; rerunning refreshes them. */
export function installSkills(base: string): string[] {
  return SKILLS.map((name) => {
    const dest = path.join(base, SKILLS_DIR, name);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(PACKAGE_ROOT, "skills", name), dest, { recursive: true });
    return path.relative(base, dest).split(path.sep).join("/");
  });
}

export function hasPointer(text: string): boolean {
  return text.includes("`wk guide`") && text.includes("`wk brief`");
}

/** Adds the pointer line once. With `onlyIfExists`, a missing file is left alone. */
export function addPointer(base: string, name: string, onlyIfExists = false): boolean {
  const file = path.join(base, name);
  const exists = fs.existsSync(file);
  if (!exists && onlyIfExists) return false;
  const existing = exists ? fs.readFileSync(file, "utf8") : "";
  if (hasPointer(existing)) return false;
  const sep = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, existing + sep + AGENT_POINTER + "\n");
  return true;
}

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md", ".cursorrules", ".windsurfrules", ".github/copilot-instructions.md"];

/** Agent instruction files in the project, relative paths with forward slashes. wk's own skills are left out. */
export function instructionFiles(base: string): string[] {
  const found = INSTRUCTION_FILES.filter((f) => fs.existsSync(path.join(base, ...f.split("/"))));
  const rules = path.join(base, ".cursor", "rules");
  if (fs.existsSync(rules)) {
    for (const f of fs.readdirSync(rules)) if (/\.(md|mdc)$/.test(f)) found.push(`.cursor/rules/${f}`);
  }
  const skills = path.join(base, SKILLS_DIR);
  if (fs.existsSync(skills)) {
    for (const d of fs.readdirSync(skills)) {
      if (SKILLS.includes(d)) continue;
      if (fs.existsSync(path.join(skills, d, "SKILL.md"))) found.push(`.claude/skills/${d}/SKILL.md`);
    }
  }
  return found;
}

/** A fingerprint that ignores line endings and wk's own pointer line, so refreshing wk never looks like drift. */
export function fingerprint(base: string, rel: string): string {
  const text = fs
    .readFileSync(path.join(base, ...rel.split("/")), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== AGENT_POINTER)
    .join("\n")
    .trim();
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

/** Files that changed, appeared or disappeared since `wk setup --done`. */
export function drift(ctx: Ctx): { file: string; how: "changed" | "new" | "removed" }[] {
  const seen = ctx.config.setup ?? {};
  const now = instructionFiles(ctx.base);
  const out: { file: string; how: "changed" | "new" | "removed" }[] = [];
  for (const f of now) {
    if (!(f in seen)) out.push({ file: f, how: "new" });
    else if (seen[f] !== fingerprint(ctx.base, f)) out.push({ file: f, how: "changed" });
  }
  for (const f of Object.keys(seen)) if (!now.includes(f)) out.push({ file: f, how: "removed" });
  return out;
}

export function setup(ctx: Ctx, _store: Store, opts: { done?: boolean }): Result {
  const files = instructionFiles(ctx.base);
  if (opts.done) {
    ctx.config.setup = Object.fromEntries(files.map((f) => [f, fingerprint(ctx.base, f)]));
    writeConfig(ctx.root, ctx.config);
    return result([`Recorded ${files.length} instruction file${files.length === 1 ? "" : "s"}. wk brief will say when one changes.`], { files });
  }
  const changes = ctx.config.setup ? drift(ctx) : [];
  const mark = (f: string) => {
    const c = changes.find((x) => x.file === f);
    return c ? `${f} (${c.how})` : f;
  };
  const lines = [files.length ? `Instructions: ${files.map(mark).join(", ")}` : "Instructions: none found in the project."];
  for (const c of changes.filter((x) => x.how === "removed")) lines.push(`Removed since setup: ${c.file}`);
  lines.push(workflowLine(ctx) ?? "Workflow: nothing stored yet.");
  const wf = ctx.config.workflow;
  const unset = [
    ctx.git && !wf.git.branch && "git.branch",
    ctx.git && !wf.git.commit && "git.commit",
    !wf.checks.quick && "checks.quick",
    !wf.checks.full && "checks.full",
  ].filter(Boolean);
  if (unset.length) lines.push(`Not set: ${unset.join(", ")}`);
  lines.push(ctx.config.setup ? `Last setup recorded ${Object.keys(ctx.config.setup).length} files.` : "Setup not recorded yet.");
  lines.push("Next: read them, list the overlaps with wk (wk guide setup, step 3), store the workflow, then wk setup --done.");
  return result(lines, { files, changes, workflow: wf, recorded: ctx.config.setup });
}

/** `wk brief`: instruction files that changed since setup. */
export function briefDrift(ctx: Ctx, store: Store): string[] {
  if (!ctx.config.setup) {
    const work = store.list().length > 0;
    const own = instructionFiles(ctx.base).some((f) => fingerprint(ctx.base, f) !== createHash("sha1").update("").digest("hex").slice(0, 12));
    return work && own ? ["Setup not recorded: fit wk to this project's instructions (wk-setup skill, wk guide setup)."] : [];
  }
  const changes = drift(ctx);
  if (changes.length === 0) return [];
  return [`Instructions changed since setup: ${changes.map((c) => `${c.file} (${c.how})`).join(", ")}. Recheck (wk-setup skill).`];
}

/** `wk start`: the quick checks to run before checking in. */
export function startChecks(ctx: Ctx, _store: Store, _item: Item): string[] {
  const quick = ctx.config.workflow.checks.quick;
  return quick ? ["", `Checks: run ${quick} before wk check.`] : [];
}
