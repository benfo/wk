import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { git, gitInit, hasGit, tmpDir, TODAY } from "./helpers.js";

/** Files exactly as a v1 wk wrote them: every kind of item, one finished epic, two principle files. */
const V1_FILES: Record<string, string> = {
  "config.yml": "store: repo\nprinciples_dir: principles\ncounters: { E: 2, T: 4, I: 2, D: 2, L: 1 }\ngit:\n  branch:\n  commit:\n",
  "project.md": "What: a CLI for jokes\nWho: me\n",
  "handoff.md": "Ratings half done.\n",
  "epics/E-001.md": "---\nid: E-001\ntitle: Joke ratings\nstatus: open\ntags: []\ncreated: 2026-11-01\nupdated: 2026-11-01\n---\n## Scope\n\nRate jokes.\n",
  "epics/E-002.md": "---\nid: E-002\ntitle: Old work\nstatus: done\ntags: []\ncreated: 2026-10-01\nupdated: 2026-10-20\ndone_on: 2026-10-20\n---\n",
  "tasks/T-001.md": "---\nid: T-001\ntitle: Rate today's joke\nepic: E-001\nstatus: next\ntags: [cli]\ncreated: 2026-11-01\nupdated: 2026-11-01\n---\n",
  "tasks/T-002.md": "---\nid: T-002\ntitle: Show rating badge\nepic: E-001\nstatus: next\nrank: 0\ntags: [ui]\ncreated: 2026-11-01\nupdated: 2026-11-01\n---\n",
  "tasks/T-003.md": "---\nid: T-003\ntitle: Write the readme\nepic:\nstatus: later\ntags: []\nblocked: true\nblocked_reason: waiting on docs host\ncreated: 2026-11-01\nupdated: 2026-11-02\n---\n",
  "tasks/T-004.md": "---\nid: T-004\ntitle: Ship old thing\nepic: E-002\nstatus: done\ntags: []\ncreated: 2026-10-01\nupdated: 2026-10-20\ndone_on: 2026-10-20\n---\n",
  "ideas/I-001.md": "---\nid: I-001\nepic: E-001\ncreated: 2026-11-01\nupdated: 2026-11-01\n---\nSkip jokes rated down\n",
  "ideas/I-002.md": "---\nid: I-002\ncreated: 2026-11-01\nupdated: 2026-11-01\n---\nDark mode someday\n",
  "decisions/D-001.md": "---\nid: D-001\ntitle: Store ratings in JSON\nstatus: superseded\nsuperseded_by: D-002\ncreated: 2026-11-01\nupdated: 2026-11-02\n---\nWhy: Simple\n",
  "decisions/D-002.md": "---\nid: D-002\ntitle: Store ratings in JSONL\nstatus: active\nsupersedes: D-001\ncreated: 2026-11-02\nupdated: 2026-11-02\n---\nWhy: Appends\n",
  "learnings/L-001.md": "---\nid: L-001\ncreated: 2026-11-02\nupdated: 2026-11-02\n---\nThe API caps at 100 calls a minute\n",
  "principles/ui.md": "# ui\n\n1. Use ASCII badges, never emoji.\n2. Keep output under 80 columns.\n",
  "principles/cli.md": "# cli\n\n1. Never exit nonzero at shell start.\n",
  "principles/arch.md": "# arch\n\n",
  "archive/.gitkeep": "",
};

function v1Plan(opts: { git?: boolean; config?: string } = {}) {
  const dir = tmpDir();
  const home = tmpDir();
  if (opts.git) gitInit(dir);
  for (const [rel, text] of Object.entries(V1_FILES)) {
    const file = path.join(dir, ".work", ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rel === "config.yml" && opts.config ? opts.config : text);
  }
  const file = (...parts: string[]) => path.join(dir, ".work", ...parts);
  return { dir, home, file, handoff: (text: string) => fs.writeFileSync(file("handoff.md"), text) };
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
    const p = v1Plan({ git: true, config: "store: repo\ncounters: { E: 2 }\ngit:\n  branch: epic\n  commit: checkpoint\n" });
    git(p.dir, "add", "-A");
    git(p.dir, "commit", "-q", "-m", "plan");
    p.handoff("Changed after the commit.\n");
    expect(v2(p, "migrate").stderr).toMatch(/uncommitted changes/);
    git(p.dir, "commit", "-qam", "handoff");
    const out = v2(p, "migrate").stdout;
    expect(out).toContain("The v1 plan is in git history.");
    expect(fs.existsSync(path.join(p.dir, ".work.v1-backup"))).toBe(false);
    expect(fs.readFileSync(p.file("config.yml"), "utf8")).toMatch(/branch: project\n\s+commit: check/);
    expect(fs.readFileSync(p.file("config.yml"), "utf8")).toContain("preset: software");
  });
});
