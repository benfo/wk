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
    expect(done[1]).toBe("Next: wk handoff (keeps a fresh session safe). Next task unrelated, or context heavy? Suggest a fresh session.");
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
