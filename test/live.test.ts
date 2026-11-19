import http from "node:http";
import { describe, expect, it } from "vitest";
import { loadContext } from "../src/context.js";
import { serveBoard } from "../src/commands/live.js";
import { git, hasGit, plan, TODAY } from "./helpers.js";

/** Resolves with the first `data:` event from the live board's event stream. */
function nextEvent(url: string): { connected: Promise<void>; event: Promise<string>; stop: () => void } {
  let req: http.ClientRequest;
  let onConnect: () => void;
  const connected = new Promise<void>((r) => (onConnect = r));
  const event = new Promise<string>((resolve, reject) => {
    req = http.get(`${url}events`, (res) => {
      res.setEncoding("utf8");
      let buf = "";
      res.on("data", (chunk: string) => {
        buf += chunk;
        if (buf.includes(": connected")) onConnect();
        const m = /^data: (.+)$/m.exec(buf);
        if (m) resolve(m[1]);
      });
    });
    req.on("error", reject);
  });
  return { connected, event, stop: () => req.destroy() };
}

describe("wk board --serve", () => {
  it("serves the board with a live script and pushes a reload when the plan changes", async () => {
    const p = plan();
    p.wk("add", "Fix the banner");
    const live = await serveBoard(loadContext(p.dir, TODAY, p.home), { port: 0 });
    try {
      expect(live.url).toMatch(/^http:\/\/localhost:\d+\/$/);
      const html = await (await fetch(live.url)).text();
      expect(html).toContain("Fix the banner");
      expect(html).toContain('new EventSource("/events")');
      expect((await fetch(`${live.url}nope`)).status).toBe(404);

      const sse = nextEvent(live.url);
      await sse.connected;
      p.wk("jot", "Button looks off");
      await expect(sse.event).resolves.toBe("reload");
      sse.stop();
      expect(await (await fetch(live.url)).text()).toContain("Button looks off");
    } finally {
      await live.close();
    }
  });

  it("moves to the next port when one is taken", async () => {
    const p = plan();
    const ctx = loadContext(p.dir, TODAY, p.home);
    const first = await serveBoard(ctx, { port: 0 });
    const port = Number(new URL(first.url).port);
    const second = await serveBoard(ctx, { port });
    try {
      expect(Number(new URL(second.url).port)).toBe(port + 1);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it.skipIf(!hasGit)("shows the branch, and pushes a reload when it switches", async () => {
    const p = plan({ git: true });
    const live = await serveBoard(loadContext(p.dir, TODAY, p.home), { port: 0 });
    try {
      expect(await (await fetch(live.url)).text()).toContain('<span class="branch" title="Current git branch">main</span>');
      const sse = nextEvent(live.url);
      await sse.connected;
      git(p.dir, "switch", "-q", "-c", "feature-x");
      await expect(sse.event).resolves.toBe("reload");
      sse.stop();
      expect(await (await fetch(live.url)).text()).toContain(">feature-x</span>");
    } finally {
      await live.close();
    }
  });

  it("keeps the static board free of scripts", () => {
    const p = plan();
    expect(p.wk("board", "--out", "b.html")).toContain("b.html");
  });
});
