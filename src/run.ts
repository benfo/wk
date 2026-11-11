import fs from "node:fs";
import path from "node:path";
import { Command, CommanderError } from "commander";
import { addEpic, addTask, addTasks, decide, idea, learn } from "./commands/capture.js";
import { block, checkpoint, done, handoff, start, unblock } from "./commands/flow.js";
import { configure } from "./commands/configure.js";
import { guide } from "./commands/guide.js";
import { init } from "./commands/init.js";
import { edit, merge, supersede, tidy } from "./commands/tidy.js";
import { brief, ls, next, principles, project, show, statusView } from "./commands/view.js";
import { loadContext, todayString, type Ctx } from "./context.js";
import { render, WkError, type Result } from "./output.js";
import { Store } from "./store.js";

export interface RunOptions {
  cwd?: string;
  /** Overrides today's date (YYYY-MM-DD). Tests use it; so does the WK_TODAY env var. */
  today?: string;
  /** Overrides where home-stored plans live (default ~/.wk, or WK_HOME). */
  home?: string;
  /** Text read by `--from -` (default: the process's stdin). */
  stdin?: string;
}

export interface RunOutput {
  code: number;
  stdout: string;
  stderr: string;
}

type Handler = (ctx: Ctx, store: Store) => Result;

const collect = (value: string, prev: string[] = []) => [...prev, value];

/** Runs one wk command in-process. `argv` excludes the node and script paths. */
export function run(argv: string[], options: RunOptions = {}): RunOutput {
  const cwd = options.cwd ?? process.cwd();
  const today = options.today ?? process.env.WK_TODAY ?? todayString();
  const out: string[] = [];
  const err: string[] = [];
  let json = false;

  const program = new Command("wk")
    .description("Track epics, tasks, ideas, decisions and learnings in plain text.")
    .option("--json", "machine-readable output")
    .option("--all", "lift the 10-line output limit")
    .exitOverride()
    .configureOutput({ writeOut: (s) => out.push(s.trimEnd()), writeErr: (s) => err.push(s.trimEnd()) })
    .showSuggestionAfterError();

  const emit = (cmd: Command, res: Result) => {
    const g = cmd.optsWithGlobals() as { json?: boolean; all?: boolean };
    out.push(render(res, g));
  };
  // Build one context per command, shared by the store and the handler.
  const act = (fn: Handler) =>
    function (this: Command) {
      const ctx = loadContext(cwd, today, options.home);
      emit(this, fn(ctx, new Store(ctx)));
    };

  program
    .command("init")
    .description("set up the plan and install the agent skill")
    .option("--store <where>", "repo, ignore (.gitignore), local (.git/info/exclude) or home (~/.wk)")
    .action(function (this: Command) {
      emit(this, init(cwd, { store: this.opts().store, home: options.home }));
    });

  program
    .command("guide")
    .description("print the agent rules; for agents that don't load the wk skill")
    .action(function (this: Command) {
      emit(this, guide());
    });

  program
    .command("config [action] [key] [value]")
    .description("show settings, or: wk config set git.branch none|task|epic, git.commit ask|task|checkpoint")
    .action(function (this: Command, action?: string, key?: string, value?: string) {
      act((ctx) => configure(ctx, action, key, value)).call(this);
    });

  program.command("brief").description("handoff, now task and what's next; first call of a session")
    .action(act((ctx, s) => brief(ctx, s)));

  program.command("next").description("now task, up to 5 next tasks, blocked and undecided ones")
    .action(act((ctx, s) => next(ctx, s)));

  const add = program.command("add").description("add a task or an epic");
  add
    .command("task [title]")
    .description("create a task and print its id, or many with --from")
    .option("--epic <id>", "epic it belongs to")
    .option("--tags <tags>", "comma-separated tags, e.g. api,ui")
    .option("--later", "put it on the roadmap instead of next")
    .option("--body <text>", "short notes, 6 lines max")
    .option("--needs-decision", "flag that a decision is needed before work")
    .option("--force", "add even if a similar item exists")
    .option("--from <file>", "one title per line from a file, or - for stdin; all or nothing")
    .action(function (this: Command, title: string | undefined) {
      const o = this.opts();
      if (o.from !== undefined) {
        if (title) throw new WkError("Give a title or --from, not both.");
        const file = path.resolve(cwd, o.from);
        if (o.from !== "-" && !fs.existsSync(file)) throw new WkError(`File not found: ${file}`);
        const input = o.from === "-" ? options.stdin ?? fs.readFileSync(0, "utf8") : fs.readFileSync(file, "utf8");
        act((ctx, s) => addTasks(ctx, s, input, o)).call(this);
        return;
      }
      if (!title) throw new WkError('Give a title: wk add task "<title>" (or --from <file>)');
      act((ctx, s) => addTask(ctx, s, title, o)).call(this);
    });
  add
    .command("epic <title>")
    .description("create an epic with scope, out of scope and acceptance sections")
    .option("--tags <tags>", "comma-separated tags")
    .option("--force", "add even if a similar epic exists")
    .action(function (this: Command, title: string) {
      const o = this.opts();
      act((ctx, s) => addEpic(ctx, s, title, o)).call(this);
    });

  program.command("show <id>").description("print one item in full")
    .action(function (this: Command, id: string) {
      act((ctx, s) => show(ctx, s, id)).call(this);
    });

  program
    .command("start <id>")
    .description("set a task to now (only one at a time)")
    .option("--branch", "create a <id>-<slug> branch from the current branch")
    .option("--no-branch", "stay on the current branch even if config says to branch")
    .action(function (this: Command, id: string) {
      const o = this.opts() as { branch?: boolean };
      // Commander defaults a --no-* pair to true; only pass a value the user typed.
      const typed = this.getOptionValueSource("branch") === "cli" ? o.branch : undefined;
      act((ctx, s) => start(ctx, s, id, { branch: typed })).call(this);
    });

  program
    .command("checkpoint")
    .description("move the now task to review; record automated checks and what a human should test")
    .option("--test <text>", "for a human: how it looks, feels, reads or responds (repeatable)", collect)
    .option("--checked <result>", "an automated check you already ran, e.g. \"75 tests pass\" (repeatable)", collect)
    .action(function (this: Command) {
      const o = this.opts();
      act((ctx, s) => checkpoint(ctx, s, o)).call(this);
    });

  program
    .command("done <id>")
    .description("mark a reviewed task done")
    .option("--force", "skip review for trivial tasks")
    .action(function (this: Command, id: string) {
      const o = this.opts();
      act((ctx, s) => done(ctx, s, id, o)).call(this);
    });

  program.command("block <id> <reason>").description("flag a task as blocked")
    .action(function (this: Command, id: string, reason: string) {
      act((ctx, s) => block(ctx, s, id, reason)).call(this);
    });

  program.command("unblock <id>").description("clear the blocked flag")
    .action(function (this: Command, id: string) {
      act((ctx, s) => unblock(ctx, s, id)).call(this);
    });

  program
    .command("idea <text>")
    .description("capture an idea, 2 lines max")
    .option("--epic <id>", "epic it relates to")
    .option("--force", "add even if a similar item exists")
    .action(function (this: Command, text: string) {
      const o = this.opts();
      act((ctx, s) => idea(ctx, s, text, o)).call(this);
    });

  program
    .command("decide <what>")
    .description("record a decision")
    .option("--why <why>", "the reason, 2 lines max")
    .option("--rejected <text>", "what was rejected, 1 line")
    .action(function (this: Command, what: string) {
      const o = this.opts();
      act((ctx, s) => decide(ctx, s, what, o)).call(this);
    });

  program.command("learn <text>").description("record a learning, 2 lines max")
    .action(function (this: Command, text: string) {
      act((ctx, s) => learn(ctx, s, text)).call(this);
    });

  program
    .command("ls [kind]")
    .description("list tasks (default), epics, ideas, decisions or learnings")
    .option("--epic <id>", "only this epic")
    .option("--tag <tag>", "only this tag")
    .option("--status <status>", "only this status")
    .option("--archived", "list archived items instead")
    .action(function (this: Command, kind: string | undefined) {
      const o = this.opts();
      act((ctx, s) => ls(ctx, s, kind, o)).call(this);
    });

  program
    .command("status")
    .description("each epic with progress, its now and next tasks, then later counts")
    .option("--epic <id>", "one epic with all its tasks")
    .action(function (this: Command) {
      const o = this.opts();
      act((ctx, s) => statusView(ctx, s, o)).call(this);
    });

  program.command("project [text]").description("show the project summary, or overwrite it (8 lines max)")
    .action(function (this: Command, text?: string) {
      act((ctx, s) => project(ctx, s, text)).call(this);
    });

  program.command("handoff <text>").description("overwrite the handoff note, 5 lines max; last call of a session")
    .action(function (this: Command, text: string) {
      act((ctx, s) => handoff(ctx, s, text)).call(this);
    });

  program
    .command("principles")
    .description("print the rules for some tags")
    .option("--tags <tags>", "comma-separated tags, e.g. ui,api")
    .action(function (this: Command) {
      const o = this.opts();
      act((ctx, s) => principles(ctx, s, o)).call(this);
    });

  program
    .command("tidy")
    .description("list plan problems; --fix archives old done items and closes finished epics")
    .option("--fix", "apply the safe fixes")
    .action(function (this: Command) {
      const o = this.opts();
      act((ctx, s) => tidy(ctx, s, o)).call(this);
    });

  program.command("merge <keep> <drop>").description("fold a task or idea into another (or an idea into a task) and delete the duplicate")
    .action(function (this: Command, keep: string, drop: string) {
      act((ctx, s) => merge(ctx, s, keep, drop)).call(this);
    });

  program.command("supersede <old> <new>").description("mark an old decision as replaced by a new one")
    .action(function (this: Command, oldId: string, newId: string) {
      act((ctx, s) => supersede(ctx, s, oldId, newId)).call(this);
    });

  program
    .command("edit <id>")
    .description("rewrite an item in place; the same limits apply")
    .option("--title <title>", "new title")
    .option("--body <text>", "new body")
    .option("--tags <tags>", "replace tags")
    .option("--epic <id>", "move to an epic (none to clear)")
    .option("--needs-decision", "flag that a decision is needed")
    .option("--no-needs-decision", "clear the decision flag")
    .action(function (this: Command, id: string) {
      const o = this.opts() as Record<string, unknown>;
      const typed = this.getOptionValueSource("needsDecision") === "cli" ? (o.needsDecision as boolean) : undefined;
      act((ctx, s) => edit(ctx, s, id, { ...o, needsDecision: typed })).call(this);
    });

  try {
    json = argv.includes("--json");
    program.parse(argv, { from: "user" });
    return { code: 0, stdout: out.filter(Boolean).join("\n"), stderr: err.join("\n") };
  } catch (e) {
    if (e instanceof CommanderError) {
      // --help and --version exit through here with code 0.
      return { code: e.exitCode, stdout: out.join("\n"), stderr: err.join("\n") };
    }
    const message = e instanceof WkError ? e.message : `Unexpected error: ${(e as Error).stack ?? e}`;
    if (json) return { code: 1, stdout: JSON.stringify({ error: message }, null, 2), stderr: "" };
    return { code: 1, stdout: out.join("\n"), stderr: message };
  }
}
