# wk setup

## No plan yet

When `wk` says there is no plan, ask the user where to keep it, then run `wk init --store <choice>`: `repo` commits it, `ignore` lists it in `.gitignore`, `local` keeps it private in `.git/info/exclude`, `home` keeps it outside the repo. If `wk init` prints "Existing plans: …", or `wk brief` prints "Empty plan.", offer onboarding (`wk guide onboarding`).

## Project summary and new epics

New work starts with a grilling session: one question at a time, each with a recommended answer. If `wk brief` says "No project summary yet.", start there: what the project is, who it's for, the goal, what's out of scope, what done means. Save it with `wk project "<text>"`, 8 lines or fewer, one `Label: …` per line, `\n` between lines.

Then the epic: `wk add epic "<title>"` plus the first known tasks (`wk add task "<title>" --epic E-00N --tags <tags>`), each ending with something the user can try. Write scope, out of scope and acceptance into the epic with `wk edit E-00N --body "..."`.

## Principles

While `wk brief` prints "No principles yet.", offer a principles session. Read the codebase for patterns already in use, then grill the user one area at a time, one question at a time, each with a recommended answer. Rules are one line each, numbered (`1. …`), checkable in a code review, 15 per file at most. Write them to the file `wk principles --tags <tag>` names; this is the only time you write a `.work/` file directly.

When a task's tag has no rules, ask: "No UI principles yet. Capture a few now, or carry on?" Skipping is fine; don't ask again for that tag in the same session. When the same kind of decision comes up twice, or a learning reads like a rule, suggest adding it to the principle file.

## Git workflow not chosen

The first time a branch or commit comes up, ask one question with a recommendation. Early in a project, recommend no branches and a commit after each task. Save the answer with `wk config set git.branch <none|task|epic>` and `wk config set git.commit <ask|task|checkpoint>`. Don't promise a workflow in chat; the next session won't remember it.

- `git.branch`: `none` stays on the current branch, `task` makes a `T-001-slug` branch at `wk start`, `epic` one `E-003-slug` branch per epic.
- `git.commit`: `ask` asks before every commit, `task` commits after `wk done`, `checkpoint` commits at each `wk checkpoint`.
