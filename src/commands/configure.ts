import { readConfig, setConfigValue, SETTABLE } from "../config.js";
import type { Ctx } from "../context.js";
import { result, WkError, type Result } from "../output.js";

const shown = (v: string | null) => v ?? "(not chosen)";

/** `wk config` prints the settings; `wk config set <key> <value>` changes one. */
export function configure(ctx: Ctx, action: string | undefined, key: string | undefined, value: string | undefined): Result {
  if (action === undefined) {
    const c = ctx.config;
    return result(
      [
        `store: ${c.store}`,
        `git.branch: ${shown(c.git.branch)}`,
        `git.commit: ${shown(c.git.commit)}`,
        `principles_dir: ${c.principles_dir}`,
        `Change one: wk config set <${Object.keys(SETTABLE).join("|")}> <value>`,
      ],
      { store: c.store, git: c.git, principles_dir: c.principles_dir },
    );
  }
  if (action !== "set") throw new WkError(`Unknown action "${action}". Use: wk config, or wk config set <key> <value>`);
  if (!key || value === undefined) throw new WkError("Use: wk config set <key> <value>");
  setConfigValue(ctx.root, key, value);
  ctx.config = readConfig(ctx.root);
  return result([`${key}: ${value}`], { key, value });
}
