import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { git, hasGit, project } from "./helpers.js";

describe("wk config", () => {
  it("shows the settings, with the git workflow not chosen", () => {
    const p = project();
    expect(p.wk("config").split("\n").slice(0, 4)).toEqual([
      "store: repo",
      "git.branch: (not chosen)",
      "git.commit: (not chosen)",
      "principles_dir: principles",
    ]);
  });

  it("sets git keys and keeps comments, counters and other keys", () => {
    const p = project();
    p.wk("add", "task", "Counted");
    expect(p.wk("config", "set", "git.commit", "task")).toBe("git.commit: task");
    p.wk("config", "set", "git.branch", "none");
    const text = p.read("config.yml");
    expect(text).toContain("git:\n  branch: none\n  commit: task");
    expect(text).toContain("# or an absolute path, shared across projects");
    expect(text).toContain("T: 1,");
    expect(readConfig(p.file()).git).toEqual({ branch: "none", commit: "task" });
  });

  it("refuses unknown keys and values", () => {
    const p = project();
    expect(p.raw("config", "set", "git.commit", "always").stderr).toBe("git.commit must be one of: ask, task, checkpoint");
    expect(p.raw("config", "set", "store", "home").stderr).toMatch(/Unknown setting "store"/);
    expect(p.raw("config", "set", "git.branch").stderr).toMatch(/Use: wk config set/);
    expect(p.raw("config", "get").stderr).toMatch(/Unknown action/);
  });

  it("replaces an old branch_on_start flag", () => {
    const p = project();
    fs.writeFileSync(p.file("config.yml"), "branch_on_start: true\n" + p.read("config.yml"));
    expect(readConfig(p.file()).git.branch).toBe("task");
    p.wk("config", "set", "git.branch", "none");
    expect(p.read("config.yml")).not.toContain("branch_on_start");
    expect(readConfig(p.file()).git.branch).toBe("none");
  });

  it("says nothing about git outside a repo", () => {
    const p = project();
    p.wk("add", "task", "Thing");
    expect(p.wk("brief")).not.toContain("Git:");
    p.wk("start", "T-001");
    expect(p.wk("checkpoint", "--checked", "ok")).not.toContain("Git:");
  });
});

describe.skipIf(!hasGit)("git workflow in a repo", () => {
  it("brief shows the workflow, or that it isn't chosen", () => {
    const p = project({ git: true });
    expect(p.wk("brief")).toContain("Git: branching not chosen, commits not chosen. Ask before any branch or commit.");
    p.wk("config", "set", "git.branch", "none");
    p.wk("config", "set", "git.commit", "task");
    expect(p.wk("brief")).toContain("Git: no branches, commit after each task.");
  });

  it("checkpoint and done say when to commit", () => {
    const p = project({ git: true });
    p.wk("add", "task", "One");
    p.wk("add", "task", "Two");
    p.wk("start", "T-001");
    expect(p.wk("checkpoint", "--checked", "ok")).toContain("Git: workflow not chosen. Ask the user before any commit or branch");

    p.wk("config", "set", "git.branch", "none");
    p.wk("config", "set", "git.commit", "task");
    p.wk("start", "T-001");
    expect(p.wk("checkpoint", "--checked", "ok")).not.toContain("Git:");
    expect(p.wk("done", "T-001")).toContain("Git: commit now (git.commit: task).");

    p.wk("config", "set", "git.commit", "checkpoint");
    p.wk("start", "T-002");
    expect(p.wk("checkpoint", "--checked", "ok")).toContain("Git: commit now (git.commit: checkpoint).");
    expect(p.wk("done", "T-002")).not.toContain("Git:");

    p.wk("config", "set", "git.commit", "ask");
    p.wk("add", "task", "Three");
    p.wk("start", "T-003");
    expect(p.wk("checkpoint", "--checked", "ok")).toContain("Git: ask the user before committing.");
  });

  it("never branches while git.branch is not chosen", () => {
    const p = project({ git: true });
    p.wk("add", "task", "Stay put");
    expect(p.wk("start", "T-001")).toBe("now   T-001 Stay put\nOn branch: main");
  });

  it("git.branch task makes a branch per task", () => {
    const p = project({ git: true });
    p.wk("config", "set", "git.branch", "task");
    p.wk("add", "task", "Login page");
    expect(p.wk("start", "T-001")).toContain("Branch: T-001-login-page");
    expect(git(p.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("T-001-login-page");
  });

  it("git.branch epic shares one branch across an epic's tasks", () => {
    const p = project({ git: true });
    p.wk("config", "set", "git.branch", "epic");
    p.wk("add", "epic", "Auth rework");
    p.wk("add", "task", "Login page", "--epic", "E-001");
    p.wk("add", "task", "Logout button", "--epic", "E-001");
    p.wk("add", "task", "Loose end");
    expect(p.wk("start", "T-001")).toContain("Branch: E-001-auth-rework");
    p.wk("done", "T-001", "--force");

    git(p.dir, "checkout", "-q", "main");
    expect(p.wk("start", "T-002")).toContain("Branch: E-001-auth-rework");
    expect(git(p.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("E-001-auth-rework");
    p.wk("done", "T-002", "--force");

    expect(p.wk("start", "T-003")).toContain("No epic, so no epic branch.");
  });

  it("--no-branch overrides the setting for one task", () => {
    const p = project({ git: true });
    p.wk("config", "set", "git.branch", "task");
    p.wk("add", "task", "Quick fix");
    expect(p.wk("start", "T-001", "--no-branch")).toBe("now   T-001 Quick fix\nOn branch: main");
  });
});

describe.skipIf(!hasGit)("a repo with no commits yet", () => {
  it("still knows the branch name", () => {
    const p = project({ init: false });
    git(p.dir, "init", "-q", "-b", "main");
    p.wk("init", "--store", "local");
    p.wk("add", "task", "First ever");
    expect(p.wk("start", "T-001")).toBe("now   T-001 First ever\nOn branch: main");
  });
});
