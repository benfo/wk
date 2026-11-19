import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { plan } from "./helpers.js";

const idOf = (out: string) => /^\w+ (\w{4})/.exec(out)![1];

describe("jot and the inbox", () => {
  it("captures without questions, linked to the now task, and lists it at check", () => {
    const p = plan();
    const t = idOf(p.wk("add", "Fix the banner"));
    p.wk("start", t);
    const j = idOf(p.wk("jot", "Export history to CSV"));
    expect(p.files("inbox")).toContain(`${j}-export-history-to-csv.md`);
    expect(p.wk("show", j)).toContain(`from: ${t}`);
    const out = p.wk("check", "--checked", "ok").split("\n");
    expect(out).toContain("Captured: 1 jot to sort at the check-in, with a suggested home and when for each:");
    expect(out).toContain(`  ${j} Export history to CSV`);
    expect(p.wk("brief")).toContain("Inbox: 1 to sort (wk inbox).");
  });

  it("keeps a long first line whole in the body and refuses more than 2 lines", () => {
    const p = plan();
    const long = "The banner border shifts two columns to the right whenever the mascot is wider than thirty characters";
    const j = idOf(p.wk("jot", long));
    const show = p.wk("show", j).split("\n");
    expect(show[1].endsWith("…")).toBe(true);
    expect(show[1].length).toBeLessThanOrEqual(70);
    expect(show).toContain(long);
    expect(p.raw("jot", "a\\nb\\nc").stderr).toMatch(/Jot is 3 lines, limit is 2/);
  });

  it("is sorted into a home with a when, and attaches files that travel with it", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    fs.writeFileSync(path.join(p.dir, "shot.png"), "png");
    const j = idOf(p.wk("jot", "Banner looks off", "--file", "shot.png"));
    expect(p.files("inbox")).toContain(`${j}-banner-looks-off.md`);
    expect(fs.existsSync(p.file("inbox", `${j}-1.png`))).toBe(true);
    expect(p.raw("start", j).stderr).toMatch(/Sort it first/);
    expect(p.raw("move", j, "--when", "next").stderr).toMatch(/Sort it into a home first/);
    expect(p.wk("move", j, "--in", "ui", "--when", "next")).toBe(`Moved ${j} Banner looks off: in ui, #1 of 1 in the queue`);
    expect(fs.existsSync(p.file("areas", "ui", `${j}-1.png`))).toBe(true);
    expect(p.wk("show", j)).toContain(`files: ${j}-1.png`);
    expect(p.wk("inbox")).toBe("Inbox is empty.");
  });
});

describe("when", () => {
  it("adds straight to a horizon or trigger, and only queued tasks are next", () => {
    const p = plan();
    p.wk("area", "new", "ui", "Screens");
    const a = idOf(p.wk("add", "Fix the banner"));
    const b = idOf(p.wk("add", "Dark mode", "--when", "someday"));
    expect(p.wk("add", "Export CSV", "--when", `after:${a.slice(0, 3)}`)).toMatch(new RegExp(`\\(core, when after:${a}\\)$`));
    p.wk("add", "Theme picker", "--when", "start:ui");
    p.wk("add", "Renew cert", "--when", "on:2026-12-01");
    expect(p.wk("next")).toBe(`now    (nothing in progress)\nnext   ${a} Fix the banner (core)`);
    expect(p.wk("ls", "someday").split(/\s+/)[1]).toBe(b);
    expect(p.raw("add", "X", "--when", "tomorrow").stderr).toMatch(/Unknown when "tomorrow"/);
    expect(p.raw("add", "Y", "--when", "on:soon").stderr).toMatch(/on: needs a date/);
    expect(p.raw("add", "Z", "--when", "start:garden").stderr).toMatch(/No area "garden"/);
  });

  it("promotes a someday idea to next, keeping its id", () => {
    const p = plan();
    const a = idOf(p.wk("add", "Fix the banner"));
    const b = idOf(p.wk("add", "Dark mode", "--when", "someday"));
    expect(p.wk("move", b, "--when", "next")).toBe(`Moved ${b} Dark mode: #1 of 2 in the queue`);
    expect(p.wk("move", b, "--when", "later")).toBe(`Moved ${b} Dark mode: when later`);
    expect(p.wk("next").split("\n")[1]).toBe(`next   ${a} Fix the banner (core)`);
  });

  it("notes a tag the plan has never seen", () => {
    const p = plan();
    p.wk("add", "Fix the banner", "--tags", "bug");
    expect(p.wk("add", "Fix the footer", "--tags", "bgu")).toContain("New tag: bgu (known: bug).");
  });
});
