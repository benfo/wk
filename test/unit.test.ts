import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { slugify } from "../src/commands/flow.js";
import { daysBetween } from "../src/commands/tidy.js";
import { defaultConfigText, readConfig, writeCounters } from "../src/config.js";
import { parse, stringify } from "../src/frontmatter.js";
import { checkLines, checkTitle } from "../src/limits.js";
import { progressBar, render } from "../src/output.js";
import { isSimilar, similarity } from "../src/similar.js";
import { normaliseId } from "../src/store.js";
import { tmpDir } from "./helpers.js";

describe("frontmatter", () => {
  const order = ["id", "title", "epic", "status", "tags", "ref", "needs_decision", "created"];

  it("writes the spec's task format and reads it back", () => {
    const text = stringify(
      { id: "T-031", title: "Refresh token endpoint", epic: "E-003", status: "next", tags: ["api"], ref: null, needs_decision: false, created: "2026-11-10" },
      "Test: log in with an expired token.",
      order,
    );
    expect(text).toBe(
      [
        "---", "id: T-031", "title: Refresh token endpoint", "epic: E-003", "status: next", "tags: [api]", "ref:",
        "needs_decision: false", "created: 2026-11-10", "---", "Test: log in with an expired token.", "",
      ].join("\n"),
    );
    const back = parse(text);
    expect(back.data).toMatchObject({ id: "T-031", tags: ["api"], ref: null, needs_decision: false, created: "2026-11-10" });
    expect(back.body).toBe("Test: log in with an expired token.");
  });

  it("quotes titles that YAML would misread", () => {
    for (const title of ["2FA support", "Fix: login", "yes", "#hash start", "- dash", 'Say "hi"', "trailing "]) {
      const back = parse(stringify({ id: "T-001", title }, "", order));
      expect(back.data.title).toBe(title);
    }
  });
});

describe("similarity", () => {
  it("matches the spec's example and plurals", () => {
    expect(isSimilar("Refresh token flow", "Refresh token endpoint")).toBe(true);
    expect(isSimilar("Add dark mode", "dark modes")).toBe(true);
  });

  it("does not match unrelated titles", () => {
    expect(isSimilar("Logout clears cookie", "Session timeout warning")).toBe(false);
    expect(isSimilar("Add login page", "Add logout page")).toBe(false);
    expect(similarity("", "anything")).toBe(0);
  });
});

describe("limits", () => {
  it("checks titles", () => {
    expect(checkTitle("  ok  ")).toBe("ok");
    expect(() => checkTitle("x".repeat(71))).toThrow(/71 characters, limit is 70/);
    expect(() => checkTitle("")).toThrow(/empty/);
    expect(() => checkTitle("a\nb")).toThrow(/one line/);
  });

  it("checks line counts", () => {
    expect(checkLines("a\nb", 2, "Idea")).toBe("a\nb");
    expect(() => checkLines("a\nb\nc", 2, "Idea")).toThrow(/Idea is 3 lines, limit is 2/);
  });
});

describe("output", () => {
  it("caps at 10 lines unless --all", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i}`);
    const capped = render({ lines, data: {} }, {}).split("\n");
    expect(capped).toHaveLength(10);
    expect(capped[9]).toBe("… 6 more lines (--all)");
    expect(render({ lines, data: {} }, { all: true }).split("\n")).toHaveLength(15);
    expect(render({ lines, data: { a: 1 } }, { json: true })).toBe('{\n  "a": 1\n}');
  });

  it("draws progress bars", () => {
    expect(progressBar(7, 10)).toBe("███████░░░");
    expect(progressBar(2, 9)).toBe("██░░░░░░░░");
    expect(progressBar(0, 0)).toBe("░░░░░░░░░░");
  });
});

describe("helpers", () => {
  it("normalises ids", () => {
    expect(normaliseId("t-31")).toBe("T-031");
    expect(normaliseId("E3")).toBe("E-003");
    expect(normaliseId("T-1234")).toBe("T-1234");
    expect(normaliseId("X-1")).toBeNull();
    expect(normaliseId("hello")).toBeNull();
  });

  it("slugifies titles for branches", () => {
    expect(slugify("Refresh token endpoint")).toBe("refresh-token-endpoint");
    expect(slugify("  Fix: café / login!! ")).toBe("fix-cafe-login");
    expect(slugify("a".repeat(60)).length).toBe(40);
  });

  it("counts days", () => {
    expect(daysBetween("2026-11-01", "2026-11-10")).toBe(9);
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
  });
});

describe("config", () => {
  it("updates counters and keeps comments and other keys", () => {
    const dir = tmpDir();
    const extra = 'tracker:\n  name: Jira\nbranch: "{ref}-{slug}"\n';
    fs.writeFileSync(path.join(dir, "config.yml"), defaultConfigText("repo") + extra);
    writeCounters(dir, { E: 3, T: 31, I: 7, D: 12, L: 4 });
    const text = fs.readFileSync(path.join(dir, "config.yml"), "utf8");
    expect(text).toContain("# or an absolute path, shared across projects");
    expect(text).toContain("git:\n  branch:\n  commit:");
    expect(text).toContain("counters: { E: 3, T: 31, I: 7, D: 12, L: 4 }");
    expect(text).toContain("name: Jira");
    expect(readConfig(dir).counters.T).toBe(31);
  });

  it("replaces a block-style counters map", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "config.yml"), "mode: personal\ncounters:\n  E: 1\n  T: 2\nprinciples_dir: p\n");
    writeCounters(dir, { E: 1, T: 3, I: 0, D: 0, L: 0 });
    const c = readConfig(dir);
    expect(c.counters).toEqual({ E: 1, T: 3, I: 0, D: 0, L: 0 });
    expect(c.principles_dir).toBe("p");
  });
});
