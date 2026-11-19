import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { plan, put } from "./helpers.js";

const idOf = (out: string) => /(?:Added|Project) (\w{4})/.exec(out)![1];

describe("areas", () => {
  it("creates an area with a description and lists it", () => {
    const p = plan();
    expect(p.wk("area", "new", "ui", "Screens, layout and styling")).toBe("Area ui: Screens, layout and styling");
    expect(p.read("areas", "ui", "area.md")).toBe("# ui\n\nScreens, layout and styling\n");
    p.wk("add", "Fix the banner", "--in", "ui");
    expect(p.wk("area").split("\n")).toEqual([
      "core       0 open tasks, 0 principles  Always in scope. Its principles load for every task; items with no better home live here.",
      "ui         1 open task, 0 principles  Screens, layout and styling",
    ]);
  });

  it("refuses bad names, duplicates and a missing description", () => {
    const p = plan();
    expect(p.raw("area", "new", "Front End", "x").stderr).toMatch(/lowercase letters, digits and dashes/);
    expect(p.raw("area", "new", "core", "x").stderr).toBe("Area core already exists.");
    expect(p.raw("area", "new", "ui").stderr).toMatch(/Describe the area/);
  });
});

describe("projects", () => {
  it("creates a project folder with goal and acceptance, touching areas", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    const out = p.wk("project", "new", "Usage history", "--touches", "ui");
    const id = idOf(out);
    expect(out.split("\n")[0]).toBe(`Project ${id} Usage history (touches ui)`);
    const text = p.read("projects", `${id}-usage-history`, "project.md");
    expect(text).toContain("kind: project\nstate: open\ntouches: [ui]");
    expect(text).toContain("# Usage history\n\n## Goal\n\n## Acceptance\n");
  });

  it("refuses an unknown area", () => {
    const p = plan();
    expect(p.raw("project", "new", "History", "--touches", "garden").stderr).toMatch(/No area "garden"\. Create it first/);
  });

  it("holds tasks and shows progress", () => {
    const p = plan();
    const pid = idOf(p.wk("project", "new", "Usage history"));
    const a = idOf(p.wk("add", "Record each run", "--in", pid.slice(0, 3)));
    p.wk("add", "Show a streak", "--in", pid);
    expect(p.files("projects", `${pid}-usage-history`)).toContain(`${a}-record-each-run.md`);
    put(p, ["projects", `${pid}-usage-history`], "zzzz", "Already shipped", { state: "done", when: "queue" });
    const list = p.wk("project").split("\n");
    expect(list[0]).toBe(`${pid} Usage history  ███░░░░░░░  1/3`);
    expect(list[1]).toBe(`  next   ${a} Record each run`);
    expect(list.at(-1)).toBe("areas   core 0");
    expect(p.wk("project", "show", pid)).toContain("## Goal");
  });
});

describe("move", () => {
  it("moves an item between homes and back to the queue's bottom", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    const a = idOf(p.wk("add", "Fix the banner"));
    const b = idOf(p.wk("add", "Write the readme"));
    expect(p.wk("move", a, "--in", "ui")).toBe(`Moved ${a} Fix the banner: in ui, #1 of 2 in the queue`);
    expect(p.files("areas", "ui")).toContain(`${a}-fix-the-banner.md`);
    expect(fs.existsSync(p.file("areas", "core", `${a}-fix-the-banner.md`))).toBe(false);
    expect(p.wk("move", a, "--after", b)).toBe(`Moved ${a} Fix the banner: #2 of 2 in the queue`);
  });

  it("reorders the queue with top, bottom, before and after", () => {
    const p = plan();
    const [a, b, c] = ["Alpha task", "Bravo task", "Charlie task"].map((t) => idOf(p.wk("add", t)));
    const order = () => p.wk("ls", "queued").split("\n").map((l) => l.split(/\s+/)[1]);
    expect(order()).toEqual([a, b, c]);
    p.wk("move", c, "--top");
    expect(order()).toEqual([c, a, b]);
    p.wk("move", c, "--before", b);
    expect(order()).toEqual([a, c, b]);
    p.wk("move", a, "--bottom");
    expect(order()).toEqual([c, b, a]);
  });

  it("explains what it needs", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Alpha task"));
    expect(p.raw("move", a).stderr).toMatch(/^Say what changes/);
    expect(p.raw("move", a, "--top", "--bottom").stderr).toMatch(/^Give one place/);
    expect(p.raw("move", a, "--in", "inbox").stderr).toMatch(/don't go back/);
    expect(p.raw("move", a, "--in", "garden").stderr).toMatch(/^No home "garden"/);
  });
});

describe("summary", () => {
  it("shows a prompt when empty and saves up to 8 lines", () => {
    const p = plan();
    expect(p.wk("summary")).toMatch(/^No summary yet/);
    expect(p.wk("summary", "What: a CLI\\nWho: me")).toBe("Summary saved (2 lines).");
    expect(p.wk("summary")).toBe("What: a CLI\nWho: me");
    expect(p.raw("summary", "1\\n2\\n3\\n4\\n5\\n6\\n7\\n8\\n9").stderr).toMatch(/9 lines, limit is 8 \(1 over\)/);
  });
});
