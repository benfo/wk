import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { git, hasGit } from "./helpers.js";
import { plan } from "./helpers.js";

describe("skills and guides", () => {
  it("installs both skills and the pointer, and refreshes them on rerun", () => {
    const p = plan();
    for (const s of ["wk", "wk-setup"]) expect(fs.existsSync(path.join(p.dir, ".claude", "skills", s, "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(p.dir, "AGENTS.md"), "utf8")).toContain("`wk guide`");
    fs.writeFileSync(path.join(p.dir, ".claude", "skills", "wk", "SKILL.md"), "stale");
    p.wk("init");
    expect(fs.readFileSync(path.join(p.dir, ".claude", "skills", "wk", "SKILL.md"), "utf8")).toMatch(/^---\r?\nname: wk/);
  });

  it("prints the rules and every guide, without frontmatter", () => {
    const p = plan();
    expect(p.wk("guide").split("\n")[0]).toBe("# wk");
    for (const t of ["setup", "onboarding", "migrate", "triage", "review", "close", "principles"]) {
      expect(p.wk("guide", t)).toMatch(/^# /);
    }
    expect(p.raw("guide", "nope").stderr).toMatch(/^No guide "nope"/);
  });

  it("keeps the shipped skill and guides free of project-specific names", () => {
    const root = path.resolve(__dirname, "..");
    const files = [
      ...["wk", "wk-setup"].map((s) => path.join(root, "skills", s, "SKILL.md")),
      ...fs.readdirSync(path.join(root, "guides")).map((f) => path.join(root, "guides", f)),
    ];
    for (const f of files) expect(fs.readFileSync(f, "utf8")).not.toMatch(/dadjoke|dad joke|benfo|wk-testing/i);
  });
});

describe("presets", () => {
  it.skipIf(!hasGit)("defaults to software in a git repo: seeds tags and a code area", () => {
    const p = plan({ git: true });
    expect(p.read("config.yml")).toContain("preset: software");
    expect(p.read("config.yml")).toMatch(/tags: \[bug, quick, perf, ux\]/);
    expect(p.wk("area").split("\n").map((l) => l.split(/\s+/)[0])).toEqual(["code", "core"]);
  });

  it("uses general outside git, and takes --preset", () => {
    const p = plan();
    expect(p.read("config.yml")).toContain("preset: general");
    expect(p.wk("area").split("\n")).toHaveLength(1);
    const q = plan({ init: false });
    expect(q.raw("init", "--store", "repo", "--preset", "music").stderr).toMatch(/Unknown preset "music"/);
    expect(q.wk("init", "--store", "repo", "--preset", "software")).toMatch(/preset: software/);
  });
});

describe("setup, workflow and drift", () => {
  it("lists instruction files and the workflow, records fingerprints, and flags changes", () => {
    const p = plan();
    fs.appendFileSync(path.join(p.dir, "AGENTS.md"), "\nAlways update ROADMAP.md when a task is done.\n");
    fs.mkdirSync(path.join(p.dir, ".claude", "skills", "wrap-up"), { recursive: true });
    fs.writeFileSync(path.join(p.dir, ".claude", "skills", "wrap-up", "SKILL.md"), "---\nname: wrap-up\n---\nSync ROADMAP.md\n");
    p.wk("add", "Fix the banner");
    expect(p.wk("brief")).toContain("Setup not recorded");
    const out = p.wk("setup").split("\n");
    expect(out[0]).toBe("Instructions: AGENTS.md, .claude/skills/wrap-up/SKILL.md");
    expect(out).toContain("Not set: checks.quick, checks.full");
    p.wk("config", "set", "checks.quick", "npm test -- --changed");
    p.wk("config", "set", "checks.full", "npm test");
    expect(p.wk("setup", "--done")).toMatch(/^Recorded 2 instruction files/);
    expect(p.wk("brief")).not.toMatch(/Setup not recorded|changed since setup/);
    expect(p.wk("brief")).toContain("Workflow: quick checks: npm test -- --changed; full checks: npm test.");

    fs.appendFileSync(path.join(p.dir, "AGENTS.md"), "Use tabs.\n");
    fs.writeFileSync(path.join(p.dir, "CLAUDE.md"), "Be brief.\n");
    expect(p.wk("brief")).toContain("Instructions changed since setup: AGENTS.md (changed), CLAUDE.md (new). Recheck (wk-setup skill).");
    expect(p.wk("setup").split("\n")[0]).toBe("Instructions: AGENTS.md (changed), CLAUDE.md (new), .claude/skills/wrap-up/SKILL.md");
  });

  it("ignores wk's own pointer and line endings when fingerprinting", () => {
    const p = plan();
    fs.writeFileSync(path.join(p.dir, "AGENTS.md"), "Be kind.\n");
    p.wk("setup", "--done");
    fs.writeFileSync(path.join(p.dir, "AGENTS.md"), "Be kind.\r\n");
    p.wk("init");
    p.wk("add", "Fix the banner");
    expect(p.wk("brief")).not.toContain("changed since setup");
  });

  it("names quick checks on start and full checks at the end of a session", () => {
    const p = plan();
    p.wk("config", "set", "checks.quick", "npm test");
    p.wk("config", "set", "checks.full", "npm run ci");
    const a = /Added (\w{4})/.exec(p.wk("add", "Fix the banner"))![1];
    expect(p.wk("start", a)).toContain("Checks: run npm test before wk check.");
    expect(p.wk("handoff", "Stopping.")).toContain("Run the full checks first if they have not run: npm run ci");
    expect(p.raw("config", "set", "git.branch", "always").stderr).toMatch(/must be one of: none, task, project/);
    expect(p.wk("config", "set", "workflow.checks.quick", "")).toBe("checks.quick: (cleared)\nWorkflow: full checks: npm run ci.");
  });
});

describe("add --from", () => {
  it("adds all lines or none, listing every problem", () => {
    const p = plan();
    p.wk("add", "Fix the banner");
    const bad = p.with({ stdin: `- [ ] Write the readme\n- Fix banner\n${"x".repeat(75)}\n` }, "add", "--from", "-");
    expect(bad.stderr.split("\n")).toEqual([
      "Line 2: Similar: " + bad.stderr.split("Similar: ")[1].split("\n")[0],
      "Line 3: Line 3 is 75 characters, limit is 70 (5 over). Shorten it.",
      "Nothing added. Fix those lines and rerun.",
    ]);
    expect(p.wk("ls").split("\n")).toHaveLength(1);
    const ok = p.with({ stdin: "1. Write the readme\n* Ship it\n" }, "add", "--from", "-", "--when", "someday").stdout;
    expect(ok.split("\n")[0]).toBe("Added 2 tasks:");
    expect(p.wk("ls", "someday").split("\n")).toHaveLength(2);
  });
});

describe.skipIf(!hasGit)("personal stores", () => {
  it("leaves tracked files alone and hides the skills", () => {
    const p = plan({ git: true, store: "local" });
    expect(fs.existsSync(path.join(p.dir, "AGENTS.md"))).toBe(false);
    expect(git(p.dir, "status", "--porcelain")).toBe("");
  });
});
