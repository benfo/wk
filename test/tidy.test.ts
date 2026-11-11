import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("wk tidy", () => {
  it("reports a clean plan", () => {
    expect(project().wk("tidy")).toBe("Plan is clean.");
  });

  it("finds duplicates, stale tasks, old ideas, finished epics and missing epics", () => {
    const p = project();
    p.on("2026-08-01", "add", "task", "Refresh token flow");
    p.on("2026-08-01", "add", "task", "Refresh token endpoint", "--force");
    p.on("2026-08-01", "idea", "Passkeys");
    p.wk("add", "epic", "Auth rework");
    p.wk("add", "task", "Only task", "--epic", "E-001");
    p.wk("done", "T-003", "--force");
    p.wk("add", "epic", "Doomed epic");
    p.wk("add", "task", "Points at doomed", "--epic", "E-002");
    fs.rmSync(p.file("epics", "E-002.md"));

    const out = p.wk("tidy", "--all");
    expect(out).toContain("Duplicate? T-001 Refresh token flow / T-002 Refresh token endpoint");
    expect(out).toContain("Stale: T-001 Refresh token flow untouched 101 days");
    expect(out).toContain("Old idea: I-001 Passkeys (101 days)");
    expect(out).toContain("Finished: E-001 Auth rework, all 1 tasks done (tidy --fix closes it)");
    expect(out).toContain("Missing epic: T-004 points at E-002");
  });

  it("--fix closes finished epics and archives done items older than 7 days", () => {
    const p = project();
    p.on("2026-11-01", "add", "epic", "Auth rework");
    p.on("2026-11-01", "add", "task", "Old done", "--epic", "E-001");
    p.on("2026-11-01", "done", "T-001", "--force");
    p.on("2026-11-01", "add", "task", "Recent done");
    p.wk("done", "T-002", "--force");

    const out = p.wk("tidy", "--fix");
    expect(out).toContain("Closed E-001 Auth rework");
    expect(out).toContain("Archived 1: T-001");
    expect(fs.existsSync(p.file("archive", "T-001.md"))).toBe(true);
    expect(fs.existsSync(p.file("tasks", "T-002.md"))).toBe(true);
    expect(p.read("epics", "E-001.md")).toContain("status: done");

    // Archived items leave ls and next but still count toward progress and stay findable.
    expect(p.wk("ls", "--status", "done")).toBe("done   T-002 Recent done");
    expect(p.wk("ls", "--archived")).toBe("done   T-001 Old done");
    expect(p.wk("show", "T-001")).toContain("(archived)");
    expect(p.wk("status", "--epic", "E-001")).toContain("1/1");

    // A week later the closed epic is archived too.
    expect(p.on("2026-11-20", "tidy", "--fix").stdout).toContain("Archived 2: T-002, E-001");
  });
});

describe("wk merge", () => {
  it("folds a task into another, keeps the shorter text and unions tags", () => {
    const p = project();
    p.wk("add", "task", "Refresh token flow with rotation", "--tags", "api", "--body", "Rotate on every use.");
    p.wk("add", "task", "Refresh token flow", "--tags", "auth", "--body", "Long notes that ramble about rotation.", "--force");
    expect(p.wk("merge", "T-001", "T-002")).toBe("Merged T-002 into T-001 Refresh token flow\nDeleted T-002");
    const kept = p.read("tasks", "T-001.md");
    expect(kept).toContain("title: Refresh token flow\n");
    expect(kept).toContain("tags: [api, auth]");
    expect(kept).toContain("Rotate on every use.");
    expect(fs.existsSync(p.file("tasks", "T-002.md"))).toBe(false);
  });

  it("merges ideas and refuses keeping an idea over a task or dropping the now task", () => {
    const p = project();
    p.wk("idea", "Dark mode");
    p.wk("idea", "Dark mode with a toggle in settings", "--force");
    p.wk("add", "task", "Build dark mode", "--force");
    p.wk("add", "task", "Build dark theme", "--force");
    expect(p.wk("merge", "I-002", "I-001")).toContain("Merged I-001 into I-002 Dark mode");
    expect(p.raw("merge", "I-002", "T-001").stderr).toMatch(/Keep the task, drop the idea: wk merge T-001 I-002/);
    p.wk("start", "T-002");
    expect(p.raw("merge", "T-001", "T-002").stderr).toMatch(/T-002 is now/);
  });

  it("folds an idea into a task, keeping the task's text and taking the idea's epic", () => {
    const p = project();
    p.wk("add", "epic", "Theming");
    p.wk("idea", "Dark mode toggle", "--epic", "E-001");
    p.wk("add", "task", "Build dark mode", "--body", "Toggle in settings.", "--force");
    expect(p.wk("merge", "T-001", "I-001")).toBe("Merged I-001 into T-001 Build dark mode\nDeleted I-001");
    const kept = p.read("tasks", "T-001.md");
    expect(kept).toContain("title: Build dark mode\n");
    expect(kept).toContain("epic: E-001");
    expect(kept).toContain("Toggle in settings.");
    expect(fs.existsSync(p.file("ideas", "I-001.md"))).toBe(false);
  });
});

describe("wk drop", () => {
  it("deletes an idea and refuses other kinds", () => {
    const p = project();
    p.wk("idea", "Passkeys");
    p.wk("add", "task", "Refresh token flow");
    expect(p.wk("drop", "I-001")).toBe("Dropped I-001 Passkeys");
    expect(fs.existsSync(p.file("ideas", "I-001.md"))).toBe(false);
    expect(p.raw("drop", "T-001").code).not.toBe(0);
  });
});

describe("wk supersede", () => {
  it("marks the old decision as replaced and links both ways", () => {
    const p = project();
    p.wk("decide", "Use JWT", "--why", "Stateless.");
    p.wk("decide", "Use server sessions", "--why", "Easy revocation.");
    expect(p.wk("supersede", "D-001", "D-002")).toBe("D-001 superseded by D-002 Use server sessions");
    expect(p.read("decisions", "D-001.md")).toContain("status: superseded\nsupersedes:\nsuperseded_by: D-002");
    expect(p.read("decisions", "D-002.md")).toContain("supersedes: D-001");
    expect(p.read("decisions", "D-001.md")).toContain("Stateless.");
    expect(p.raw("supersede", "D-001", "D-002").stderr).toMatch(/already superseded/);
  });
});

describe("wk edit", () => {
  it("rewrites titles, bodies, tags and flags under the same limits", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    p.wk("add", "task", "Wordy task title");
    expect(p.wk("edit", "T-001", "--title", "Tight title", "--tags", "api", "--epic", "E-001", "--needs-decision")).toBe(
      "Updated T-001 Tight title",
    );
    const file = p.read("tasks", "T-001.md");
    expect(file).toContain("title: Tight title\nepic: E-001");
    expect(file).toContain("needs_decision: true");
    p.wk("edit", "T-001", "--no-needs-decision", "--epic", "none");
    expect(p.read("tasks", "T-001.md")).toContain("epic:\n");
    expect(p.read("tasks", "T-001.md")).toContain("needs_decision: false");
    expect(p.raw("edit", "T-001", "--title", "x".repeat(80)).stderr).toMatch(/limit is 70/);
    expect(p.raw("edit", "T-001").stderr).toMatch(/Nothing to change/);
  });

  it("edits idea text but never decisions", () => {
    const p = project();
    p.wk("idea", "Passkeys");
    p.wk("edit", "I-001", "--body", "Passkeys for admin users");
    expect(p.wk("ls", "ideas")).toBe("I-001 Passkeys for admin users");
    expect(p.raw("edit", "I-001", "--title", "x").stderr).toMatch(/no title/);
    p.wk("decide", "Use JWT", "--why", "Stateless.");
    expect(p.raw("edit", "D-001", "--title", "Other").stderr).toMatch(/never edited/);
  });
});
