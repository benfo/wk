import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { plan, put } from "./helpers.js";

function seeded() {
  const p = plan();
  fs.mkdirSync(p.file("areas", "ui"), { recursive: true });
  fs.writeFileSync(p.file("areas", "ui", "area.md"), "# ui\n\nScreens.\n");
  put(p, ["areas", "core"], "aaaa", "Write the readme", { state: "open", when: "queue", rank: 2 });
  put(p, ["areas", "core"], "bbbb", "Fix login crash", { state: "now", when: "queue", rank: 1, tags: ["bug"] });
  put(p, ["areas", "ui"], "cccc", "Banner border shifts right", { state: "open", when: "next", rank: 0, tags: ["bug", "quick"] });
  put(p, ["areas", "ui"], "dddd", "Dark mode", { state: "open", when: "someday" });
  put(p, ["areas", "core"], "eeee", "Export to CSV", { state: "open", when: "after:bbbb", due: "2026-11-10" });
  put(p, ["areas", "core"], "ffff", "Old done thing", { state: "done", when: "queue" });
  put(p, ["areas", "core"], "gggg", "Use JSONL for history", { kind: "decision" });
  put(p, ["inbox"], "hhhh", "Button looks off", { state: "inbox", from: "bbbb" });
  put(p, ["areas", "core"], "jjjj", "Wait for the API", { state: "open", when: "queue", rank: 3, wait: "API keys" });
  return p;
}

describe("wk ls", () => {
  it("lists open tasks by default: started first, then the queue, then the rest", () => {
    const p = seeded();
    expect(p.wk("ls", "--all").split("\n")).toEqual([
      "now     bbbb Fix login crash (core) #bug",
      "next    cccc Banner border shifts right (ui) #bug #quick",
      "queue   aaaa Write the readme (core)",
      "queue   jjjj Wait for the API [waiting: API keys] (core)",
      "after   eeee Export to CSV [due] (core)",
      "someday dddd Dark mode (ui)",
      "inbox   hhhh Button looks off (inbox)",
    ]);
  });

  it("filters by every word: kind, home, tag, when, state and flags", () => {
    const p = seeded();
    const ids = (...words: string[]) => p.wk("ls", ...words).split("\n").map((l) => l.split(/\s+/)[1]);
    expect(ids("bug")).toEqual(["bbbb", "cccc"]);
    expect(ids("bug", "ui")).toEqual(["cccc"]);
    expect(ids("someday")).toEqual(["dddd"]);
    expect(ids("after")).toEqual(["eeee"]);
    expect(ids("due")).toEqual(["eeee"]);
    expect(ids("waiting")).toEqual(["jjjj"]);
    expect(ids("done")).toEqual(["ffff"]);
    expect(ids("inbox")).toEqual(["hhhh"]);
    expect(ids("decisions")).toEqual(["gggg"]);
    expect(ids("#quick")).toEqual(["cccc"]);
    expect(ids("queued")).toEqual(["cccc", "aaaa", "jjjj"]);
  });

  it("says when nothing matches, and gives fields with --json", () => {
    const p = seeded();
    expect(p.wk("ls", "perf")).toBe("Nothing matches: perf");
    const rows = JSON.parse(p.wk("ls", "ui", "--json"));
    expect(rows.map((r: { id: string; home: string }) => [r.id, r.home])).toEqual([["cccc", "ui"], ["dddd", "ui"]]);
  });

  it("lists archived items with --archived", () => {
    const p = seeded();
    put(p, ["archive", "2026", "areas", "core"], "kkkk", "Ancient task", { state: "done", when: "queue" });
    expect(p.wk("ls", "--archived", "done")).toBe("done    kkkk Ancient task (core)");
    expect(p.wk("ls", "done")).not.toContain("kkkk");
  });
});
