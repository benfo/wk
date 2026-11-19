import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { plan, put } from "./helpers.js";

const idOf = (out: string) => /^\w+ (\w{4})/.exec(out)![1];

describe("triggers", () => {
  it("after:<id> wakes up when that task is done, and stays due until moved", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Record each run"));
    const b = idOf(p.wk("add", "Export to CSV", "--when", `after:${a}`));
    expect(p.wk("next")).not.toContain(b);
    const out = p.wk("done", a, "--force");
    expect(out).toContain(`Due now (after ${a}):\n  ${b} Export to CSV (core)`);
    expect(p.wk("brief")).toContain(`Due: ${b} Export to CSV (after:${a}). Queue, reschedule or drop each.`);
    expect(p.wk("next")).toContain(`due    ${b} Export to CSV [due] (core)`);
    p.wk("move", b, "--when", "queue");
    expect(p.wk("brief")).not.toContain("Due:");
  });

  it("on:<date> wakes up at brief on or after the day", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Renew cert", "--when", "on:2026-11-12"));
    expect(p.wk("brief")).not.toContain("Due:");
    expect(p.with({ today: "2026-11-12" }, "brief").stdout).toContain(`Due: ${a} Renew cert (on:2026-11-12)`);
  });

  it("start:<area> wakes up when a task touching the area starts, or a project touching it is made", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    const idea = idOf(p.wk("add", "Theme picker", "--when", "start:ui"));
    const other = idOf(p.wk("add", "Dark mode", "--when", "start:ui"));
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Redesign", "--touches", "ui"))![1];
    expect(p.wk("show", idea)).toContain("due: 2026-11-10");
    expect(p.wk("show", other)).toContain("due: 2026-11-10");
    p.wk("move", idea, "--in", pid, "--when", "queue");
    p.wk("move", other, "--when", "start:ui");
    const t = idOf(p.wk("add", "New banner", "--in", "ui"));
    expect(p.wk("start", t)).toContain(`Due now (work starts in ui):\n  ${other} Dark mode (core)`);
  });

  it("end:<project> wakes up when the project closes", () => {
    const p = plan();
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Usage history"))![1];
    const t = idOf(p.wk("add", "Record each run", "--in", pid));
    const follow = idOf(p.wk("add", "Write the blog post", "--when", `end:${pid}`));
    p.wk("start", t);
    p.wk("learn", "The API caps at 100 calls a minute");
    p.wk("check", "--checked", "ok");
    expect(p.wk("done", t)).toContain(`Nothing left in Usage history: close it with wk project close ${pid}`);
    const out = p.wk("project", "close", pid);
    expect(out).toMatch(new RegExp(`^Closed ${pid} Usage history \\(1/1 done\\), archived\\.`));
    expect(out).toMatch(/Distill: .*\n  learning \w{4} The API caps at 100 calls a minute/);
    expect(out).toContain(`Due now (Usage history ended):\n  ${follow} Write the blog post (core)`);
    expect(fs.existsSync(p.file("archive", "2026", `${pid}-usage-history`, "project.md"))).toBe(true);
    expect(p.wk("project")).toMatch(/^No open projects/);
  });

  it("refuses to close a project with open tasks", () => {
    const p = plan();
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Usage history"))![1];
    const t = idOf(p.wk("add", "Record each run", "--in", pid));
    expect(p.raw("project", "close", pid).stderr).toBe(
      `Still open in Usage history:\n  ${t} Record each run\nMove each to an area or another project (wk move <id> --in <home>), or drop it, then close again.`,
    );
  });
});

describe("related on start", () => {
  it("shows jots noticed during a task and the project's decisions", () => {
    const p = plan();
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Usage history"))![1];
    const a = idOf(p.wk("add", "Record each run", "--in", pid));
    const b = idOf(p.wk("add", "Show a streak", "--in", pid));
    p.wk("start", a);
    const j = idOf(p.wk("jot", "Streak should skip weekends"));
    const d = idOf(p.wk("decide", "Store history as JSONL", "--why", "Cheap appends"));
    p.wk("check", "--checked", "ok");
    p.wk("done", a);
    p.wk("move", j, "--in", pid, "--when", "later");
    p.wk("edit", j, "--ref", "x");
    const out = p.wk("start", b);
    expect(out).toContain(`Related:\n  decision ${d} Store history as JSONL (${pid})`);
    p.wk("wait", b, "x");
    put(p, ["projects", fs.readdirSync(p.file("projects")).find((f) => f.startsWith(pid))!], "zzzz", "Linked follow-up", { state: "open", when: "later", links: [b] });
    p.wk("wait", b, "--clear");
    expect(p.wk("start", b)).toContain(`  zzzz Linked follow-up (${pid})`);
  });
});

describe("review", () => {
  it("lists what needs a look and records the date", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    p.wk("add", "Fix the banner border");
    p.wk("add", "Fix banner border", "--force");
    put(p, ["areas", "ui"], "ssss", "Dark mode", { state: "open", when: "someday" });
    put(p, ["areas", "core"], "wwww", "Ship it", { state: "open", when: "queue", rank: 9, wait: "approval", wait_since: "2026-10-01" });
    put(p, ["areas", "core"], "rrrr", "Old rule", { kind: "principle", instead: "x" });
    p.wk("jot", "Button looks off");
    const lines = p.with({ today: "2026-12-20" }, "review", "--all").stdout.split("\n");
    expect(lines[0]).toMatch(/^Inbox: 1 jot to sort: \w{4} Button looks off$/);
    expect(lines).toContain("Waiting 80 days: wwww Ship it on approval");
    expect(lines).toContain("someday for 40 days: ssss Dark mode. Queue, keep or drop?");
    expect(lines).toContain("Area ui has no principles.");
    expect(lines).toContain("Principle rrrr Old rule lacks because: would a model get it wrong without it?");
    expect(lines.some((l) => l.startsWith("Duplicate? "))).toBe(true);
    expect(p.with({ today: "2026-12-20" }, "brief").stdout).toContain("Review due: none yet");
    expect(p.wk("review", "--done")).toBe("Review recorded (2026-11-10).");
    expect(p.with({ today: "2026-11-15" }, "brief").stdout).not.toContain("Review due");
    expect(p.with({ today: "2026-11-20" }, "brief").stdout).toContain("Review due: last one 10 days ago");
  });
});
