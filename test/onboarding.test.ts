import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTitleList } from "../src/commands/capture.js";
import { git, hasGit, project } from "./helpers.js";

describe("wk add task --from", () => {
  it("parses checklists, bullets, numbers and plain lines", () => {
    const input = "# Backlog\n- [ ] Login page\n- [x] Done thing\n* Logout button\n1. Session timeout\n\n  Plain title  \n";
    expect(parseTitleList(input).map((e) => e.title)).toEqual([
      "Login page", "Done thing", "Logout button", "Session timeout", "Plain title",
    ]);
  });

  it("adds every line from stdin with shared epic, tags and status", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    const r = p.pipe("- [ ] Login page\n- [ ] Logout button\n", "add", "task", "--from", "-", "--epic", "E-001", "--tags", "ui", "--later");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Added 2 tasks:\nT-001 Login page\nT-002 Logout button");
    expect(p.read("tasks", "T-002.md")).toContain("epic: E-001\nstatus: later\ntags: [ui]");
  });

  it("reads a file relative to the current folder", () => {
    const p = project();
    fs.writeFileSync(path.join(p.dir, "TODO.md"), "- Fix footer\n");
    expect(p.wk("add", "task", "--from", "TODO.md")).toBe("Added 1 task:\nT-001 Fix footer");
    expect(p.raw("add", "task", "--from", "nope.md").stderr).toMatch(/File not found/);
  });

  it("is all or nothing and lists every problem line", () => {
    const p = project();
    p.wk("add", "task", "Refresh token flow");
    const input = ["Login page", "x".repeat(71), "Refresh token endpoint", "Login pages"].join("\n");
    const r = p.pipe(input, "add", "task", "--from", "-");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Nothing added.");
    expect(r.stderr).toContain("line 2: Title is 71 characters, limit is 70");
    expect(r.stderr).toContain('line 3: "Refresh token endpoint" is similar to T-001 Refresh token flow');
    expect(r.stderr).toContain('line 4: "Login pages" is similar to line 1');
    expect(p.wk("ls")).toBe("next   T-001 Refresh token flow");
    expect(p.read("config.yml")).toContain("T: 1,");
  });

  it("refuses a title and --from together, or an empty list", () => {
    const p = project();
    expect(p.pipe("A", "add", "task", "Title", "--from", "-").stderr).toMatch(/not both/);
    expect(p.pipe("\n# only a heading\n", "add", "task", "--from", "-").stderr).toMatch(/No titles found/);
    expect(p.raw("add", "task").stderr).toMatch(/Give a title/);
  });
});

describe("onboarding nudges", () => {
  it("brief flags an empty plan until anything is added", () => {
    const p = project();
    expect(p.wk("brief").split("\n")[0]).toBe("Empty plan. Offer onboarding (see Onboarding in wk guide).");
    p.wk("idea", "Something");
    expect(p.wk("brief")).not.toContain("Empty plan");
  });

  it("init lists plan files and folders worth migrating", () => {
    const p = project({ init: false });
    fs.writeFileSync(path.join(p.dir, "ROADMAP.md"), "# Roadmap\n");
    fs.mkdirSync(path.join(p.dir, "docs", "adr"), { recursive: true });
    fs.writeFileSync(path.join(p.dir, "docs", "todo.txt"), "x\n");
    const out = p.wk("init", "--store", "repo");
    expect(out).toContain("Existing plans: ROADMAP.md, docs/todo.txt, docs/adr/ (decisions). Offer onboarding.");
    // Only a fresh init reports them.
    expect(p.wk("init")).not.toContain("Existing plans");
  });

  it("init says nothing when there is nothing to migrate", () => {
    const p = project({ init: false });
    expect(p.wk("init", "--store", "repo")).not.toContain("Existing plans");
  });

  it.skipIf(!hasGit)("init counts TODO comments and notices a GitHub remote", () => {
    const p = project({ git: true, init: false });
    fs.writeFileSync(path.join(p.dir, "a.ts"), "// TODO: one\n// FIXME two\nconst todo = 1;\n");
    git(p.dir, "add", "a.ts");
    git(p.dir, "remote", "add", "origin", "https://github.com/acme/app.git");
    expect(p.wk("init", "--store", "local")).toContain("Existing plans: 2 TODO/FIXME comments, GitHub issues (ask first). Offer onboarding.");
  });
});
