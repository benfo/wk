import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

const SUMMARY = "wk: a CLI that tracks work as markdown.\\nFor: one developer with agents.\\nOut of scope: team sync.";

describe("project summary", () => {
  it("is missing until written, and brief says so", () => {
    const p = project();
    expect(p.wk("project")).toMatch(/^No project summary yet\. Write one: wk project/);
    expect(p.wk("brief")).toContain("No project summary yet.");
    expect(JSON.parse(p.wk("brief", "--json")).project).toBeNull();
  });

  it("saves, shows in full and puts only the first line in brief", () => {
    const p = project();
    expect(p.wk("project", SUMMARY)).toBe("Project summary saved (3 lines).");
    expect(p.read("project.md")).toBe("wk: a CLI that tracks work as markdown.\nFor: one developer with agents.\nOut of scope: team sync.\n");
    expect(p.wk("project")).toBe("wk: a CLI that tracks work as markdown.\nFor: one developer with agents.\nOut of scope: team sync.");
    const brief = p.wk("brief");
    expect(brief).toContain("Project: wk: a CLI that tracks work as markdown.");
    expect(brief).not.toContain("For: one developer");
    expect(brief).not.toContain("No project summary");
  });

  it("overwrites and keeps to 8 lines", () => {
    const p = project();
    expect(p.raw("project", "1\\n2\\n3\\n4\\n5\\n6\\n7\\n8\\n9").stderr).toMatch(/Project summary is 9 lines, limit is 8/);
    p.wk("project", "first");
    expect(p.wk("project", "second")).toBe("Project summary saved (1 line).");
    expect(p.read("project.md")).toBe("second\n");
    expect(p.raw("project", "  ").stderr).toMatch(/Project summary is empty/);
  });

  it("comes after the onboarding notice on an empty plan", () => {
    const p = project();
    const lines = p.wk("brief").split("\n");
    expect(lines[0]).toMatch(/^Empty plan\./);
    expect(lines[1]).toBe("No project summary yet.");
  });
});
