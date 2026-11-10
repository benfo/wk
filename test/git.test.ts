import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { git, gitInit, hasGit, project, tmpDir } from "./helpers.js";

describe.skipIf(!hasGit)("git features", () => {
  it("init puts .work/ at the repo top level, even from a subfolder", () => {
    const dir = tmpDir();
    gitInit(dir);
    const sub = path.join(dir, "packages", "app");
    fs.mkdirSync(sub, { recursive: true });
    run(["init", "--store", "repo"], { cwd: sub, home: tmpDir() });
    expect(fs.existsSync(path.join(dir, ".work", "config.yml"))).toBe(true);
    expect(fs.existsSync(path.join(sub, ".work"))).toBe(false);
  });

  it("start stays on the current branch by default", () => {
    const p = project({ git: true });
    p.wk("add", "task", "Refresh token endpoint");
    expect(p.wk("start", "T-001")).toBe("now   T-001 Refresh token endpoint\nOn branch: main");
    expect(git(p.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("start --branch creates <id>-<slug>", () => {
    const p = project({ git: true });
    p.wk("add", "task", "Refresh token endpoint");
    expect(p.wk("start", "T-001", "--branch")).toContain("Branch: T-001-refresh-token-endpoint");
    expect(git(p.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("T-001-refresh-token-endpoint");
  });

  it("an old branch_on_start: true still branches, unless --no-branch", () => {
    const p = project({ git: true });
    fs.writeFileSync(p.file("config.yml"), "branch_on_start: true\n" + p.read("config.yml"));
    p.wk("add", "task", "First");
    p.wk("add", "task", "Second");
    expect(p.wk("start", "T-001")).toContain("Branch: T-001-first");
    p.wk("done", "T-001", "--force");
    expect(p.wk("start", "T-002", "--no-branch")).toContain("On branch: T-001-first");
  });

  it("checkpoint summarises the diff and leaves .work/ out", () => {
    const p = project({ git: true });
    git(p.dir, "add", ".");
    git(p.dir, "commit", "-q", "-m", "wk init");
    p.wk("add", "task", "Change readme");
    p.wk("start", "T-001");
    fs.writeFileSync(path.join(p.dir, "README.md"), "hello\nworld\n");
    fs.writeFileSync(path.join(p.dir, "new.ts"), "export {};\n");
    const out = p.wk("checkpoint", "--test", "Readme says world");
    expect(out).toContain("Changed: 2 files (1 insertion(+))");
    expect(out).toContain("  README.md, new.ts");
    expect(out).not.toContain(".work");
  });

  it("start --branch outside git says so quietly", () => {
    const p = project();
    p.wk("add", "task", "No repo");
    expect(p.wk("start", "T-001", "--branch")).toBe("now   T-001 No repo\nNot a git repo, no branch created.");
  });
});
