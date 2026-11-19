import { result, WkError, type Result } from "../../output.js";
import { BRANCH_MODES, COMMIT_MODES, PRESETS, writeConfig, type Config, type Ctx } from "../context.js";
import { workflowLine } from "./views.js";

type Setter = (c: Config, v: string | null) => void;

function oneOf<T extends string>(allowed: readonly T[], key: string, v: string | null): T | null {
  if (v === null) return null;
  if (!allowed.includes(v as T)) throw new WkError(`${key} must be one of: ${allowed.join(", ")}`);
  return v as T;
}

/** Settable keys. `git.*` is short for `workflow.git.*`. An empty value or "none" clears free-text keys. */
const SETTERS: Record<string, Setter> = {
  "git.branch": (c, v) => (c.workflow.git.branch = oneOf(BRANCH_MODES, "git.branch", v)),
  "git.commit": (c, v) => (c.workflow.git.commit = oneOf(COMMIT_MODES, "git.commit", v)),
  commit_style: (c, v) => (c.workflow.commit_style = v),
  "checks.quick": (c, v) => (c.workflow.checks.quick = v),
  "checks.full": (c, v) => (c.workflow.checks.full = v),
  tracker: (c, v) => (c.workflow.tracker = v),
  preset: (c, v) => (c.preset = oneOf(PRESETS, "preset", v)),
  tags: (c, v) => (c.tags = (v ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)),
};

const ALIASES: Record<string, string> = {
  "workflow.git.branch": "git.branch",
  "workflow.git.commit": "git.commit",
  "workflow.commit_style": "commit_style",
  "workflow.checks.quick": "checks.quick",
  "workflow.checks.full": "checks.full",
  "workflow.tracker": "tracker",
};

export function configure(ctx: Ctx, action?: string, rawKey?: string, value?: string): Result {
  const c = ctx.config;
  if (!action) {
    const lines = [
      `store: ${c.store}${c.preset ? ` · preset: ${c.preset}` : ""}`,
      `git.branch: ${c.workflow.git.branch ?? "(not chosen)"} · git.commit: ${c.workflow.git.commit ?? "(not chosen)"}`,
      `commit_style: ${c.workflow.commit_style ?? "-"}`,
      `checks.quick: ${c.workflow.checks.quick ?? "-"} · checks.full: ${c.workflow.checks.full ?? "-"}`,
      `tracker: ${c.workflow.tracker ?? "-"} · tags: ${c.tags.join(", ") || "-"}`,
      `reviewed: ${c.reviewed ?? "never"}`,
    ];
    return result(lines, c);
  }
  if (action !== "set" || !rawKey) throw new WkError(`Use: wk config, or wk config set <key> <value>. Keys: ${Object.keys(SETTERS).join(", ")}`);
  const key = ALIASES[rawKey] ?? rawKey;
  const setter = SETTERS[key];
  if (!setter) throw new WkError(`Unknown setting "${rawKey}". Settable: ${Object.keys(SETTERS).join(", ")}`);
  const v = value === undefined || value.trim() === "" || (value === "none" && !key.startsWith("git.")) ? null : value.trim();
  setter(c, v);
  writeConfig(ctx.root, c);
  const wf = workflowLine(ctx);
  return result([`${key}: ${v ?? "(cleared)"}`, ...(wf ? [wf] : [])], { key, value: v });
}
