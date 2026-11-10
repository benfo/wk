# wk: text-based project workflow spec

## Goal

wk is a small CLI plus an agent skill for tracking software work in plain text files. It lets me start fresh agent sessions often without losing the thread. The agent asks the CLI for what it needs. It never reads the files directly.

It tracks epics, tasks, ideas, decisions and learnings. It answers "what's next" in a few lines. It pauses after each piece of work so a human can test it. It keeps my principles in front of the agent, but only the ones that matter for the task at hand.

Phase one keeps `.work/` in the repo. Build it, use it for a week or two, then extend.

## Decisions locked

| Decision | Choice | Why |
| --- | --- | --- |
| Name | `wk` | Short to type. |
| Language | TypeScript on Node 20+ | Runs on Windows, macOS and Linux. Same stack as my frontend work. |
| Distribution | npm package with a `wk` bin | `npm i -g` or `npx wk`. No native deps. |
| Paths | Node `path` and `os.homedir()` only | No hardcoded slashes. Works on Windows. |
| Tracker | Not wk's job | wk never talks to a tracker. Other skills or tools in a repo can, and wk only stores a `ref`. |
| Tracker field | `ref`, a free-text field | Keeps wk tracker-neutral. |
| Git workflow | Chosen by me, saved in config | `git.branch` (none, task, epic) and `git.commit` (ask, task, checkpoint). Unset means the agent asks once and saves the answer. It never applies its own git defaults. |
| Generic layer | Config only, no adapters | Generalise when a second real person uses it. |
| Personal vs shareable | Principles and templates live apart from the CLI | Sharing means "bring your own principles". |
| Agent integration | Rules shipped inside the npm package, no MCP server | Any agent that can run a shell uses `wk` directly. `wk guide` prints the rules, `AGENTS.md` points at it, and Claude also gets them as a skill. MCP would duplicate the CLI and cost context every session. |

## Storage and file format

One item per file. Markdown with YAML frontmatter. Small files keep diffs clean and let the CLI read only what it needs.

`wk init --store <choice>` picks where the plan lives. There is no default: without `--store`, init lists the choices and stops, so the agent asks.

| Store | Plan lives in | Git |
| --- | --- | --- |
| `repo` | `.work/` at the repo top level | Committed |
| `ignore` | `.work/` at the repo top level | Listed in `.gitignore` |
| `local` | `.work/` at the repo top level | Listed in `.git/info/exclude`, so only you know |
| `home` | `~/.wk/projects/<slug>/`. The slug comes from the git remote URL, so every clone shares one plan; without a remote it is the folder name plus a path hash. | Nothing in the repo; the skill copy is excluded |

`local` and `home` are personal: wk changes no tracked file, not even `AGENTS.md`. Commands find the plan the same way for every store: the nearest `.work/` walking up, then the home folder for this repo. `WK_HOME` overrides `~/.wk`. Outside a git repo, the project is the current folder, `ignore` and `local` are refused, and git features are skipped quietly.

```
.work/
  config.yml
  project.md                  what this is, who for, goal, out of scope, done when
  handoff.md
  epics/E-003.md
  tasks/T-031.md
  ideas/I-007.md
  decisions/D-012.md
  learnings/L-004.md
  archive/                    done items, out of the way
  principles/arch.md
  principles/ui.md
```

A task file:

```
---
id: T-031
title: Refresh token endpoint
epic: E-003
status: next
tags: [api]
ref:
needs_decision: false
created: 2026-11-10
---
Test: log in with an expired token, expect a redirect to /login.

Notes go here. Keep it short.
```

The project summary sits above everything: the why. Epics are chunks of work, tasks are testable steps, and decisions, learnings and principles support all three. IDs are a prefix plus a zero-padded counter. The CLI keeps counters in `config.yml`. Epics hold scope, out of scope and acceptance criteria from the grilling session. Decisions hold what, why and what was rejected. Principles are one numbered rule per line, grouped by tag, one file per tag.

## States

A task moves through these states. Phase one uses the first four plus `done`. Phase three adds `pr` and `merged` as optional states.

| State | Meaning | Set by |
| --- | --- | --- |
| `later` | On the roadmap, not soon | `wk add --later` |
| `next` | Ready to pick up | `wk add` (default) |
| `now` | In progress. Only one at a time. | `wk start` |
| `review` | Built, waiting for a human test | `wk checkpoint` |
| `pr` | Pushed, PR open (phase three) | `wk pr` |
| `merged` | PR merged (phase three) | `wk merged` |
| `done` | Finished | `wk done` |

`blocked` is a flag, not a state. A task can be blocked in `next` or `now`. Same for `needs_decision`. `wk next` lists both so nothing stalls quietly.

## Phase one commands

Every command prints plain text, 10 lines or fewer by default. `--json` gives machine output. `--all` lifts the limit. The agent should never need more than that.

| Command | Does |
| --- | --- |
| `wk init --store <repo\|ignore\|local\|home>` | Creates the plan folder, `config.yml`, empty folders and empty principle files. Copies the skill to `.claude/skills/wk/`. Adds the pointer to `AGENTS.md` (and to `CLAUDE.md` if one exists) unless the store is personal. Safe to rerun: refreshes the skill, keeps the data. A fresh init also lists existing plans worth migrating. |
| `wk guide` | Prints the agent rules, for agents that don't load the skill |
| `wk brief` | Prints the project summary's first line, the handoff note, the `now` task and the top of `wk next`. First call of every session. On an empty plan it says so, to prompt onboarding. Shows the handoff's date, and flags it when a task or epic changed after it. Starts the session count. |
| `wk next` | Prints the `now` task, up to 5 `next` tasks, and anything blocked or needing a decision |
| `wk add task "<title>" [--epic E-003] [--tags api,ui] [--later]` | Creates a task, prints its ID |
| `wk add task --from <file\|-> [--epic] [--tags] [--later]` | One task per line (checklist markers are stripped). All or nothing: any title over the limit or similar to an open item stops the batch and lists every problem line. |
| `wk add epic "<title>"` | Creates an epic with empty scope, out of scope and acceptance sections |
| `wk show <id>` | Prints one item in full. The only way the agent reads an item body. |
| `wk start <id> [--branch\|--no-branch]` | Sets it to `now`. Refuses if another task is `now`. Follows `git.branch`: stays put, switches to `T-031-<slug>`, or switches to the epic's `E-003-<slug>`, creating it if needed. Unset means stay put. `--branch` and `--no-branch` override for one task. Says when the task's epic differs from the last task started this session. |
| `wk config [set <key> <value>]` | Prints the settings, or sets `git.branch`, `git.commit` or `principles_dir` |
| `wk checkpoint [--checked "<result>"] [--test "<for me>"]` | Moves the `now` task to `review`. `--checked` records automated results the agent already ran (tests, types, build), so I never run them. `--test` is for things only a person can judge: look, feel, keyboard, how output reads. Both repeat. Prints them with a short git diff summary, says when there's nothing for a human to test, and reminds the agent to hand off. |
| `wk done <id>` | Sets it to `done`. Expects `review` first; `--force` skips that for trivial tasks. Reminds the agent to hand off and to say whether a fresh session fits. From the third task finished this session, it recommends a fresh one outright. |
| `wk block <id> "<reason>"` / `wk unblock <id>` | Toggles the blocked flag |
| `wk idea "<text>" [--epic E-003]` | Captures an idea in one line |
| `wk decide "<what>" --why "<why>"` | Records a decision |
| `wk learn "<text>"` | Records a learning |
| `wk ls [tasks\|ideas\|decisions] [--epic] [--tag] [--status]` | Filtered one-line-per-item list |
| `wk status [--epic E-003]` | Terminal view of the whole plan: each epic with a progress bar and done/total, its `now` and `next` tasks, then a count of `later` tasks and ideas. |
| `wk project ["<text>"]` | Shows `project.md` in full, or overwrites it. `wk brief` prints its first line, or "No project summary yet." |
| `wk handoff "<text>"` | Overwrites `handoff.md`. Run at every stop, so clearing context is always safe. |
| `wk principles --tags ui,api` | Prints the rules for those tags, or says which tags have none |
| `wk tidy [--fix]`, `wk merge`, `wk supersede`, `wk edit` | See "Keeping the plan clean". |

`wk status` output:

```
E-003 Auth rework      ███████░░░  7/10
  now   T-031 Refresh token endpoint
  next  T-032 Logout clears cookie
  next  T-034 Session timeout warning
E-004 Settings page    ██░░░░░░░░  2/9
later   3 tasks, 4 ideas
```

The bar uses plain block characters, so it works in any terminal. `--epic E-003` shows one epic with all its tasks. The HTML board stays in phase four.

Tech notes: `commander` for args, `gray-matter` for frontmatter, `simple-git` or plain `git` calls for the remote URL. Tests with `vitest` against a temp folder.

## Config

`config.yml` sits in the root. Phase one reads `store`, `git`, `counters` and `principles_dir`. `wk config` prints the settings and `wk config set <key> <value>` changes one without touching the rest of the file. wk never enforces team process, and never talks to a tracker. A repo's own skills do that, calling `wk` where they need to.

```
store: local                  # repo, ignore, local or home; chosen at wk init
principles_dir: principles   # or an absolute path, shared across projects
counters: { E: 3, T: 31, I: 7, D: 12, L: 4 }
git:
  branch: none                # none, task (T-031-slug) or epic (E-003-slug); empty = not chosen
  commit: task                # ask, task (after wk done) or checkpoint; empty = not chosen

# phase three
require_ref_on_start: false   # optional gate, off by default
```

**The git workflow is mine to choose, never the agent's.** Agents bring their own git habits (branch before committing, commit when they think it's right). The `git` keys replace those habits. While a key is empty, `wk start` never branches, `wk brief` says the workflow isn't chosen, and the skill asks me once, with a recommendation, the first time a branch or commit comes up. It then saves my answer with `wk config set`. `wk brief` prints the workflow in one line every session, so a fresh agent sees it before touching git. `wk checkpoint` and `wk done` print a `Git:` line when the workflow says to commit or to ask. `--branch` and `--no-branch` on `wk start` override `git.branch` for one task. An old `branch_on_start: true` still reads as `git.branch: task`.

`principles_dir` can point outside the project. That lets one set of principles serve every project, and keeps them out of a shared CLI repo.

## Agent skill rules

The rules ship inside the npm package as a skill. `wk init` copies it to `.claude/skills/wk/` and adds a one-line pointer to `AGENTS.md` that tells any agent to run `wk guide`, then `wk brief`. Updating wk updates the rules too. These are the rules it gives the agent.

1. Start every session with `wk brief`. Do not read `.work/` or `~/.wk/` files directly. Use `wk show` for detail.
2. "What's next" means run `wk next` and summarise it in a few lines.
3. A new piece of work starts with a grilling session. Its outcome becomes `wk add epic` plus the first known tasks. A new project first gets its summary: what it is, who it's for, the goal, out of scope, and what done means, saved with `wk project`. Work that falls outside it gets flagged, not quietly added.
4. Before coding a task, run `wk principles --tags <task tags>` and follow what it returns. If it reports a gap, see "Capturing principles" below.
5. Off-topic idea from the user: `wk idea`, say "captured as I-008", carry on.
6. A choice gets made: `wk decide`. Something surprising: `wk learn`.
7. New work found mid-task: `wk add task`. Don't silently grow the current task. If `wk add` reports a similar item, update or merge it instead.
8. After each logical piece of work, stop. Run the automated checks that cover the change yourself and report them in one line with `--checked`, saying which ran. Give me `--test` items only for what a person interacts with: how it looks and feels, keyboard, how output reads, whether a flow makes sense. If unsure, ask whether it's worth my eyes. If there's nothing for me to test, say so and ask for a quick go-ahead. Wait for me before `wk done`.
9. Hand off at every stop: after every `wk checkpoint` and `wk done`, run `wk handoff` with 5 lines or fewer: where we stopped, what's half done, what to do first next time. It overwrites, so it's cheap, and it makes clearing context safe at any moment. Always hand off when I say I'm stopping, before suggesting a clear, right after a compaction and before switching epics.
10. At every stop, recommend one of: continue here (the next task builds on what's loaded), fresh session (unrelated next task, another epic, heavy context, a compaction, repeating itself), or subagent (read-heavy work where only the conclusion matters). One line, with the reason. Be honest: agents can't forget selectively, and everything in context is resent every turn.

   An agent can't see its own token count, so wk supplies facts instead. `wk brief` starts a session count, kept per machine in `~/.wk/sessions/` so a committed `.work/` doesn't churn. `wk done` says "3 tasks done this session" from the third task on. `wk start` says when the task's epic differs from the last one started. The agent treats both as a fresh-session recommendation unless it can name what the next task needs from this session. The threshold of 3 is a guess, to revisit after real use.

**Onboarding an existing project.** The CLI spots the moment. The skill does the judging. A fresh `wk init` scans for existing plans (TODO, ROADMAP, BACKLOG, TASKS and PLAN files at the top level or in `docs/`, ADR and plan folders, TODO/FIXME comments, a GitHub remote) and prints one line: "Existing plans: … Offer onboarding." `wk brief` on an empty plan prints "Empty plan." The skill then runs onboarding one step at a time:

1. Survey the README, recent history, the listed sources, and GitHub issues only if I say yes. Summarise in 5 lines.
2. Propose a project summary drafted from the README and history, then epics for work in flight, tasks under each, and a `later` pile. I confirm or trim one epic at a time.
3. Migrate through `wk add epic`, `wk add task --from -`, `wk decide` for ADRs and `wk idea` for open questions, so limits and the duplicate check still apply.
4. Ask before touching old files: keep, delete, or replace with a pointer. Never delete silently.
5. Run the principles session, then `wk tidy` and a first `wk handoff`.

No format-specific importers. The agent reads any source and writes through `wk add`, so one path covers every format.

**Capturing principles.** The CLI notices gaps. The skill acts on them, at three moments:

- **At setup.** `wk init` creates empty principle files. While they're empty, `wk brief` prints "No principles yet." The skill offers a principles session: read the codebase for patterns already in use, then grill me one area at a time, one question at a time, each with a recommended answer. Rules are one line each, checkable in a code review, 15 per file at most.
- **Before a task.** If `wk principles --tags ui` finds no UI rules, the skill asks: "No UI principles yet. Capture a few now, or carry on?" Skipping is fine. It doesn't ask again for that tag in the same session.
- **While working.** When the same kind of decision comes up twice, or a learning reads like a rule, the skill suggests promoting it: "This looks like a principle. Add to arch.md?" `wk promote L-004 --to arch` turns it into a one-line rule.

Decisions and learnings feed principles. Principles guide the next tasks.

## Keeping the plan clean

The plan only helps if it stays small and true. The CLI enforces what it can. The agent follows the boyscout rule for the rest: leave the plan a bit cleaner every time you touch it.

**No duplicates.** `wk add` compares the new title against open tasks and ideas. On a close match it prints "Similar: T-028 Refresh token flow" and stops. `--force` adds it anyway. The agent then either updates the existing item or merges.

**Short by rule, not by hope.** The CLI refuses text over these limits:

| Item | Limit |
| --- | --- |
| Any title | 70 characters |
| Task body | 6 lines |
| Decision | What: 1 line. Why: 2 lines. Rejected: 1 line. |
| Idea, learning | 2 lines |
| Handoff | 5 lines |
| Project summary | 8 lines |

Writing rules for the agent: plain words, concrete nouns, no filler, no restating the title in the body. One task is one thing a person can test.

**Tidy as you go.**

| Command | Does |
| --- | --- |
| `wk tidy` | Prints problems, 10 lines max: likely duplicates, `next` tasks untouched for 30 days, ideas older than 60 days, epics with every task done, tasks pointing at a missing epic |
| `wk tidy --fix` | Archives `done` items older than 7 days and closes finished epics. Everything else stays a suggestion. |
| `wk merge <keep> <drop>` | Folds one task or idea into another, keeps the shorter text, deletes the duplicate |
| `wk supersede <old> <new>` | Marks an old decision as replaced. Never edit a decision's history. |
| `wk edit <id> --title/--body` | Rewrites an item in place, same limits apply |

Archived items move to `archive/`. `wk ls` and `wk next` ignore them, which keeps every command's output small. `wk ls --archived` still finds them.

**When the agent tidies.** After `wk checkpoint` and before `wk handoff`, run `wk tidy`. Fix anything small that touches the current epic: merge a duplicate, tighten a wordy task, drop a task the work made pointless, supersede a decision we just changed. Anything bigger goes to me as a one-line question. Never delete without saying so.

## Later phases

Only start these after a week or two of real use. Expect the list to change.

| Phase | Adds |
| --- | --- |
| Two | `wk promote <idea>` into a task, `wk promote <learning\|decision> --to <tag>` into a principle |
| Three | Optional `require_ref_on_start`, `{ref}-{slug}` branch names, `wk link`, optional `pr` and `merged` states. Tickets, ticket drafts and other team process live in the work repo's own skills. |
| Four | `wk board`: one static HTML file with a kanban for the current epic, progress per epic and a now/next/later roadmap. `wk refresh` reads PR status through `gh`. |

## Open questions

- When to run the full automated suite. Slow suites shouldn't run at every checkpoint. One option: quick checks (types plus tests related to the change) at every checkpoint, the full suite at major points (end of an epic, before a commit or PR, before the last handoff of a session), and `checks: { quick, full }` commands in config so the agent doesn't guess. Decide after a week of real use.
- Later, maybe: non-coding projects like building a bed or planning a holiday. The core loop already fits. Revisit after real use, not before.
