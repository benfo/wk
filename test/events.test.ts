import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContext } from "../src/context.js";
import { ago } from "../src/commands/board/index.js";
import { readEvents } from "../src/events.js";
import { plan, TODAY } from "./helpers.js";

const idOf = (out: string) => /^\w+ (\w{4})/.exec(out)![1];

describe("event log", () => {
  it("records what each command changed, newest first, outside the plan", () => {
    const p = plan();
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Usage history"))![1];
    const a = idOf(p.wk("add", "Record each run", "--in", pid));
    const b = idOf(p.wk("add", "Export to CSV", "--when", `after:${a}`));
    p.wk("start", a);
    const j = idOf(p.wk("jot", "Button looks off"));
    p.wk("check", "--checked", "ok");
    p.wk("done", a);
    p.wk("move", j, "--in", "core");
    p.wk("wait", b, "approval");
    p.wk("drop", j);
    p.wk("project", "close", pid);
    const ctx = loadContext(p.dir, TODAY, p.home);
    const verbs = readEvents(ctx).map((e) => `${e.verb} ${e.title}`).reverse();
    expect(verbs).toEqual([
      "project started Usage history",
      "added Record each run",
      "added Export to CSV",
      "started Record each run",
      "jotted Button looks off",
      "ready to try Record each run",
      "done Record each run",
      "due Export to CSV",
      "sorted Button looks off",
      "waiting Export to CSV",
      "dropped Button looks off",
      "project closed Usage history",
    ]);
    expect(fs.readdirSync(p.file()).some((f) => f.includes("event"))).toBe(false);
  });

  it("logs nothing for commands that only read", () => {
    const p = plan();
    p.wk("add", "Fix the banner");
    const ctx = loadContext(p.dir, TODAY, p.home);
    const n = readEvents(ctx).length;
    p.wk("ls");
    p.wk("next");
    p.wk("board", "--out", "b.html");
    expect(readEvents(ctx)).toHaveLength(n);
  });
});

describe("board: activity, timers, sleeping and alerts", () => {
  it("shows what just happened, how long things have waited, what sleeps on what, and the count in the title", () => {
    const p = plan();
    p.wk("summary", "Name: Joke CLI");
    p.wk("area", "new", "ui", "Screens");
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Usage history"))![1];
    const a = idOf(p.wk("add", "Record each run", "--in", pid));
    p.wk("add", "Write the blog post", "--when", `end:${pid}`);
    p.wk("add", "Theme picker", "--when", "start:ui");
    p.wk("add", "Renew cert", "--when", "on:2026-12-01");
    p.wk("add", "Export to CSV", "--when", `after:${a}`);
    p.wk("add", "Dark mode", "--when", "someday");
    p.wk("start", a);
    p.wk("check", "--checked", "ok", "--test", "Run it twice");
    p.wk("jot", "Button looks off");
    p.wk("board", "--out", "b.html");
    const html = fs.readFileSync(`${p.dir}/b.html`, "utf8");
    // The jotted note waits in the inbox; only the task ready to try asks you to act.
    expect(html).toContain("<title>(1) Joke CLI | wk</title>");
    expect(html).toContain('data-needs="1"');
    expect(html).toContain('<b>Inbox, to sort</b><span class="c">1</span>');
    expect(html).toContain('data-first="Ready for you: Record each run"');
    expect(html).toContain("Just happened");
    expect(html).toMatch(/<span class="verb">jotted<\/span><span class="what">Button looks off<\/span>/);
    expect(html).toMatch(/<span class="m"><time class="ago"[^>]*>(a moment|\d+ min)<\/time><\/span>/);
    expect(html).toContain('<b>Sleeping</b><span class="c">4</span>');
    for (const w of ["When Usage history ends", "Next time work starts in ui", "On 2026-12-01", "After “Record each run” is done"]) {
      expect(html).toContain(`<div class="note">${w}</div>`);
    }
    expect(html).toContain('<b>Later</b><span class="c">1</span>');
    expect(html).toMatch(/<div class="tt">Dark mode<\/div><\/div><span class="m">someday<\/span>/);
    expect(html).not.toMatch(/<script|https?:\/\//);
  });

  it("formats relative times briefly", () => {
    const t = Date.parse("2026-11-10T12:00:00Z");
    expect(ago("2026-11-10T11:59:40Z", t)).toBe("just now");
    expect(ago("2026-11-10T11:35:00Z", t)).toBe("25 min");
    expect(ago("2026-11-10T09:00:00Z", t)).toBe("3 h");
    expect(ago("2026-11-08T12:00:00Z", t)).toBe("2 d");
  });
});
