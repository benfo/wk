import { Command, CommanderError } from "commander";
import { todayString } from "../context.js";
import { render, WkError, type Result } from "../output.js";
import { init } from "./commands/init.js";
import { areaList, areaNew, projectList, projectNew, projectShow, summaryCmd } from "./commands/homes.js";
import { addTask, ls, move, show } from "./commands/items.js";
import { loadContext, type Ctx } from "./context.js";
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
