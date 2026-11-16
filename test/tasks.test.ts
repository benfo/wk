import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { project, type Project } from "./helpers.js";

/** The handoff file's local date, as wk brief prints it. */
function handoffDate(p: Project): string {
  const d = fs.statSync(p.file("handoff.md")).mtime;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("adding tasks and epics", () => {
  it("creates a task file in the spec's format and bumps the counter", () => {
    const p = project();
    expect(p.wk("add", "epic", "Auth rework")).toBe("E-001 Auth rework");
    expect(p.wk("add", "task", "Refresh token endpoint", "--epic", "e1", "--tags", "API, ui")).toBe("T-001 Refresh token endpoint");
    const file = p.read("tasks", "T-001.md");
    expect(file).toContain("id: T-001\ntitle: Refresh token endpoint\nepic: E-001\nstatus: next\ntags: [api, ui]\nref:\n");
    expect(file).toContain("created: 2026-11-10");
    expect(p.read("config.yml")).toContain("counters: { E: 1, T: 1, I: 0, D: 0, L: 0 }");
    expect(p.read("epics", "E-001.md")).toContain("## Scope\n\n## Out of scope\n\n## Acceptance");
  });

  it("adds later tasks and refuses unknown epics", () => {
    const p = project();
    p.wk("add", "task", "Someday thing", "--later");
    expect(p.read("tasks", "T-001.md")).toContain("status: later");
    const r = p.raw("add", "task", "Orphan", "--epic", "E-009");
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("E-009 not found.");
  });

  it("enforces title and body limits", () => {
    const p = project();
    expect(p.raw("add", "task", "x".repeat(71)).stderr).toMatch(/limit is 70/);
    expect(p.raw("add", "task", "Wordy", "--body", "1\\n2\\n3\\n4\\n5\\n6\\n7").stderr).toMatch(/Task body is 7 lines, limit is 6/);
    expect(fs.readdirSync(p.file("tasks")).filter((f) => f.endsWith(".md"))).toHaveLength(0);
  });

  it("stops on a similar open task or idea, and --force overrides", () => {
    const p = project();
    p.wk("add", "task", "Refresh token flow");
    p.wk("idea", "Dark mode toggle");
    const r = p.raw("add", "task", "Refresh token endpoint");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Similar: T-001 Refresh token flow");
    expect(p.raw("add", "task", "Dark mode toggles").stderr).toContain("Similar: I-001 Dark mode toggle");
    expect(p.wk("add", "task", "Refresh token endpoint", "--force")).toBe("T-002 Refresh token endpoint");
  });

  it("ignores done tasks when checking for duplicates", () => {
    const p = project();
    p.wk("add", "task", "Refresh token flow");
    p.wk("done", "T-001", "--force");
    expect(p.wk("add", "task", "Refresh token flow again")).toBe("T-002 Refresh token flow again");
  });
});

describe("the task flow", () => {
  it("start prints the task body and its principles, beyond the line cap", () => {
    const p = project();
    p.wk("add", "task", "Login form", "--tags", "ui,api");
    p.wk("edit", "T-001", "--body", "Email and password.\\nShow errors inline.");
    fs.writeFileSync(p.file("principles", "ui.md"), Array.from({ length: 12 }, (_, i) => `${i + 1}. Rule ${i + 1}`).join("\n"));
    const out = p.wk("start", "T-001").split("\n");
    expect(out.slice(0, 5)).toEqual(["now   T-001 Login form", "", "Email and password.", "Show errors inline.", ""]);
    expect(out).toContain("Principles:");
    expect(out).toContain("  12. Rule 12");
    expect(out.at(-1)).toMatch(/^No api principles yet/);
  });

  it("next → now → review → done", () => {
    const p = project();
    p.wk("add", "task", "First thing");
    p.wk("add", "task", "Second thing");
    expect(p.wk("start", "T-1")).toBe("now   T-001 First thing");
    expect(p.raw("start", "T-002").stderr).toBe("T-001 is already now. Checkpoint or block it first.");

    expect(p.raw("done", "T-001").stderr).toMatch(/not review/);
    const cp = p.wk("checkpoint", "--test", "Click save, expect a toast", "--test", "Empty form shows errors");
    expect(cp).toContain("review T-001 First thing");
    expect(cp).toContain("Test (you): Click save, expect a toast");
    expect(cp).toContain("Next: wk handoff (keeps a fresh session safe), send the check-in (Done/Checked/Try/Next), then wk done T-001 once the user confirms.");
    expect(p.read("tasks", "T-001.md")).toContain("Test: Click save, expect a toast\nTest: Empty form shows errors");

    expect(p.wk("done", "T-001").split("\n")[0]).toBe("done  T-001 First thing");
    expect(p.read("tasks", "T-001.md")).toContain("done_on: 2026-11-10");
    expect(p.wk("start", "T-002")).toBe("now   T-002 Second thing");
  });

  it("checkpoint replaces old tests, keeps notes, and refuses with nothing in progress", () => {
    const p = project();
    expect(p.raw("checkpoint").stderr).toMatch(/Nothing is now/);
    p.wk("add", "task", "Thing", "--body", "Test: old one\\nUse the v2 API.");
    p.wk("start", "T-001");
    p.wk("checkpoint", "--test", "new one");
    const body = p.read("tasks", "T-001.md").split("---\n")[2];
    expect(body).toBe("Test: new one\n\nUse the v2 API.\n");

    p.wk("start", "T-001");
    expect(p.wk("checkpoint")).toContain("Test (you): new one");
  });

  it("checkpoint refuses tests that push the body over 6 lines", () => {
    const p = project();
    p.wk("add", "task", "Thing", "--body", "a\\nb\\nc\\nd");
    p.wk("start", "T-001");
    const r = p.raw("checkpoint", "--test", "one", "--test", "two");
    expect(r.stderr).toMatch(/limit is 6/);
    expect(p.read("tasks", "T-001.md")).toContain("status: now");
  });

  it("done --force skips review", () => {
    const p = project();
    p.wk("add", "task", "Typo fix");
    expect(p.wk("done", "T-001", "--force")).toContain("Handoff written");
  });

  it("block and unblock toggle the flag, and blocked tasks can't start", () => {
    const p = project();
    p.wk("add", "task", "Needs API");
    expect(p.wk("block", "T-001", "Waiting on backend")).toBe("blocked T-001 Needs API: Waiting on backend");
    expect(p.read("tasks", "T-001.md")).toContain("blocked: true\nblocked_reason: Waiting on backend");
    expect(p.raw("start", "T-001").stderr).toMatch(/blocked: Waiting on backend/);
    expect(p.wk("unblock", "T-001")).toBe("unblocked T-001 Needs API");
    expect(p.read("tasks", "T-001.md")).not.toContain("blocked_reason");
  });

  it("rejects ids of the wrong kind", () => {
    const p = project();
    p.wk("idea", "Something");
    expect(p.raw("start", "I-001").stderr).toBe("I-001 is a idea, expected task.");
    expect(p.raw("start", "nope").stderr).toMatch(/not an id/);
  });
});

describe("wk next and wk brief", () => {
  it("lists now, up to 5 next, and blocked or undecided tasks", () => {
    const p = project();
    for (let i = 1; i <= 7; i++) p.wk("add", "task", `Task number ${["one", "two", "three", "four", "five", "six", "seven"][i - 1]}`, "--force");
    p.wk("add", "task", "Pick a database", "--needs-decision");
    p.wk("start", "T-001");
    p.wk("block", "T-002", "Waiting");
    const out = p.wk("next").split("\n");
    expect(out[0]).toBe("now   T-001 Task number one");
    expect(out.filter((l) => l.startsWith("next "))).toHaveLength(5);
    expect(out.some((l) => l.includes("more next"))).toBe(false);
    expect(out).toContain("stuck T-002 Task number two [blocked: Waiting]");
    expect(out).toContain("stuck T-008 Pick a database [needs decision]");
    expect(out.length).toBeLessThanOrEqual(10);

    p.wk("unblock", "T-002");
    expect(p.wk("next")).toContain("      +1 more next (wk ls --status next)");
  });

  it("shows tasks waiting in review", () => {
    const p = project();
    p.wk("add", "task", "Built thing");
    p.wk("start", "T-001");
    p.wk("checkpoint", "--test", "Try it");
    const out = p.wk("next");
    expect(out).toContain("review T-001 Built thing (waiting for a human test)");
    expect(out).not.toContain("Nothing queued");
    expect(p.wk("brief")).toContain("review T-001 Built thing");
    expect(p.wk("status")).toContain("No epic\n  review T-001 Built thing");
  });

  it("prints a hint when nothing is queued", () => {
    const p = project();
    expect(p.wk("next")).toContain("Nothing queued");
  });

  it("brief shows the handoff, the now task, next tasks and the principles gap", () => {
    const p = project();
    p.wk("add", "task", "Do the thing");
    p.wk("handoff", "Stopped mid refactor.\\nRun tests first.");
    const out = p.wk("brief");
    expect(out).toBe(
      ["No project summary yet.", "No principles yet.", `Handoff (${handoffDate(p)}):`, "  Stopped mid refactor.", "  Run tests first.", "now   (nothing in progress)", "next  T-001 Do the thing"].join("\n"),
    );
    fs.writeFileSync(p.file("principles", "arch.md"), "# arch\n\n1. Keep modules small.\n");
    expect(p.wk("brief")).not.toContain("No principles yet.");
    expect(JSON.parse(p.wk("brief", "--json")).no_principles).toBe(false);
  });

  it("handoff is limited to 5 lines and overwrites", () => {
    const p = project();
    expect(p.raw("handoff", "1\\n2\\n3\\n4\\n5\\n6").stderr).toMatch(/Handoff is 6 lines, limit is 5/);
    p.wk("handoff", "first");
    p.wk("handoff", "second");
    expect(p.read("handoff.md")).toBe("second\n");
  });
});

describe("wk show, ls and status", () => {
  it("show prints one item in full, beyond the line cap", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    p.wk("edit", "E-001", "--body", Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\\n"));
    const out = p.wk("show", "E-001").split("\n");
    expect(out[0]).toBe("E-001 Auth rework");
    expect(out).toContain("line 11");
  });

  it("ls filters by kind, epic, tag and status, and hides archived items", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    p.wk("add", "task", "Refresh tokens", "--epic", "E-001", "--tags", "api");
    p.wk("add", "task", "Login page", "--tags", "ui");
    p.wk("add", "task", "Settings later", "--later");
    p.wk("idea", "Passkeys");
    expect(p.wk("ls")).toBe(["next   T-001 Refresh tokens", "next   T-002 Login page", "later  T-003 Settings later"].join("\n"));
    expect(p.wk("ls", "--epic", "E-001")).toBe("next   T-001 Refresh tokens");
    expect(p.wk("ls", "tasks", "--tag", "ui")).toBe("next   T-002 Login page");
    expect(p.wk("ls", "--status", "later")).toBe("later  T-003 Settings later");
    expect(p.wk("ls", "ideas")).toBe("I-001 Passkeys");
    expect(p.wk("ls", "decisions")).toBe("No decisions match.");
    expect(p.raw("ls", "bogus").code).toBe(1);
    expect(JSON.parse(p.wk("ls", "--json"))).toHaveLength(3);
  });

  it("status draws the plan like the spec", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    p.wk("add", "epic", "Settings page");
    const titles = ["Refresh token endpoint", "Logout clears cookie", "Session timeout warning", "Remember device"];
    for (const t of titles) p.wk("add", "task", t, "--epic", "E-001");
    p.wk("add", "task", "Theme picker", "--epic", "E-002");
    p.wk("done", "T-004", "--force");
    p.wk("start", "T-001");
    p.wk("add", "task", "Someday", "--later");
    p.wk("idea", "Passkeys");
    expect(p.wk("status")).toBe(
      [
        "E-001 Auth rework    ███░░░░░░░  1/4",
        "  now   T-001 Refresh token endpoint",
        "  next  T-002 Logout clears cookie",
        "  next  T-003 Session timeout warning",
        "E-002 Settings page  ░░░░░░░░░░  0/1",
        "  next  T-005 Theme picker",
        "later   1 task, 1 idea",
      ].join("\n"),
    );
    const one = p.wk("status", "--epic", "E-001").split("\n");
    expect(one[0]).toBe("E-001 Auth rework  ███░░░░░░░  1/4");
    expect(one).toContain("  done  T-004 Remember device");
  });
});

describe("wk move", () => {
  const titles = ["Alpha", "Bravo", "Charlie", "Delta"];
  const queue = (p: Project) => p.wk("next").split("\n").filter((l) => l.startsWith("next ")).map((l) => l.split(" ")[3]);

  it("puts a task before, after, first or last without touching the others", () => {
    const p = project();
    for (const t of titles) p.wk("add", "task", `${t} task`, "--force");
    const before = p.read("tasks", "T-003.md");
    expect(p.wk("move", "T-004", "--before", "T-003")).toBe("moved T-004 Delta task to #3 of 4 next");
    expect(queue(p)).toEqual(["Alpha", "Bravo", "Delta", "Charlie"]);
    expect(p.read("tasks", "T-003.md")).toBe(before);
    p.wk("move", "T-001", "--after", "T-003");
    expect(queue(p)).toEqual(["Bravo", "Delta", "Charlie", "Alpha"]);
    p.wk("move", "T-003", "--top");
    expect(queue(p)).toEqual(["Charlie", "Bravo", "Delta", "Alpha"]);
    p.wk("move", "T-003", "--bottom");
    expect(queue(p)).toEqual(["Bravo", "Delta", "Alpha", "Charlie"]);
    expect(p.wk("ls").split("\n")[0]).toContain("T-002 Bravo task");
  });

  it("keeps a moved undecided task in place once it is decided", () => {
    const p = project();
    for (const t of titles) p.wk("add", "task", `${t} task`, "--force");
    p.wk("edit", "T-004", "--needs-decision");
    p.wk("move", "T-004", "--before", "T-002");
    p.wk("edit", "T-004", "--no-needs-decision");
    expect(queue(p)).toEqual(["Alpha", "Delta", "Bravo", "Charlie"]);
  });

  it("refuses a missing or double place, and tasks outside next", () => {
    const p = project();
    for (const t of titles) p.wk("add", "task", `${t} task`, "--force");
    expect(p.raw("move", "T-002").stderr).toContain("Say where, once");
    expect(p.raw("move", "T-002", "--top", "--before", "T-001").stderr).toContain("Say where, once");
    expect(p.raw("move", "T-002", "--before", "T-002").stderr).toContain("another task");
    p.wk("start", "T-001");
    expect(p.raw("move", "T-001", "--bottom").code).toBe(1);
    expect(p.raw("move", "T-002", "--before", "T-001").code).toBe(1);
  });
});
