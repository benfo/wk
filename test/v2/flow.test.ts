import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { git, hasGit } from "../helpers.js";
import { plan, put } from "./helpers.js";

const idOf = (out: string) => /(?:Added|Project) (\w{4})/.exec(out)![1];

describe("start, check, done", () => {
  it("walks a task from the queue to done, with a handoff", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Fix the banner", "--body", "Border shifts on wide mascots."));
    const b = idOf(p.wk("add", "Write the readme"));
    const started = p.wk("start", a).split("\n");
    expect(started[0]).toBe(`now   ${a} Fix the banner (core)`);
    expect(started).toContain("Border shifts on wide mascots.");
    expect(p.raw("start", b).stderr).toBe(`${a} is already now. Check it or wait it first.`);

    const checked = p.wk("check", "--checked", "12 tests pass", "--test", "Run it at 80 columns");
    expect(checked.split("\n").slice(0, 3)).toEqual([
      `review ${a} Fix the banner`,
      "Test (you): Run it at 80 columns",
      "Checked: 12 tests pass",
    ]);
    expect(p.wk("show", a)).toContain("Test: Run it at 80 columns");

    const out = p.wk("done", a).split("\n");
    expect(out[0]).toBe(`done  ${a} Fix the banner`);
    expect(p.read("session.md")).toBe(`Done: ${a} Fix the banner.\nNext: ${b} Write the readme (core).\n`);
  });

  it("refuses done before review unless forced, and inbox or waiting tasks at start", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Fix the banner"));
    expect(p.raw("done", a).stderr).toMatch(/is open, not review/);
    expect(p.wk("done", a, "--force")).toMatch(/^done/);
    put(p, ["inbox"], "hhhh", "Raw jot", { state: "inbox" });
    expect(p.raw("start", "hhhh").stderr).toMatch(/in the inbox\. Sort it first/);
    const c = idOf(p.wk("add", "Ship it"));
    p.wk("wait", c, "release approval");
    expect(p.raw("start", c).stderr).toMatch(/waiting on release approval/);
    expect(p.wk("wait", c, "--clear")).toMatch(/no longer waiting/);
    expect(p.wk("start", c)).toMatch(/^now/);
  });

  it("archives done area tasks after a week", () => {
    const p = plan();
    put(p, ["areas", "core"], "pppp", "Old done task", { state: "done", when: "queue", done_on: "2026-11-01" });
    const a = idOf(p.wk("add", "Fix the banner"));
    expect(p.wk("done", a, "--force")).toContain("Archived 1 old done item.");
    expect(fs.existsSync(p.file("archive", "2026", "areas", "core", "pppp-old-done-task.md"))).toBe(true);
    expect(p.wk("show", "pppp")).toContain("archived");
  });

  it("suggests a fresh session when the home changes, and stops after a --fresh check", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    const a = idOf(p.wk("add", "Fix the banner"));
    const b = idOf(p.wk("add", "Dark mode", "--in", "ui"));
    p.wk("brief");
    p.wk("start", a);
    p.wk("check", "--checked", "ok", "--fresh");
    expect(p.wk("done", a)).toContain("You recommended a fresh session: stop here.");
    expect(p.wk("start", b)).toContain("Different home from the last task (core)");
  });
});

describe.skipIf(!hasGit)("git workflow", () => {
  it("asks until chosen, then says when to commit and branches per task", () => {
    const p = plan({ git: true });
    const a = idOf(p.wk("add", "Fix the banner"));
    p.wk("start", a);
    expect(p.wk("check", "--checked", "ok")).toContain("Git: workflow not chosen.");
    p.wk("config", "set", "git.branch", "task");
    p.wk("config", "set", "git.commit", "task");
    p.wk("config", "set", "commit_style", "one short line");
    expect(p.wk("done", a)).toContain("Git: commit now (commit: task). Style: one short line.");
    const b = idOf(p.wk("add", "Write the readme"));
    expect(p.wk("start", b)).toContain(`Branch: ${b}-write-the-readme`);
    expect(git(p.dir, "branch", "--show-current")).toBe(`${b}-write-the-readme`);
  });
});

describe("brief and next", () => {
  it("opens a session with summary, workflow, handoff, now and the queue", () => {
    const p = plan();
    p.wk("summary", "What: a CLI for jokes\\nWho: me");
    p.wk("config", "set", "checks.quick", "npm test");
    const a = idOf(p.wk("add", "Fix the banner"));
    p.wk("add", "Write the readme");
    p.wk("start", a);
    p.wk("handoff", "Banner half done.\\nCheck the wide mascot.");
    const lines = p.wk("brief").split("\n");
    expect(lines[0]).toBe("Summary: What: a CLI for jokes");
    expect(lines[1]).toBe("Workflow: quick checks: npm test.");
    expect(lines[2]).toMatch(/^Handoff \(\d{4}-\d{2}-\d{2}\):$/);
    expect(lines.slice(3, 5)).toEqual(["  Banner half done.", "  Check the wide mascot."]);
    expect(lines[5]).toBe(`now    ${a} Fix the banner (core)`);
    expect(lines[6]).toMatch(/^next   \w{4} Write the readme \(core\)$/);
  });

  it("flags an empty plan and lists waiting and due tasks in next", () => {
    const p = plan();
    expect(p.wk("brief")).toMatch(/^Empty plan\. Offer setup/);
    const a = idOf(p.wk("add", "Ship it"));
    p.wk("wait", a, "approval");
    put(p, ["areas", "core"], "dddd", "Export CSV", { state: "open", when: "after:zzzz", due: "2026-11-10" });
    expect(p.wk("next").split("\n")).toEqual([
      "now    (nothing in progress)",
      "due    dddd Export CSV [due] (core)",
      `wait   ${a} Ship it [waiting: approval] (core)`,
    ]);
  });
});
