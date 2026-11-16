import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

describe("ideas, decisions and learnings", () => {
  it("captures an idea in one line and links an epic", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    expect(p.wk("idea", "Passkeys instead of passwords", "--epic", "E-001")).toBe("Captured as I-001");
    expect(p.read("ideas", "I-001.md")).toContain("epic: E-001");
    expect(p.raw("idea", "a\\nb\\nc").stderr).toMatch(/Idea is 3 lines, limit is 2/);
    expect(p.raw("idea", "Passkeys over passwords").stderr).toContain("Similar: I-001");
  });

  it("records a decision with what, why and rejected", () => {
    const p = project();
    expect(p.wk("decide", "Use JWT for sessions", "--why", "Stateless API.", "--rejected", "Server sessions")).toBe(
      "Recorded D-001 Use JWT for sessions",
    );
    const file = p.read("decisions", "D-001.md");
    expect(file).toContain("title: Use JWT for sessions\nstatus: active");
    expect(file).toContain("## Why\n\nStateless API.\n\n## Rejected\n\nServer sessions");
    expect(p.raw("decide", "No reason").stderr).toMatch(/needs a reason/);
    expect(p.raw("decide", "X", "--why", "a\\nb\\nc").stderr).toMatch(/Why is 3 lines, limit is 2/);
    expect(p.raw("decide", "X", "--why", "a", "--rejected", "a\\nb").stderr).toMatch(/Rejected is 2 lines, limit is 1/);
  });

  it("records a learning", () => {
    const p = project();
    expect(p.wk("learn", "Vitest needs --pool forks on Windows CI")).toBe("Recorded L-001");
    expect(p.wk("show", "L-001")).toContain("Vitest needs --pool forks on Windows CI");
  });
});

describe("wk principles", () => {
  it("prints rules for the tags asked for and names the gaps", () => {
    const p = project();
    fs.writeFileSync(p.file("principles", "ui.md"), "# ui\n\n1. Use design tokens, never raw hex.\n2. Every form has an empty state.\n");
    const out = p.wk("principles", "--tags", "ui,arch,api");
    const lines = out.split("\n");
    expect(lines.slice(0, 3)).toEqual(["ui:", "  1. Use design tokens, never raw hex.", "  2. Every form has an empty state."]);
    expect(out).toContain("No arch principles yet (");
    expect(out).toContain(`${path.join("principles", "api.md")})`);
    expect(JSON.parse(p.wk("principles", "--tags", "ui", "--json")).rules.ui).toHaveLength(2);
  });

  it("lists tags with rule counts when none are given", () => {
    const p = project();
    expect(p.wk("principles").split("\n")[0]).toBe("Tags: arch (0), ui (0)");
  });

  it("reads principles from an absolute principles_dir", () => {
    const p = project();
    const shared = path.join(p.dir, "shared-principles");
    fs.mkdirSync(shared);
    fs.writeFileSync(path.join(shared, "arch.md"), "1. One module, one job.\n");
    const config = p.read("config.yml").replace(/^principles_dir:.*$/m, `principles_dir: ${JSON.stringify(shared)}`);
    fs.writeFileSync(p.file("config.yml"), config);
    expect(p.wk("principles", "--tags", "arch")).toBe("arch:\n  1. One module, one job.");
    expect(p.wk("brief")).not.toContain("No principles yet.");
  });
});

describe("wk guide", () => {
  it("prints the agent rules in full, without the skill frontmatter", () => {
    const p = project();
    const out = p.wk("guide");
    expect(out.startsWith("# wk")).toBe(true);
    expect(out).not.toContain("description:");
    expect(out).toContain("Start with `wk brief`");
    expect(out.split("\n").length).toBeGreaterThan(10);
  });

  it("prints a side guide by topic, and names the topics on a typo", () => {
    const p = project();
    expect(p.wk("guide", "onboarding")).toContain("# wk onboarding");
    expect(p.wk("guide", "setup")).toContain("wk config set git.branch");
    expect(p.raw("guide", "nope").stderr).toContain("Topics: setup, onboarding.");
  });
});
