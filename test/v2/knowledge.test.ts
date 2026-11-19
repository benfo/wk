import { describe, expect, it } from "vitest";
import { plan } from "./helpers.js";

const idOf = (out: string) => /^\w+ (\w{4})/.exec(out)![1];

describe("decisions and learnings", () => {
  it("records them in the now task's home, else core", () => {
    const p = plan();
    const d = idOf(p.wk("decide", "Store history as JSONL", "--why", "Appends are cheap", "--rejected", "SQLite"));
    expect(p.wk("show", d)).toContain("Why: Appends are cheap\nRejected: SQLite");
    expect(p.wk("show", d).split("\n")[0]).toBe(`${d}  decision · core`);
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Usage history"))![1];
    const t = /Added (\w{4})/.exec(p.wk("add", "Record each run", "--in", pid))![1];
    p.wk("start", t);
    const l = idOf(p.wk("learn", "The API caps at 100 calls a minute\\nRetry after the header's delay"));
    expect(p.wk("show", l).split("\n").slice(0, 2)).toEqual([`${l}  learning · ${pid}`, "The API caps at 100 calls a minute"]);
    expect(p.raw("decide", "No reason").stderr).toMatch(/needs a reason/);
    expect(p.raw("learn", "a\\nb\\nc").stderr).toMatch(/3 lines, limit is 2 \(1 over\)/);
    expect(p.raw("edit", d, "--title", "x").stderr).toMatch(/never edited/);
  });
});

describe("principles", () => {
  it("needs instead and because, and lives in an area", () => {
    const p = plan();
    expect(p.raw("principle", "Use ASCII badges").stderr).toMatch(/Name the default it overrides.*isn't a principle/);
    expect(p.raw("principle", "Use ASCII badges", "--instead", "emoji").stderr).toMatch(/Say why/);
    const id = idOf(p.wk("principle", "Use ASCII badges like [OK]", "--instead", "emoji or dingbats", "--because", "many terminals lack the glyphs"));
    const show = p.wk("show", id);
    expect(show).toContain("instead: emoji or dingbats\nbecause: many terminals lack the glyphs");
    expect(p.raw("principle", "Use ASCII badges like [OK] here", "--instead", "x", "--because", "y").stderr).toMatch(/^Similar: /);
  });

  it("prints core, home and touched-area principles on start, and asks once about an empty area", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    p.wk("area", "new", "api", "Endpoints");
    p.wk("principle", "Never block shell start", "--instead", "reporting errors", "--because", "it runs in every shell", "--test", "test/startup.test.ts");
    p.wk("principle", "Use ASCII badges", "--instead", "emoji", "--because", "terminals lack glyphs", "--in", "ui");
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "History", "--touches", "ui,api"))![1];
    const t = /Added (\w{4})/.exec(p.wk("add", "Record each run", "--in", pid))![1];
    const lines = p.wk("start", t).split("\n");
    const at = lines.indexOf("Principles:");
    expect(lines.slice(at)).toEqual([
      "Principles:",
      "core:",
      "  Never block shell start",
      "    instead of reporting errors; because it runs in every shell",
      "    enforced by test/startup.test.ts",
      "ui:",
      "  Use ASCII badges",
      "    instead of emoji; because terminals lack glyphs",
      "No api principles yet. Ask once: capture a few now (wk guide principles), or carry on?",
    ]);
    p.wk("wait", t, "x");
    p.wk("wait", t, "--clear");
    expect(p.wk("start", t)).not.toContain("No api principles yet");
  });

  it("distills a learning and supersedes an old rule", () => {
    const p = plan();
    const l = idOf(p.wk("learn", "Shell start breaks on any stderr output"));
    const a = idOf(p.wk("principle", "Print nothing on stderr at start", "--instead", "logging errors", "--because", "shells show it", "--from", l));
    expect(p.wk("show", l)).toContain(`distilled_into: ${a}`);
    expect(p.wk("show", a)).toContain(`from: ${l}`);
    const b = idOf(p.wk("principle", "Stay silent at shell start", "--instead", "logging", "--because", "users see it"));
    expect(p.wk("supersede", a, b)).toBe(`${a} superseded by ${b} Stay silent at shell start`);
    expect(p.raw("drop", b).stderr).toMatch(/superseded, not dropped/);
  });
});

describe("edit, drop and merge", () => {
  it("renames the file when the title changes", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Fix the banner"));
    p.wk("edit", a, "--title", "Fix the wide banner", "--tags", "bug");
    expect(p.files("areas", "core")).toContain(`${a}-fix-the-wide-banner.md`);
    expect(p.files("areas", "core")).not.toContain(`${a}-fix-the-banner.md`);
  });

  it("merges a duplicate and drops what isn't wanted", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Fix the banner", "--tags", "bug"));
    const b = idOf(p.wk("add", "Banner border is off", "--tags", "ui", "--body", "Wide mascots only."));
    expect(p.wk("merge", a, b)).toBe(`Merged ${b} into ${a} Fix the banner\nDeleted ${b}`);
    expect(p.wk("show", a)).toContain("tags: bug, ui");
    expect(p.wk("drop", a)).toBe(`Dropped ${a} Fix the banner`);
    expect(p.wk("ls")).toBe("No open tasks.");
  });
});
