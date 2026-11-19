import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/v2/run.js";
import { git, hasGit, project, TODAY } from "../helpers.js";

/** A v1 plan with every kind of item, built with the v1 CLI. */
function v1Plan(opts: { git?: boolean } = {}) {
  const p = project({ git: opts.git });
  p.wk("project", "What: a CLI for jokes\\nWho: me");
  p.wk("add", "epic", "Joke ratings");
  p.wk("add", "epic", "Old work");
  p.wk("add", "task", "Rate today's joke", "--epic", "E-001", "--tags", "cli");
  p.wk("add", "task", "Show rating badge", "--epic", "E-001", "--tags", "ui");
  p.wk("add", "task", "Write the readme", "--later");
  p.wk("add", "task", "Ship old thing", "--epic", "E-002");
  p.wk("start", "T-004");
  p.wk("checkpoint", "--checked", "ok");
  p.wk("done", "T-004");
  p.wk("move", "T-002", "--top");
  p.wk("block", "T-003", "waiting on docs host");
  p.wk("idea", "Skip jokes rated down", "--epic", "E-001");
  p.wk("idea", "Dark mode someday");
  p.wk("decide", "Store ratings in JSON", "--why", "Simple");
  p.wk("decide", "Store ratings in JSONL", "--why", "Appends");
  p.wk("supersede", "D-001", "D-002");
  p.wk("learn", "The API caps at 100 calls a minute");
  fs.writeFileSync(p.file("principles", "ui.md"), "# ui\n\n1. Use ASCII badges, never emoji.\n2. Keep output under 80 columns.\n");
  fs.writeFileSync(p.file("principles", "cli.md"), "# cli\n\n1. Never exit nonzero at shell start.\n");
  p.wk("handoff", "Ratings half done.");
  // E-002 is finished: close it the v1 way.
  p.wk("tidy", "--fix");
  return p;
}

const v2 = (p: { dir: string; home: string }, ...args: string[]) => run(args, { cwd: p.dir, home: p.home, today: TODAY });

describe("wk migrate", () => {
  it("converts every v1 kind and keeps old ids findable", () => {
    const p = v1Plan();
    expect(v2(p, "brief").stderr).toMatch(/v1 plan.*wk migrate/);
    const out = v2(p, "migrate");
    expect(out.code).toBe(0);
    expect(out.stdout.split("\n")[0]).toBe(
      "Migrated to v2: 2 epics → projects, 4 tasks, 2 ideas → someday tasks, 2 decisions, 1 learnings.",
    );
    expect(out.stdout).toContain("3 principles in 2 areas");
    expect(out.stdout).toMatch(/Backup of the v1 plan: .*\.work\.v1-backup/);

    const show = (id: string) => v2(p, "show", id).stdout;
    expect(show("T-001")).toMatch(/^\w{4}  task · open · queue · \w{4}\nRate today's joke\ntags: cli\nwas: T-001/);
    expect(show("T-3")).toContain("wait: waiting on docs host");
    expect(show("I-001")).toMatch(/task · open · someday · \w{4}\nSkip jokes rated down/);
    expect(show("I-002")).toMatch(/someday · core\nDark mode someday/);
    expect(show("D-001")).toMatch(/superseded_by: \w{4}/);
    expect(show("L-001")).toMatch(/learning · core\nThe API caps at 100 calls a minute/);
    expect(show("T-004")).toContain("archived");

    // The queue keeps v1's order: T-002 was moved to the top.
    const next = v2(p, "next").stdout.split("\n");
    expect(next[1]).toMatch(/^next   \w{4} Show rating badge/);
    expect(next[2]).toMatch(/^next   \w{4} Rate today's joke/);

    const projects = v2(p, "project").stdout;
    expect(projects).toMatch(/Joke ratings .* 0\/3/);
    expect(projects).not.toContain("Old work");
    expect(v2(p, "project", "show", "E-001").stdout).toContain("touches: cli, ui");
    expect(v2(p, "area").stdout.split("\n").map((l) => l.split(/\s+/)[0])).toEqual(["cli", "core", "ui"]);
    expect(v2(p, "ls", "principle", "ui").stdout.split("\n")).toHaveLength(2);
    expect(v2(p, "review", "--all").stdout).toContain("lacks instead");
    expect(v2(p, "summary").stdout).toBe("What: a CLI for jokes\nWho: me");
    expect(v2(p, "brief").stdout).toContain("  Ratings half done.");
    expect(fs.existsSync(p.file("tasks"))).toBe(false);
    expect(v2(p, "migrate").stdout).toBe("Already a v2 plan. Nothing to migrate.");
  });

  it.skipIf(!hasGit)("refuses an uncommitted plan in git, and keeps no backup when git has it", () => {
    const p = v1Plan({ git: true });
    p.wk("config", "set", "git.branch", "epic");
    p.wk("config", "set", "git.commit", "checkpoint");
    git(p.dir, "add", "-A");
    git(p.dir, "commit", "-q", "-m", "plan");
    p.wk("handoff", "Changed after the commit.");
    expect(v2(p, "migrate").stderr).toMatch(/uncommitted changes/);
    git(p.dir, "commit", "-qam", "handoff");
    const out = v2(p, "migrate").stdout;
    expect(out).toContain("The v1 plan is in git history.");
    expect(fs.existsSync(path.join(p.dir, ".work.v1-backup"))).toBe(false);
    expect(fs.readFileSync(p.file("config.yml"), "utf8")).toMatch(/branch: project\n\s+commit: check/);
    expect(fs.readFileSync(p.file("config.yml"), "utf8")).toContain("preset: software");
  });
});
