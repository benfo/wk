import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { plan, put } from "./helpers.js";

describe("wk board", () => {
  it("writes a self-contained page outside the plan with every section", () => {
    const p = plan();
    p.wk("summary", "What: a CLI for jokes");
    p.wk("area", "new", "ui", "Screens");
    p.wk("principle", "Use ASCII badges", "--instead", "emoji", "--because", "terminals lack <glyphs>", "--in", "ui");
    const pid = /Project (\w{4})/.exec(p.wk("project", "new", "Usage history", "--touches", "ui"))![1];
    const t = /Added (\w{4})/.exec(p.wk("add", "Record each run", "--in", pid))![1];
    p.wk("add", "Fix the banner", "--tags", "bug");
    p.wk("start", t);
    put(p, ["inbox"], "hhhh", "Button looks off", { state: "inbox" });
    put(p, ["areas", "core"], "dddd", "Export CSV", { state: "open", when: `after:${t}`, due: "2026-11-10" });
    p.wk("decide", "Store history as JSONL", "--why", "Cheap appends");

    const out = p.wk("board");
    const file = /^Board: (.+)$/m.exec(out)![1];
    expect(file.startsWith(path.join(p.home, "boards"))).toBe(true);
    const html = fs.readFileSync(file, "utf8");
    for (const s of ["<h1><span>A CLI for jokes", "Record each run", "Fix the banner", "Button looks off", "Export CSV", "Usage history", "Store history as JSONL", "Use ASCII badges"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain("terminals lack &lt;glyphs&gt;");
    expect(html).toContain('<span class="lbl">In progress</span><span class="t3"><time class="ago"');
    expect(html).toContain('<label for="tab-board" title="Press 1">Board</label><label for="tab-history" title="Press 2">History</label>');
    expect(html).toContain('<main class="tab tab-history">');
    // A project opens to its tasks and where each stands.
    expect(html).toContain(`<details class="project" data-id="${pid}">`);
    const project = html.slice(html.indexOf(`data-id="${pid}"`));
    expect(project.slice(0, project.indexOf("</details>"))).toMatch(/aria-label="In progress">.*?<div class="tt">Record each run<\/div>/);
    // The project's tasks carry its colour; area tasks stay grey.
    expect(html).toContain('<span class="chip" style="--pc:var(--p1)">Usage history</span>');
    expect(html).toContain('<span class="chip">core</span>');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).not.toMatch(/<script|https?:\/\//);
    expect(fs.existsSync(p.file("board.html"))).toBe(false);
  });

  it("does not list the queued task the hero already shows", () => {
    const p = plan();
    p.wk("add", "Fix the banner");
    p.wk("board", "--out", "one.html");
    const one = fs.readFileSync(path.join(p.dir, "one.html"), "utf8");
    expect(one).toContain("Nothing in progress. Next up");
    expect(one).not.toMatch(/<b>(Up next|After that)<\/b>/);

    p.wk("add", "Add a dark theme");
    p.wk("board", "--out", "two.html");
    const two = fs.readFileSync(path.join(p.dir, "two.html"), "utf8");
    expect(two).toContain('<b>After that</b><span class="c">1</span>');
    expect(two).not.toContain('<div class="tt">Fix the banner</div>');
  });

  it("writes where --out says", () => {
    const p = plan();
    expect(p.wk("board", "--out", "plan.html")).toContain(path.join(p.dir, "plan.html"));
    expect(fs.readFileSync(path.join(p.dir, "plan.html"), "utf8")).toContain("Nothing in progress");
  });
});
