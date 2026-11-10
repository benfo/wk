import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { project } from "./helpers.js";

const FRESH = "3 tasks done this session: suggest a fresh session unless the next task builds on this one.";

function sessionFiles(home: string): string[] {
  const dir = path.join(home, "sessions");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

describe("session-aware nudges", () => {
  it("wk done recommends a fresh session from the third task since brief", () => {
    const p = project();
    for (const t of ["Alpha one", "Bravo two", "Charlie three", "Delta four"]) p.wk("add", "task", t);
    p.wk("brief");
    expect(p.wk("done", "T-001", "--force")).not.toContain("tasks done this session");
    expect(p.wk("done", "T-002", "--force")).not.toContain("tasks done this session");
    expect(p.wk("done", "T-003", "--force")).toContain(FRESH);
    expect(p.wk("done", "T-004", "--force")).toContain("4 tasks done this session");
    expect(JSON.parse(p.wk("done", "T-004", "--json")).status).toBe("done");
  });

  it("wk brief starts a new count", () => {
    const p = project();
    for (const t of ["Alpha one", "Bravo two", "Charlie three"]) p.wk("add", "task", t);
    p.wk("brief");
    p.wk("done", "T-001", "--force");
    p.wk("done", "T-002", "--force");
    p.wk("brief");
    expect(p.wk("done", "T-003", "--force")).not.toContain("tasks done this session");
  });

  it("wk start flags a switch to another epic", () => {
    const p = project();
    p.wk("add", "epic", "Auth rework");
    p.wk("add", "epic", "Settings page");
    p.wk("add", "task", "Login page", "--epic", "E-001");
    p.wk("add", "task", "Logout button", "--epic", "E-001");
    p.wk("add", "task", "Theme picker", "--epic", "E-002");
    p.wk("add", "task", "Loose end");
    p.wk("brief");

    expect(p.wk("start", "T-001")).not.toContain("Different epic");
    p.wk("done", "T-001", "--force");
    expect(p.wk("start", "T-002")).not.toContain("Different epic");
    p.wk("done", "T-002", "--force");
    expect(p.wk("start", "T-003")).toContain("Different epic from the last task (E-001): suggest a fresh session, after a handoff.");
    p.wk("done", "T-003", "--force");
    expect(p.wk("start", "T-004")).toContain("Different epic from the last task (E-002)");
  });

  it("keeps session state per machine, outside the plan", () => {
    const p = project();
    p.wk("brief");
    expect(sessionFiles(p.home)).toHaveLength(1);
    expect(fs.readdirSync(p.file()).some((f) => f.includes("session"))).toBe(false);
  });

  it("survives a broken session file", () => {
    const p = project();
    p.wk("add", "task", "Still fine");
    p.wk("brief");
    const file = path.join(p.home, "sessions", sessionFiles(p.home)[0]);
    fs.writeFileSync(file, "{not json");
    expect(p.wk("done", "T-001", "--force")).toContain("done  T-001 Still fine");
  });
});
