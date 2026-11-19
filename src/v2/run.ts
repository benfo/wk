import { Command, CommanderError } from "commander";
import { todayString } from "../context.js";
import { render, WkError, type Result } from "../output.js";
import { init } from "./commands/init.js";
import { addTask, ls, show } from "./commands/items.js";
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
    .description("add a task; it goes in the core area for now")
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
