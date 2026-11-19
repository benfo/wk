import { Command, CommanderError } from "commander";
import { todayString } from "../context.js";
import { render, WkError, type Result } from "../output.js";
import { init } from "./commands/init.js";
import { areaList, areaNew, projectList, projectNew, projectShow, summaryCmd } from "./commands/homes.js";
import { addTask, ls, move, show } from "./commands/items.js";
import { board } from "./commands/board.js";
import { inbox, jot } from "./commands/capture.js";
import { configure } from "./commands/configure.js";
import { check, done, handoff, start, wait } from "./commands/flow.js";
import { brief, next } from "./commands/views.js";
import { decide, drop, edit, learn, merge, principle, supersede } from "./commands/knowledge.js";
import { loadContext, type Ctx } from "./context.js";
import { wireFeatures } from "./features.js";

const collect = (value: string, prev: string[] = []) => [...prev, value];
import { Store } from "./store.js";

export interface RunOptions {
  cwd?: string;
  /** Overrides today's date (YYYY-MM-DD). Tests use it; so does WK_TODAY. */
  today?: string;
  /** Overrides where home-stored plans live (default ~/.wk, or WK_HOME). */
  home?: string;
  stdin?: string;
  /** Random source for ids; tests swap it to force collisions. */
  pick?: (n: number) => number;
}

export interface RunOutput {
  code: number;
  stdout: string;
  stderr: string;
}

type Handler = (ctx: Ctx, store: Store) => Result;

/** Runs one v2 wk command in-process. `argv` excludes the node and script paths. */
export function run(argv: string[], options: RunOptions = {}): RunOutput {
  wireFeatures();
  const cwd = options.cwd ?? process.cwd();
  const today = options.today ?? process.env.WK_TODAY ?? todayString();
  const out: string[] = [];
  const err: string[] = [];

  const program = new Command("wk")
    .description("Track work in plain text: tasks, decisions, learnings and principles, in projects and areas.")
    .option("--json", "machine-readable output")
    .option("--all", "lift the 10-line output limit")
    .exitOverride()
    .configureOutput({ writeOut: (s) => out.push(s.trimEnd()), writeErr: (s) => err.push(s.trimEnd()) })
    .showSuggestionAfterError();

  const emit = (cmd: Command, res: Result) => {
    out.push(render(res, cmd.optsWithGlobals() as { json?: boolean; all?: boolean }));
  };
  const act = (cmd: Command, fn: Handler) => {
    const ctx = loadContext(cwd, today, options.home, options.pick);
    emit(cmd, fn(ctx, new Store(ctx)));
  };

  program
    .command("init")
    .description("set up the plan")
    .option("--store <where>", "repo, ignore (.gitignore), local (.git/info/exclude) or home (~/.wk)")
    .action(function (this: Command) {
      emit(this, init(cwd, { store: this.opts().store, home: options.home }));
    });

  program
    .command("add <title>")
    .description("add a sorted task: in core unless --in says otherwise, at the bottom of the queue")
    .option("--in <home>", "an area or a project id")
    .option("--when <when>", "next, queue (default), later, someday, after:<id>, end:<project>, start:<area>, on:<date>")
    .option("--body <text>", "short notes, 6 lines max")
    .option("--tags <tags>", "comma-separated tags, e.g. bug,quick")
    .option("--force", "add even if a similar task exists")
    .action(function (this: Command, title: string) {
      const o = this.opts();
      act(this, (ctx, s) => addTask(ctx, s, title, o));
    });

  program
    .command("show <id>")
    .description("print one item in full; any unique start of the id works")
    .action(function (this: Command, id: string) {
      act(this, (ctx, s) => show(ctx, s, id));
    });

  program
    .command("ls [words...]")
    .description("list items; each word filters by kind, state, when, home, tag or id (e.g. wk ls bug ui someday)")
    .option("--archived", "list archived items instead")
    .action(function (this: Command, words: string[]) {
      const o = this.opts();
      act(this, (ctx, s) => ls(ctx, s, words ?? [], o));
    });

  program
    .command("move <id>")
    .description("sort an inbox item, change a home or when, or reorder the queue")
    .option("--in <home>", "an area or a project id")
    .option("--when <when>", "next, queue, later, someday, after:<id>, end:<project>, start:<area>, on:<date>")
    .option("--before <id>", "just ahead of this queued task")
    .option("--after <id>", "just behind this queued task")
    .option("--top", "first in the queue")
    .option("--bottom", "last in the queue")
    .action(function (this: Command, id: string) {
      const o = this.opts();
      act(this, (ctx, s) => move(ctx, s, id, o));
    });

  const project = program.command("project").description("projects: work with an end");
  project
    .command("list", { isDefault: true })
    .description("open projects with progress, then open counts per area")
    .action(function (this: Command) {
      act(this, (ctx, s) => projectList(ctx, s));
    });
  project
    .command("new <title>")
    .description("start a project")
    .option("--touches <areas>", "comma-separated areas it touches; their principles load for its tasks")
    .option("--body <text>", "goal and acceptance")
    .action(function (this: Command, title: string) {
      const o = this.opts();
      act(this, (ctx, s) => projectNew(ctx, s, title, o));
    });
  project
    .command("show <id>")
    .description("one project with its tasks, decisions and learnings")
    .action(function (this: Command, id: string) {
      act(this, (ctx, s) => projectShow(ctx, s, id));
    });

  const area = program.command("area").description("areas: ongoing responsibilities that never end");
  area
    .command("list", { isDefault: true })
    .description("areas with open tasks and principle counts")
    .action(function (this: Command) {
      act(this, (ctx, s) => areaList(ctx, s));
    });
  area
    .command("new <name> [description]")
    .description("create an area, e.g. wk area new ui \"Screens, layout and styling\"")
    .action(function (this: Command, name: string, description?: string) {
      act(this, (ctx, s) => areaNew(ctx, s, name, description));
    });

  program.command("brief", { isDefault: true }).description("summary, workflow, handoff, now and next; first call of a session")
    .action(function (this: Command) {
      act(this, (ctx, s) => brief(ctx, s));
    });

  program.command("next").description("now, up to 5 queued, due and waiting tasks")
    .action(function (this: Command) {
      act(this, (ctx, s) => next(ctx, s));
    });

  program
    .command("start <id>")
    .description("set a task to now (one at a time); prints its body and what applies")
    .option("--branch", "make a <id>-<slug> branch for it")
    .option("--no-branch", "stay on the current branch even if config says to branch")
    .action(function (this: Command, id: string) {
      const o = this.opts() as { branch?: boolean };
      const typed = this.getOptionValueSource("branch") === "cli" ? o.branch : undefined;
      act(this, (ctx, s) => start(ctx, s, id, { branch: typed }));
    });

  program
    .command("check")
    .description("move the now task to review; record automated checks and what a person should try")
    .option("--test <text>", "for a person: how it looks, feels, reads or responds (repeatable)", collect)
    .option("--checked <result>", 'an automated check you already ran, e.g. "75 tests pass" (repeatable)', collect)
    .option("--handoff <text>", "also save the handoff (5 lines max)")
    .option("--fresh", "the handoff recommends a fresh session")
    .action(function (this: Command) {
      const o = this.opts();
      act(this, (ctx, s) => check(ctx, s, o));
    });

  program
    .command("done <id>")
    .description("finish a reviewed task")
    .option("--force", "skip review for a trivial task")
    .option("--handoff <text>", "the handoff; without it, one is written from the next task")
    .option("--fresh", "the handoff recommends a fresh session")
    .action(function (this: Command, id: string) {
      const o = this.opts();
      act(this, (ctx, s) => done(ctx, s, id, o));
    });

  program
    .command("wait <id> [on]")
    .description("mark a task as waiting on something: a decision, a person, another item")
    .option("--clear", "it's no longer waiting")
    .action(function (this: Command, id: string, on?: string) {
      const o = this.opts();
      act(this, (ctx, s) => wait(ctx, s, id, on, o));
    });

  program
    .command("handoff <text>")
    .description("overwrite the handoff, 5 lines max; at every stop")
    .option("--fresh", "the handoff recommends a fresh session")
    .action(function (this: Command, text: string) {
      const o = this.opts();
      act(this, (ctx, s) => handoff(ctx, s, text, o));
    });

  program
    .command("config [action] [key] [value]")
    .description("show settings, or: wk config set <key> <value> (git.branch, git.commit, commit_style, checks.quick, checks.full, tracker)")
    .action(function (this: Command, action?: string, key?: string, value?: string) {
      act(this, (ctx) => configure(ctx, action, key, value));
    });

  program
    .command("decide <what>")
    .description("record a decision in the current home (the now task's, else core)")
    .option("--why <why>", "the reason, 2 lines max")
    .option("--rejected <text>", "what was rejected, 1 line")
    .option("--in <home>", "an area or a project id")
    .action(function (this: Command, what: string) {
      const o = this.opts();
      act(this, (ctx, s) => decide(ctx, s, what, o));
    });

  program
    .command("learn <text>")
    .description("record something surprising, 2 lines max, in the current home")
    .option("--in <home>", "an area or a project id")
    .action(function (this: Command, text: string) {
      const o = this.opts();
      act(this, (ctx, s) => learn(ctx, s, text, o));
    });

  program
    .command("principle <rule>")
    .description("a rule a capable model would otherwise get wrong: do X, instead of Y, because Z")
    .option("--instead <default>", "the default it overrides, 1 line")
    .option("--because <why>", "the reason, 2 lines max")
    .option("--in <area>", "the area it belongs to (default core: applies everywhere)")
    .option("--from <id>", "the learning or decision it distills")
    .option("--test <ref>", "a check that enforces it")
    .action(function (this: Command, rule: string) {
      const o = this.opts();
      act(this, (ctx, s) => principle(ctx, s, rule, o));
    });

  program.command("supersede <old> <new>").description("mark a decision or principle as replaced")
    .action(function (this: Command, oldId: string, newId: string) {
      act(this, (ctx, s) => supersede(ctx, s, oldId, newId));
    });

  program
    .command("edit <id>")
    .description("rewrite an item in place; the same limits apply")
    .option("--title <title>", "new title (renames the file)")
    .option("--body <text>", "new body")
    .option("--tags <tags>", "replace tags")
    .option("--instead <default>", "principles: the default it overrides")
    .option("--because <why>", "principles: the reason")
    .option("--ref <text>", "free-text reference, e.g. a ticket id")
    .action(function (this: Command, id: string) {
      const o = this.opts();
      act(this, (ctx, s) => edit(ctx, s, id, o));
    });

  program.command("drop <id>").description("delete a task, jot or learning that is no longer wanted")
    .action(function (this: Command, id: string) {
      act(this, (ctx, s) => drop(ctx, s, id));
    });

  program.command("merge <keep> <drop>").description("fold a duplicate into another item of the same kind and delete it")
    .action(function (this: Command, keep: string, gone: string) {
      act(this, (ctx, s) => merge(ctx, s, keep, gone));
    });

  program
    .command("jot <text>")
    .description("capture a thought mid-task, no questions: into the inbox, sorted at the check-in")
    .option("--file <path>", "attach a file next to it (repeatable); describe screenshots in the text instead when you can", collect)
    .action(function (this: Command, text: string) {
      const o = this.opts();
      act(this, (ctx, s) => jot(ctx, s, text, o));
    });

  program.command("inbox").description("list jots waiting to be sorted")
    .action(function (this: Command) {
      act(this, (ctx, s) => inbox(ctx, s));
    });

  program
    .command("board")
    .description("write the plan as an HTML page: now, queue, due, waiting, projects, areas and principles")
    .option("--open", "open it in the browser")
    .option("--out <file>", "where to write it (default: ~/.wk/boards/, outside the plan)")
    .action(function (this: Command) {
      const o = this.opts();
      act(this, (ctx, s) => board(ctx, s, o));
    });

  program
    .command("summary [text]")
    .description("show the plan summary, or overwrite it (8 lines max)")
    .action(function (this: Command, text?: string) {
      act(this, (ctx, s) => summaryCmd(ctx, s, text));
    });

  const json = argv.includes("--json");
  try {
    program.parse(argv, { from: "user" });
    return { code: 0, stdout: out.filter(Boolean).join("\n"), stderr: err.join("\n") };
  } catch (e) {
    if (e instanceof CommanderError) return { code: e.exitCode, stdout: out.join("\n"), stderr: err.join("\n") };
    const message = e instanceof WkError ? e.message : `Unexpected error: ${(e as Error).stack ?? e}`;
    if (json) return { code: 1, stdout: JSON.stringify({ error: message }, null, 2), stderr: "" };
    return { code: 1, stdout: out.join("\n"), stderr: message };
  }
}
