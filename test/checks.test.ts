import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

function started() {
  const p = project();
  p.wk("add", "task", "Parse config");
  p.wk("start", "T-001");
  return p;
}

describe("checkpoint: automated checks vs human tests", () => {
  it("records automated results apart from human tests, humans first", () => {
    const p = started();
    const out = p.wk("checkpoint", "--checked", "75 tests pass", "--checked", "types check", "--test", "Run wk status, bar lines up").split("\n");
    expect(out.slice(0, 4)).toEqual([
      "review T-001 Parse config",
      "Test (you): Run wk status, bar lines up",
      "Checked: 75 tests pass",
      "Checked: types check",
    ]);
    const file = p.read("tasks", "T-001.md");
    expect(file).toContain('checked: ["75 tests pass", types check]');
    expect(file).toContain("Test: Run wk status, bar lines up");
  });

  it("says when there is nothing for a human to test", () => {
    const p = started();
    const out = p.wk("checkpoint", "--checked", "12 related tests pass, full suite not run");
    expect(out).toContain("Checked: 12 related tests pass, full suite not run");
    expect(out).toContain("Nothing for a human to try. Use Review: what changed, why, which files.");
    expect(p.read("tasks", "T-001.md").split("---\n")[2] ?? "").toBe("");
  });

  it("nudges when nothing was checked or tested", () => {
    expect(started().wk("checkpoint")).toContain("Nothing checked or tested.");
  });

  it("keeps checked results to this checkpoint only", () => {
    const p = started();
    p.wk("checkpoint", "--checked", "75 tests pass");
    p.wk("start", "T-001");
    p.wk("checkpoint", "--test", "Try it");
    expect(p.read("tasks", "T-001.md")).not.toContain("checked:");
  });

  it("keeps each checked line short", () => {
    const r = started().raw("checkpoint", "--checked", "x".repeat(71));
    expect(r.stderr).toMatch(/A --checked line is 71 characters/);
  });
});

describe("handoff at every stop", () => {
  it("checkpoint and done remind the agent to hand off", () => {
    const p = started();
    expect(p.wk("checkpoint", "--checked", "ok")).toContain("Next: wk handoff");
    const done = p.wk("done", "T-001").split("\n");
    expect(done[1]).toBe("Handoff written from the next task (pass --handoff for more). Next task unrelated, or context heavy? Suggest a fresh session.");
  });

  it("checkpoint --handoff saves the note and shows the first tidy problem", () => {
    const p = started();
    p.wk("idea", "Parse config", "--force");
    const out = p.wk("checkpoint", "--checked", "ok", "--handoff", "Waiting on review.\nThen T-002.");
    expect(out).toContain("Tidy: Duplicate?");
    expect(out).toContain("Handoff saved. Next: send the check-in");
    expect(p.wk("brief")).toContain("Then T-002.");
  });

  it("done writes a handoff from the next task, or saves the one given", () => {
    const p = started();
    p.wk("add", "task", "Second piece of work");
    p.wk("checkpoint", "--checked", "ok");
    p.wk("done", "T-001");
    const brief = p.wk("brief");
    expect(brief).toMatch(/Done: T-001 .+\./);
    expect(brief).toContain("Next: T-002 Second piece of work");
    p.wk("start", "T-002");
    p.wk("checkpoint", "--checked", "ok");
    p.wk("done", "T-002", "--handoff", "All done for today.");
    expect(p.wk("brief")).toContain("All done for today.");
  });

  it("done archives done items older than a week, but leaves epics open", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    p.wk("add", "task", "Write the login page", "--epic", "E-001");
    p.wk("add", "task", "Add a logout button", "--epic", "E-001");
    p.on("2026-11-01", "done", "T-001", "--force");
    const out = p.wk("done", "T-002", "--force");
    expect(out).toContain("Archived 1 old done item.");
    expect(p.wk("tidy")).toContain("Finished: E-001");
  });

  it("brief flags a handoff older than the latest task change", () => {
    const p = project();
    p.wk("add", "task", "First");
    p.wk("handoff", "Stopped after First.");
    expect(p.wk("brief")).not.toContain("older than");
    expect(JSON.parse(p.wk("brief", "--json")).handoff_stale).toBe(false);

    // Backdate the handoff, as if work happened after it.
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(p.file("handoff.md"), old, old);
    expect(p.wk("brief")).toMatch(/^Handoff \(\d{4}-\d{2}-\d{2}, older than the latest task change\):$/m);
    expect(JSON.parse(p.wk("brief", "--json")).handoff_stale).toBe(true);
  });
});
