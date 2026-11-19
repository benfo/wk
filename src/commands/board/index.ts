import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "../../context.js";
import { result, type Result } from "../../output.js";
import type { Store } from "../../store.js";
import { boardHtml } from "./page.js";

export { boardHtml } from "./page.js";
export { ago } from "./parts.js";

/** Where the board goes: per machine, outside the plan, so a committed plan never churns. */
export function boardPath(ctx: Ctx): string {
  const key = createHash("sha1").update(path.resolve(ctx.root).toLowerCase()).digest("hex").slice(0, 12);
  return path.join(ctx.home, "boards", `${path.basename(ctx.base).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${key}.html`);
}

/** Opens a file or URL in the default browser; best effort. */
export function openUrl(target: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // The path is printed anyway.
  }
}

export function board(ctx: Ctx, store: Store, opts: { out?: string; open?: boolean }): Result {
  const file = opts.out ? path.resolve(ctx.cwd, opts.out) : boardPath(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, boardHtml(ctx, store));
  if (opts.open) openUrl(file);
  return result([`Board: ${file}`, opts.open ? "Opened in your browser." : "Open it in a browser, or rerun with --open."], { file });
}
