import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { readConfig, type Ctx } from "../context.js";
import { Store } from "../store.js";
import { boardHtml, openUrl } from "./board/index.js";

export const DEFAULT_PORT = 4123;

/** The folder holding git's HEAD file, worktree-aware; null outside git. */
function gitDir(base: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--git-path", "HEAD"], { cwd: base, encoding: "utf8", windowsHide: true });
  return r.status === 0 && r.stdout.trim() ? path.dirname(path.resolve(base, r.stdout.trim())) : null;
}

const DEBOUNCE_MS = 150;
const HEARTBEAT_MS = 25_000;

export interface LiveBoard {
  url: string;
  close: () => Promise<void>;
}

/**
 * Serves the board on localhost and pushes a reload to every open page when anything in the plan
 * folder changes, so the page follows the agent's work. Built only on Node's http and fs.watch.
 */
export function serveBoard(ctx: Ctx, opts: { port?: number; host?: string } = {}): Promise<LiveBoard> {
  const host = opts.host ?? "127.0.0.1";
  const clients = new Set<http.ServerResponse>();

  // Every request reads the plan fresh: config and items may have changed since the last one.
  const render = () => {
    const fresh: Ctx = { ...ctx, config: readConfig(ctx.root) };
    return boardHtml(fresh, new Store(fresh), { live: true });
  };

  const server = http.createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.url !== "/" && req.url !== "/index.html") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    try {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(render());
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end(`Could not read the plan: ${(e as Error).message}`);
    }
  });

  // Many files change at once (wk done also writes the handoff), so wait for the burst to settle.
  let timer: NodeJS.Timeout | null = null;
  const push = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      for (const c of clients) c.write("data: reload\n\n");
    }, DEBOUNCE_MS);
  };
  const watcher = fs.watch(ctx.root, { recursive: true }, push);
  // Switching branches doesn't touch the plan, but the board shows the branch: watch git's HEAD too.
  const headDir = ctx.git ? gitDir(ctx.base) : null;
  const headWatcher = headDir
    ? fs.watch(headDir, (_event, file) => {
        if (file === "HEAD") push();
      })
    : null;
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, HEARTBEAT_MS);

  const close = () =>
    new Promise<void>((resolve) => {
      watcher.close();
      headWatcher?.close();
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      for (const c of clients) c.end();
      server.close(() => resolve());
    });

  // Try the port asked for, then the next few, so a second board in another repo still starts.
  return new Promise((resolve, reject) => {
    const start = opts.port ?? DEFAULT_PORT;
    const tryPort = (port: number, left: number) => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE" && left > 0 && port !== 0) tryPort(port + 1, left - 1);
        else {
          void close();
          reject(e);
        }
      });
      server.listen(port, host, () => {
        const addr = server.address();
        const actual = typeof addr === "object" && addr ? addr.port : port;
        resolve({ url: `http://localhost:${actual}/`, close });
      });
    };
    tryPort(start, 9);
  });
}

/** `wk board --serve`: starts the server and keeps running until Ctrl+C. */
export function serveCommand(ctx: Ctx, opts: { port?: string; open?: boolean }): void {
  const port = opts.port !== undefined ? Number(opts.port) : DEFAULT_PORT;
  serveBoard(ctx, { port })
    .then((live) => {
      process.stdout.write(`Live board: ${live.url}\nIt refreshes whenever the plan changes. Ctrl+C to stop.\n`);
      if (opts.open) openUrl(live.url);
      const stop = () => void live.close().then(() => process.exit(0));
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((e: Error) => {
      process.stderr.write(`Could not start the live board: ${e.message}\n`);
      process.exitCode = 1;
    });
}
