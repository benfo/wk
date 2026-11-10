import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_POINTER } from "../src/commands/init.js";
import { projectSlug, remotePath } from "../src/context.js";
import { run } from "../src/run.js";
import { git, gitInit, hasGit, project, tmpDir } from "./helpers.js";

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");

describe("wk init --store repo", () => {
  it("creates the layout, config, principles, skill and AGENTS.md pointer", () => {
    const p = project();
    for (const dir of ["epics", "tasks", "ideas", "decisions", "learnings", "archive", "principles"]) {
      expect(fs.statSync(p.file(dir)).isDirectory()).toBe(true);
    }
    expect(fs.existsSync(p.file("tasks", ".gitkeep"))).toBe(true);
    expect(p.read("config.yml")).toMatch(/^store: repo /);
    expect(p.read("config.yml")).toContain("counters: { E: 0, T: 0, I: 0, D: 0, L: 0 }");
    expect(p.read("principles", "arch.md")).not.toMatch(/^\d+\./m);
    expect(fs.existsSync(p.file("handoff.md"))).toBe(true);
    expect(read(p.dir, ".claude", "skills", "wk", "SKILL.md")).toContain("name: wk");
    expect(read(p.dir, "AGENTS.md")).toBe(AGENT_POINTER + "\n");
    // No CLAUDE.md is created; Claude finds the skill on its own.
    expect(fs.existsSync(path.join(p.dir, "CLAUDE.md"))).toBe(false);
  });

  it("is safe to rerun: keeps data, refreshes the skill, adds the pointer once", () => {
    const p = project();
    p.wk("add", "task", "Keep me");
    const skill = path.join(p.dir, ".claude", "skills", "wk", "SKILL.md");
    fs.writeFileSync(skill, "stale");
    expect(p.wk("init")).toContain("Already set up (store: repo)");
    expect(read(skill)).toContain("name: wk");
    expect(p.wk("ls")).toContain("T-001 Keep me");
    expect(read(p.dir, "AGENTS.md").split(AGENT_POINTER)).toHaveLength(2);
    expect(p.wk("init", "--store", "home")).toContain("Not moving it");
  });

  it("adds the pointer to an existing CLAUDE.md and upgrades the old pointer line", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# My rules");
    fs.writeFileSync(
      path.join(dir, "AGENTS.md"),
      "# Agents\n\nTrack work with the `wk` CLI: follow .claude/skills/wk/SKILL.md and start every session with `wk brief`.\n",
    );
    expect(run(["init", "--store", "repo"], { cwd: dir, home: tmpDir() }).stdout).toContain(
      "Added the wk pointer to AGENTS.md and CLAUDE.md",
    );
    expect(read(dir, "CLAUDE.md")).toBe(`# My rules\n\n${AGENT_POINTER}\n`);
    expect(read(dir, "AGENTS.md")).toBe(`# Agents\n\n${AGENT_POINTER}\n`);
  });

  it("ignores a leftover mode key in config.yml", () => {
    const p = project();
    fs.writeFileSync(p.file("config.yml"), "mode: work\n" + p.read("config.yml"));
    expect(p.wk("add", "task", "Still works")).toBe("T-001 Still works");
  });

  it("finds the root from a subfolder", () => {
    const p = project();
    const sub = path.join(p.dir, "src", "deep");
    fs.mkdirSync(sub, { recursive: true });
    expect(run(["add", "task", "From below"], { cwd: sub, home: p.home }).stdout).toBe("T-001 From below");
  });
});

describe("choosing a store", () => {
  it("refuses to guess: no --store lists the choices", () => {
    const r = run(["init"], { cwd: tmpDir(), home: tmpDir() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Choose where to keep the plan:");
    expect(r.stderr).toContain("wk init --store local");
    expect(run(["init", "--store", "cloud"], { cwd: tmpDir(), home: tmpDir() }).stderr).toContain('Unknown store "cloud"');
  });

  it("home keeps the plan outside the project", () => {
    const p = project({ store: "home" });
    expect(fs.existsSync(path.join(p.dir, ".work"))).toBe(false);
    expect(fs.existsSync(path.join(p.dir, "AGENTS.md"))).toBe(false);
    const projects = fs.readdirSync(path.join(p.home, "projects"));
    expect(projects).toHaveLength(1);
    expect(read(p.home, "projects", projects[0], "config.yml")).toMatch(/^store: home /);
    expect(fs.existsSync(path.join(p.home, "projects", projects[0], "tasks", ".gitkeep"))).toBe(false);
    // Commands find it from the project, and from a subfolder.
    expect(p.wk("add", "task", "Lives at home")).toBe("T-001 Lives at home");
    const sub = path.join(p.dir, "sub");
    fs.mkdirSync(sub);
    expect(run(["ls"], { cwd: sub, home: p.home }).stdout).toBe("next   T-001 Lives at home");
  });

  it("reports a missing plan with the store choices", () => {
    const r = run(["next"], { cwd: tmpDir(), home: tmpDir() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Run: wk init --store <repo|ignore|local|home>");
    expect(JSON.parse(run(["next", "--json"], { cwd: tmpDir(), home: tmpDir() }).stdout).error).toContain("No wk plan");
  });

  it("ignore and local need git", () => {
    expect(run(["init", "--store", "local"], { cwd: tmpDir(), home: tmpDir() }).stderr).toMatch(/needs a git repo/);
  });
});

describe.skipIf(!hasGit)("stores in a git repo", () => {
  it("ignore lists .work/ and the skill in .gitignore and points AGENTS.md at wk", () => {
    const p = project({ git: true, store: "ignore" });
    expect(read(p.dir, ".gitignore")).toBe("# wk\n.work/\n.claude/skills/wk/\n");
    expect(read(p.dir, "AGENTS.md")).toContain("wk guide");
    expect(git(p.dir, "status", "--porcelain")).toBe("?? .gitignore\n?? AGENTS.md");
    p.wk("init");
    expect(read(p.dir, ".gitignore").match(/\.work\//g)).toHaveLength(1);
  });

  it("local uses .git/info/exclude and leaves tracked files alone", () => {
    const p = project({ git: true, store: "local" });
    expect(read(p.dir, ".git", "info", "exclude")).toContain("# wk\n.work/\n.claude/skills/wk/\n");
    expect(fs.existsSync(path.join(p.dir, ".gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(p.dir, "AGENTS.md"))).toBe(false);
    expect(git(p.dir, "status", "--porcelain")).toBe("");
    expect(p.wk("init")).toContain("Already set up (store: local)");
  });

  it("home excludes the skill copy and slugs the plan by remote", () => {
    const p = project({ git: true, init: false });
    git(p.dir, "remote", "add", "origin", "git@github.com:Acme/My.App.git");
    p.wk("init", "--store", "home");
    expect(fs.existsSync(path.join(p.home, "projects", "acme-my-app", "config.yml"))).toBe(true);
    expect(read(p.dir, ".git", "info", "exclude")).toContain(".claude/skills/wk/");
    expect(git(p.dir, "status", "--porcelain")).toBe("");
  });

  it("parses remote URLs into slugs", () => {
    expect(remotePath("git@github.com:acme/app.git")).toBe("acme/app");
    expect(remotePath("https://github.com/acme/app")).toBe("acme/app");
    expect(remotePath("ssh://git@host:22/team/app.git")).toBe("team/app");
    const dir = tmpDir();
    gitInit(dir);
    expect(projectSlug(dir)).toMatch(new RegExp(`^${path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-[0-9a-f]{8}$`));
  });
});
