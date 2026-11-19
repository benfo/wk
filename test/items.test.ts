import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ID_ALPHABET, newId, slugify } from "../src/ids.js";
import { run } from "./helpers.js";
import { git, hasGit, tmpDir } from "./helpers.js";
import { fixedPick, plan } from "./helpers.js";

describe("ids and slugs", () => {
  it("draws 4 characters from an alphabet without look-alikes", () => {
    for (const ch of "01ilo") expect(ID_ALPHABET).not.toContain(ch);
    const id = newId(new Set());
    expect(id).toMatch(new RegExp(`^[${ID_ALPHABET}]{4}$`));
  });

  it("skips an id that is taken", () => {
    // First draw spells "2222", which is taken; the second spells "3333".
    const pick = fixedPick(0, 0, 0, 0, 1, 1, 1, 1);
    expect(newId(new Set(["2222"]), pick)).toBe("3333");
  });

  it("slugs titles to lowercase ASCII words, cut at a word boundary", () => {
    expect(slugify("Fix the Banner: border shifts!")).toBe("fix-the-banner-border-shifts");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    const long = slugify("Record each day's joke to a local history file on startup please");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe("record-each-day-s-joke-to-a-local");
    expect(slugify("!!!")).toBe("item");
  });
});

describe("init", () => {
  it("creates the v2 layout with a core area", () => {
    const p = plan();
    expect(p.read("config.yml")).toMatch(/\nversion: 2\nstore: repo\n/);
    expect(p.read("areas", "core", "area.md")).toMatch(/^# core\n\nAlways in scope/);
    for (const f of ["summary.md", "session.md", "inbox/.gitkeep", "projects/.gitkeep", "archive/.gitkeep"]) {
      expect(fs.existsSync(p.file(f))).toBe(true);
    }
  });

  it("is safe to rerun and never overwrites", () => {
    const p = plan();
    fs.writeFileSync(p.file("areas", "core", "area.md"), "# core\n\nMine.\n");
    expect(p.wk("init")).toMatch(/Already set up \(store: repo\)/);
    expect(p.read("areas", "core", "area.md")).toBe("# core\n\nMine.\n");
  });

  it("asks for a store, and refuses a v1 plan", () => {
    const p = plan({ init: false });
    expect(p.raw("init").stderr).toMatch(/Choose where to keep the plan/);
    fs.mkdirSync(p.file(), { recursive: true });
    fs.writeFileSync(p.file("config.yml"), "store: repo\ncounters: { E: 0, T: 0 }\n");
    expect(p.raw("init", "--store", "repo").stderr).toMatch(/v1 plan.*wk migrate/);
    expect(p.raw("show", "abcd").stderr).toMatch(/v1 plan.*wk migrate/);
  });

  it.skipIf(!hasGit)("keeps an ignore-store plan out of git", () => {
    const p = plan({ git: true, store: "ignore" });
    expect(fs.readFileSync(path.join(p.dir, ".gitignore"), "utf8")).toContain(".work/");
    expect(git(p.dir, "status", "--porcelain")).toBe("?? .gitignore\n?? AGENTS.md");
  });

  it("keeps a home-store plan outside the folder", () => {
    const dir = tmpDir();
    const home = tmpDir();
    const r = run(["init", "--store", "home"], { cwd: dir, home, today: "2026-11-10" });
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(dir, ".work"))).toBe(false);
    expect(run(["add", "Water the plants"], { cwd: dir, home, today: "2026-11-10" }).stdout).toMatch(/\(core\)$/);
  });
});

describe("add and show", () => {
  it("writes a task to the core area as <id>-<slug>.md with the title as a heading", () => {
    const p = plan();
    const out = p.wk("add", "Banner border shifts right", "--tags", "bug,UI", "--body", "On 80 columns.\\nWide mascots only.");
    const m = /^Added ([a-z2-9]{4}) Banner border shifts right \(core\)$/m.exec(out);
    expect(m).not.toBeNull();
    const id = m![1];
    expect(p.files("areas", "core").sort()).toEqual(["area.md", `${id}-banner-border-shifts-right.md`].sort());
    expect(p.read("areas", "core", `${id}-banner-border-shifts-right.md`)).toBe(
      [
        "---",
        `id: ${/^\d/.test(id) ? `"${id}"` : id}`,
        "kind: task",
        "state: open",
        "when: queue",
        "tags: [bug, ui]",
        "rank: 1",
        "created: 2026-11-10",
        "updated: 2026-11-10",
        "---",
        "# Banner border shifts right",
        "",
        "On 80 columns.",
        "Wide mascots only.",
        "",
      ].join("\n"),
    );
  });

  it("shows an item by any unique start of its id", () => {
    const p = plan();
    const id = /Added (\w{4})/.exec(p.wk("add", "Banner border shifts right", "--tags", "bug"))![1];
    const out = p.wk("show", id.slice(0, 2));
    expect(out.split("\n").slice(0, 3)).toEqual([`${id}  task · open · queue · core`, "Banner border shifts right", "tags: bug"]);
    expect(JSON.parse(p.wk("show", id, "--json"))).toMatchObject({ id, title: "Banner border shifts right", home: "core" });
  });

  it("asks for more of the id when a prefix is ambiguous", () => {
    const p = plan();
    // Ids "2223" and "2224": the prefix "222" matches both.
    p.with({ pick: fixedPick(0, 0, 0, 1) }, "add", "Water the plants");
    p.with({ pick: fixedPick(0, 0, 0, 2) }, "add", "Book the dentist");
    expect(p.raw("show", "222").stderr).toBe("222 matches 2 items: 2223, 2224. Type more of the id.");
    expect(p.wk("show", "2224")).toMatch(/Book the dentist/);
    expect(p.raw("show", "zzzz").stderr).toBe("No item zzzz.");
    expect(p.raw("show", "T-1").stderr).toBe("No item T-001.");
    // An id that looks like an old one still resolves as itself.
    p.with({ pick: fixedPick(11, 6, 4, 7) }, "add", "Looks like D-869");
    expect(p.wk("show", "d869")).toMatch(/^d869 /);
    expect(p.raw("show", "r8v!").stderr).toMatch(/not an id\. Ids look like r8vn/);
  });

  it("never reuses an id, even one only the archive holds", () => {
    const p = plan();
    fs.mkdirSync(p.file("archive", "2026"), { recursive: true });
    fs.writeFileSync(p.file("archive", "2026", "2222-old.md"), "---\nkind: task\nstate: done\n---\n# Old\n");
    const out = p.with({ pick: fixedPick(0, 0, 0, 0, 1, 1, 1, 1) }, "add", "New one").stdout;
    expect(out).toBe("Added 3333 New one (core)");
  });

  it("names the item and how far over a limit it is", () => {
    const p = plan();
    expect(p.raw("add", "x".repeat(74)).stderr).toBe("Task title is 74 characters, limit is 70 (4 over). Shorten it.");
    expect(p.raw("add", "Seven lines", "--body", "1\\n2\\n3\\n4\\n5\\n6\\n7").stderr).toBe(
      "Task body is 7 lines, limit is 6 (1 over). Shorten it.",
    );
  });

  it("stops on a similar open task unless forced", () => {
    const p = plan();
    p.wk("add", "Fix the banner border");
    const r = p.raw("add", "Fix banner border");
    expect(r.stderr).toMatch(/^Similar: \w{4} Fix the banner border\nUpdate or merge/);
    expect(p.wk("add", "Fix banner border", "--force")).toMatch(/^Added/);
  });
});
