# wk spec (v2)

Status: built. This replaced the v1 spec. There is no backwards compatibility in the CLI; a one-shot `wk migrate` converts a v1 plan (see [Migrating a v1 plan](#migrating-a-v1-plan)). [docs/wk-guide.pdf](docs/wk-guide.pdf) explains the philosophy and usage with worked examples.

## Why v2

v1 works for the core loop (brief, start, checkpoint, done, handoff). Real use showed these gaps:

- **Capture forces sorting mid-flow.** Every thought must become a task or an idea, with an epic and a slot, while the user is in the zone.
- **Filed things never come back.** An idea about an epic stays in a flat list after the epic closes. Ideas only resurface when there are too many.
- **Work outside an epic has no home.** A misaligned button or a stray bug only fits if some epic happens to be open.
- **Kind is baked into IDs and folders.** `I-008` can't become a task; merging deletes it and its history.
- **Sequential IDs collide** when two branches both create the next `T-019`.
- **Filenames mean nothing** in git, editors or PRs (`T-013.md`).
- **Principles drift** into generic, duplicated and stale rules with no reason attached.
- **The core leans on software** (tests, git, bugs), though the loop fits any project.

## Goals and non-goals

Goals:

1. Capture costs nothing in the moment; sorting happens at a natural pause.
2. Everything filed comes back at the moment it matters, without the user remembering it.
3. One item model; kind, home and timing are fields, not structure.
4. A domain-agnostic core that ships as an installable skill for any agent that can run a shell.
5. The agent never reads plan files directly and never needs more than about 10 lines per call.

Non-goals: tracker integration, team process, storing screenshots by default, sync between machines, backwards compatibility.

## Influences

| Source | Idea | Becomes in wk |
| --- | --- | --- |
| GTD | Inbox: capture without deciding | `wk jot`, sorted at check-in |
| GTD | 2-minute rule | Tiny in-scope fixes are done now and listed under `Also:` |
| GTD | Next actions, projects, someday/maybe | Queue, projects, `someday` |
| GTD | Waiting for | `wait` field on a task |
| GTD | Tickler | `when` triggers that make an item due |
| GTD | Weekly review | `wk review` |
| PARA | Projects end, areas don't | Two kinds of home |
| PARA | Resources, archive | Decisions, learnings, principles; `archive/` |
| CODE | Distill | Project close turns learnings into principles |
| CODE | Express | Check-ins and handoffs, unchanged from v1 |

## Model

Everything is an **item**: one markdown file with YAML frontmatter.

### Kinds

| Kind | Actionable | Notes |
| --- | --- | --- |
| `task` | yes | Anything to do. An idea is a task with `when: someday`. A bug is a task tagged `bug`. |
| `decision` | no | What, why, what was rejected. Superseded, never edited. |
| `learning` | no | Something surprising, 2 lines. Raw material for principles. |
| `principle` | no | A rule loaded at `wk start`. See [Principles](#principles). |

Ideas are no longer a kind. "Promote an idea" is `wk move <id> --when next`: same id, same file, history kept.

### Homes

Every item lives in exactly one home.

| Home | Ends | Holds |
| --- | --- | --- |
| **Project** | yes, when its acceptance is met | Goal, acceptance, the areas it touches, its tasks, decisions, learnings |
| **Area** | never | A short description, principles, and tasks with no project |

`wk init` creates one area, `core`: always in scope, its principles load for every task, and anything without a better home lands there. Other areas (`ui`, `api`, `docs`, `garden`, `budget`) are created as needed with `wk area new`.

Projects list the areas they touch (`touches: [ui, api]`). That link drives principles and resurfacing.

### States

| State | Meaning |
| --- | --- |
| `inbox` | Jotted, not sorted |
| `open` | Sorted, not started |
| `now` | In progress, one at a time |
| `review` | Built, waiting for the user |
| `done` | Finished. `wk drop` deletes an unwanted item instead of keeping an abandoned state. |

Waiting is a field, not a state: `wait: <what>` (a decision, another item, someone else). `wk next` lists waiting items so nothing stalls quietly.

### When

When an open task should come back.

| Value | Meaning | Comes back |
| --- | --- | --- |
| `next` | Front of the queue | At once |
| `queue` | Bottom of the queue (default) | In order |
| `later` | Committed, not soon | `wk review`, project close |
| `someday` | Not committed | `wk review` |
| `after:<id>` | When that item is done | `wk done <id>` |
| `end:<project>` | When that project closes | Project close |
| `start:<area>` | When work touching that area starts | `wk start`, `wk project new` |
| `on:<date>` | On or after a date | `wk brief` |

A fired trigger makes the item **due**: `wk brief` lists it under `Due:` until it's moved, queued or dropped. Nothing moves into the queue on its own.

### Tags

Thin, cross-cutting labels: `bug`, `quick`, `perf`, `ux`. Areas are homes, not tags. `wk add` notes a tag never seen before, suggesting the nearest known one ("New tag: bugs. Did you mean bug?"). `wk tags` lists them with counts.

### Fields

```markdown
---
id: r8vn
kind: task
state: open
when: start:ui
tags: [bug]
from: k7f2                 # captured while working on this
links: [m3qa]
rank: 0.5                  # set by wk move; queue order
wait:
ref:                       # free text, e.g. a ticket id
created: 2026-11-19
updated: 2026-11-19
---
# Banner border shifts right with wide content

Border moves 2 columns right when content is over 30 characters, in an 80-column terminal.
```

The title is the first heading. `from` records where a thing was noticed, so wk can show it again next to related work.

## Principles

Principles exist to give the agent the project's own rules at the moment they matter, cheaply. **A principle belongs only if a capable model, reading this project, would otherwise get it wrong.** Generic good practice, facts the code already states (paths, library choices, flag lists) and specs belong elsewhere or nowhere.

Each principle has three parts:

```
Rule:    Never print, block or exit nonzero on the startup path.
Instead: of reporting errors the usual way.
Because: it runs inside every shell start; a failure breaks the user's terminal.
```

- **Instead** names the default it overrides. If none can be named, the model would do it anyway: drop it.
- **Because** lets the agent handle cases the rule doesn't cover.
- **Test** (optional) points at a check that enforces it. If a principle can be a test, make it one and point to it.

Where they come from, best first: the user's corrections ("no, not emoji"), learnings and decisions distilled at project close, the same decision made twice, a principles session at setup.

Which load at `wk start`: `core`, the task's home area, and the areas its project touches. At most 15 per area. `wk review` flags principles with no `because`, duplicates, and ones that restate the code.

Goals and targets ("feels instant", "fits on a phone screen") go in the project or area description, not in principles.

## Storage

Folders follow **home**, not state or kind. Starting, finishing or retagging an item never moves its file; only changing its home or archiving does. Diffs stay small and branches rarely conflict.

```
.work/
  config.yml
  summary.md                       what this is, who for, goal, out of scope, done when
  session.md                       the handoff
  inbox/
    t4wz-wide-content-breaks-banner.md
  areas/
    core/
      area.md
      h2cq-never-break-startup.md  (a principle)
    ui/
      area.md
      r8vn-banner-border-shifts-right.md
  projects/
    k3m9-usage-history/
      project.md                   goal, acceptance, touches
      k7f2-record-each-run.md
      p2xd-store-history-as-jsonl.md   (a decision)
  archive/
    2026/k3m9-usage-history/       a closed project moves as one folder
    2026/areas/ui/                 done area items older than 7 days
```

- **Filenames** are `<id>-<slug>.md`. The slug comes from the title (lowercase ASCII, dashes, 40 characters max). wk renames the file when the title changes.
- **IDs** are 4 random characters from `23456789abcdefghjkmnpqrstuvwxyz` (no `0 1 i l o`), checked against every file including the archive. No kind prefix, since kind can change. Commands accept any unique prefix.
- **Attachments** are opt-in (`--file`) and sit next to their item as `<id>-<n>.<ext>`, so they archive with it. By default the agent describes a screenshot in the item body instead: text survives fresh sessions, searches and diffs.
- **Session counts** stay per machine in `~/.wk/sessions/`, as in v1.
- **Stores** (`repo`, `ignore`, `local`, `home`) are unchanged from v1.

## Commands

Every command prints 10 lines or fewer; `--all` lifts the limit, `--json` gives fields.

| Command | Does |
| --- | --- |
| `wk` or `wk brief` | Summary line, handoff, `now`, top of the queue, `Due:`, inbox count, review nudge, `Workflow:` line, instruction drift |
| `wk setup [--done]` | Lists instruction files and the stored workflow; `--done` records their fingerprints |
| `wk next` | `now`, up to 5 queued, due and waiting items |
| `wk jot "<text>" [--file <path>]` | Into the inbox with `from` set to the `now` task. No questions, no duplicate check. |
| `wk inbox` | Lists inbox items for sorting |
| `wk add "<title>" [--in <home>] [--when <w>] [--tags] [--body] [--file]` | A sorted task in one step. Duplicate check as in v1. |
| `wk decide "<what>" --why "<why>" [--rejected "<other>"]` | A decision in the current home |
| `wk learn "<text>"` | A learning in the current home |
| `wk principle "<rule>" --instead "<default>" --because "<why>" [--in <area>] [--from <id>] [--test <ref>]` | A principle; `--from` distills a learning or decision and links it |
| `wk move <id> [--in <home>] [--when <w>] [--before\|--after <id>\|--top\|--bottom]` | Sort an inbox item, change home or timing, reorder |
| `wk start <id>` | Sets `now`. Prints the body, the principles that apply, and `Related:` items |
| `wk check [--checked] [--test] [--handoff] [--fresh]` | Moves `now` to `review` (v1's checkpoint). Lists items jotted during this task and the first `Tidy:` problem. |
| `wk add --from <file|->` | One title per line, all or nothing, as in v1; for onboarding. |
| `wk board [--open] [--out <file>]` | The plan as one self-contained HTML page (no scripts, light and dark) with two CSS-only tabs. Now: the task in progress and handoff, a needs-you strip (ready to try, due), the queue, projects with progress, recent activity. Plan: inbox, waits, wakes, later and someday, done this week, areas with principles, recent decisions. Written to `~/.wk/boards/` so a committed plan never churns. |
| `wk board --serve [--port <n>] [--open]` | The same page, live on localhost (default port 4123, or the next free one). It watches the plan folder and pushes a reload over server-sent events within a second of any change. Node built-ins only; Ctrl+C stops it. |
| Board contents | One screen: the task in progress (with how long since it started) and the handoff; panes for the queue and what wakes up later and on what, what needs you (ready to try with how long it has waited, due, inbox, waits, done this week), and the plan (just happened, projects, areas with principles, recent decisions). The top line shows the current git branch. Live, the tab title and icon carry the needs-you count, and an opt-in notification fires when something new needs you while the tab is hidden. |
| Event log | Every command snapshots the plan before and after it runs; the difference (added, jotted, started, ready to try, done, sorted, due, waiting, dropped, project started or closed) is appended to `~/.wk/events/`, per machine and outside the plan. It feeds the activity list and the timers. |
| `wk config [set <key> <value>]` | Keys: `git.branch` (`none`, `task`, `project`), `git.commit` (`ask`, `task`, `check`), `commit_style`, `checks.quick`, `checks.full`, `tracker`, `preset`, `tags`. |
| `wk done <id>` | Finishes, fires `after:` triggers, starts project close when it was the last task |
| `wk wait <id> "<on what>"` / `wk wait <id> --clear` | Waiting flag |
| `wk drop <id>`, `wk merge <keep> <drop>`, `wk supersede <old> <new>`, `wk edit <id>` | As in v1, for every kind |
| `wk show <id>` | One item in full |
| `wk ls [words…]` | Each word filters by kind, home, state, `when`, tag or id prefix: `wk ls bug ui`, `wk ls someday` |
| `wk project new "<title>" --touches ui,api` | Creates a project; fires `start:` triggers for the areas it touches |
| `wk project close <id>` | The close flow, see below |
| `wk area new <name> "<description>"` / `wk area` | Create or list areas |
| `wk summary ["<text>"]` | Show or overwrite `summary.md` |
| `wk review` | The weekly review, see below |
| `wk handoff "<text>" [--fresh]` | As in v1 |
| `wk init`, `wk config`, `wk guide [topic]`, `wk tags` | Setup, settings, rules, tag list |

Gone from v1: `idea` (now `jot` or `add --when someday`), `checkpoint` (now `check`), `block` (now `wait`), `tidy` (folded into `review`; `check` still prints the first problem), `project` (now `summary`), `principles` (`start` prints them; `wk ls principle ui` lists them).

## Surfacing

The CLI spots the moment and prints a cue; the skill decides what to do with it.

| Moment | wk prints |
| --- | --- |
| `wk brief` | `Due:` from fired `on:` triggers and earlier firings; `Inbox: 3 to sort`; `Review due` after 7 days or 10 inbox items; `<file> changed since setup` |
| `wk start` | Principles that apply; `Related:` open items in the touched areas, items with `from` or `links` pointing here, the project's decisions |
| `wk check` | `Captured: 2` jotted during this task, for sorting at the check-in |
| `wk done` | Items whose `after:` fired; `Project complete, run close` when nothing is left |
| `wk project new` | Items waiting on `start:<area>` for each touched area, to pull into the project or leave |
| `wk project close` | Leftover tasks, learnings and decisions to distill, items fired by `end:` |

## Flows

### Capture mid-task

The user drops anything into the chat: "bug: …", "idea: …", a screenshot, "note that …".

1. **Tiny and inside the current task:** do it now and list it under `Also:` in the check-in.
2. **Knowledge:** `wk decide` or `wk learn` straight away; these need no sorting.
3. **Everything else:** `wk jot`, describing any screenshot in the text. Say nothing beyond "Noted." and carry on.

### Sorting at check-in

`wk check` lists what was captured. The check-in gains one line with a suggestion for each, and the user's "looks good" accepts both the task and the sorting:

```
Done: history is saved on every run.
Checked: 48 tests pass.
Try: run it twice, then open the history file; two entries.
Captured: banner bug → ui, next · export to CSV → someday · "API caps at 100/min" → learning.
Next: the stats command. Ready to go on?
```

### Review

`wk review` prints, 10 lines at a time: the inbox, due items, `someday` and `later` items older than 30 days, waits older than 7 days, projects with nothing queued, areas with no principles, flagged principles, likely duplicates. The agent goes through them with the user in short batches. `wk review --done` records the date.

### Project close

On the last `wk done` in a project, or `wk project close`:

1. Leftover open tasks: move to an area, keep for a follow-up project, or drop.
2. Learnings and decisions: distill any that pass the principle test into the areas they touch (`wk principle --from`).
3. `end:` triggers fire and show as due.
4. The project folder moves to `archive/<year>/`.

## The skill

wk ships as one npm package: the CLI plus the rules. `wk init` copies two skills to `.claude/skills/` and adds a one-line pointer to `AGENTS.md` (and to `CLAUDE.md` when one exists; the personal stores `local` and `home` change neither), so any agent that can run a shell follows the same rules through `wk guide`.

| Skill | Loads | Holds |
| --- | --- | --- |
| `wk` | Every session | The session loop only: brief, capture, start, check, done, handoff, talking to the user, check-ins, context. Under about 70 lines. |
| `wk-setup` | On its description, on `/wk-setup`, or when the CLI cues it | Everything one-off: init, onboarding old plans, migration, the instruction check, workflow config, the principles session |

- **Guides are the source of truth; skills are thin.** The text lives in `wk guide <topic>` (`setup`, `onboarding`, `migrate`, `triage`, `review`, `close`, `principles`) so agents without skills get the same rules. `wk-setup`'s body only says to run `wk guide setup` and follow it; its description does the triggering ("set up wk", "fit wk to my workflow", "I changed my agent instructions").
- **Side guides load at their moment**, cued by the CLI. Routine sessions never pay for one-off text.

### Setup and the user's workflow

wk should fit the workflow already in a repo, not compete with it. `wk-setup` does that once, stores the result, and rechecks only when something changes.

1. **Find instructions.** `wk setup` lists the agent instruction files it finds: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`, other skills in `.claude/skills/`, plus user-level ones the agent can see. `wk init` prints the same list as one line.
2. **Find overlaps.** The agent reads them and lists only what overlaps with wk: another plan file (a ROADMAP to keep in sync), git and commit rules, session start or end rituals, tracker steps. For each one the user picks: hand it to wk (the line becomes a pointer, with permission), keep it and set wk to match, or keep both because they don't truly overlap.
3. **Store the workflow.** The answers go into config, so no session has to reread the instruction files:

   ```yaml
   workflow:
     git: { branch: none, commit: task }
     commit_style: one short line, no body
     checks: { quick: npm test -- --changed, full: npm test }
     tracker: none            # or a name; tasks carry a free-text ref
   ```

   `wk brief` prints it as one `Workflow:` line. `checks.quick` runs at every `wk check`, `checks.full` at project close and before the last handoff of a session.
4. **Record fingerprints.** `wk setup --done` hashes each instruction file it listed. When one changes or a new one appears, `wk brief` prints `AGENTS.md changed since setup. Recheck?` and `wk-setup` looks at the changed file only.

One standing rule in the `wk` skill: where the repo's own instructions cover the same thing as wk, they win, and the clash is raised once rather than silently obeyed or ignored. wk never edits a file it didn't create without asking; it only adds its own pointer line.
- **Talking to the user is unchanged**: short, about the product, no ids or commands unless asked.
- **Plan changes run one per call**, never chained with `&&`: a refusal midway leaves the earlier ones saved and the rest not.

### Domain-agnostic

The core vocabulary has no software terms: task, project, area, principle, decision, learning, check. Software is a preset, not the default shape.

- `wk init --preset <software|general>` seeds tags and a starting area, nothing else. `software` (the default in a git repo) adds the tags `bug`, `quick`, `perf`, `ux` and a `code` area. `general` adds the tag `quick` and only `core`.
- "Every task ends with something to try" holds everywhere: a command to run, a screen to look at, a shelf to load, a booking to confirm.
- Git stays optional: outside a repo, git features are skipped quietly, as in v1.

### Improving the skill with the skill

wk's own repo is tracked with wk. Two rules keep that from leaking into the product:

1. Nothing project-specific goes into `skill/`: no names, paths or examples from wk itself or any test repo. Test: would this rule make sense, unchanged, in a repo that isn't this one?
2. wk's own principles live in its plan, not in the shipped skill. The shipped skill teaches how to capture principles, never which ones.

## Limits

| Item | Limit |
| --- | --- |
| Title | 70 characters |
| Task body | 6 lines |
| Jot, learning | 2 lines |
| Decision | what 1 line, why 2, rejected 1 |
| Principle | rule 1 line, instead 1, because 2 |
| Area description | 3 lines |
| Principles per area | 15 |
| Handoff | 5 lines |
| Summary | 8 lines |

A refusal names the item and how far over it is: `Decision title is 74 characters, limit is 70 (4 over). Shorten it.`

## Migrating a v1 plan

The mapping is mechanical, so a command does it rather than the agent: `wk migrate` converts a v1 `.work/` in place, prints a summary and cues `wk guide migrate` for the parts that need judgment. It refuses on a dirty plan folder so the result is one reviewable diff. It ships for a few releases, then goes.

| v1 | v2 |
| --- | --- |
| `project.md` | `summary.md` |
| `handoff.md` | `session.md` |
| Epic | Project; scope and acceptance kept; `touches` from its tasks' tags that match an area |
| Task in an epic | Task in that project; `next` → `queue` (rank kept), `later` → `later`, `now`/`review`/`done` kept |
| Task with no epic | Task in `core` |
| `blocked` | `wait: <reason>` |
| `needs_decision` | `wait: decision` |
| Idea | Task with `when: someday`, in its epic's project or `core` |
| Decision, learning | Same kind, in its epic's project or `core`; supersession kept |
| `principles/<tag>.md` | One area per tag; each line becomes a principle with empty `instead` and `because` |
| Archived items | `archive/<year>/` by their v2 home |
| `counters` in config | Dropped |

Every migrated item keeps its old id in `was: T-013`, and every command that takes an id also accepts a `was` id. Commit messages, branch names and handoffs that mention `T-013` still resolve.

`wk guide migrate` then walks the user through what a converter can't judge: run each principle through the principle test (most v1 rules are generic or restate the code), fill `instead` and `because` for the keepers, merge duplicates across areas, and sort the `someday` pile with a first `wk review`.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| IDs | 4 random characters, no kind prefix | Safe across branches; kind can change without renumbering |
| Ideas | A `when`, not a kind | Promotion keeps id and history |
| Principles | Items with rule, instead, because | Need a reason, a source, one home, and supersession |
| Screenshots | Described in text by default, `--file` opt-in | Text survives sessions and diffs; images go stale after the fix |
| Folders | By home, not state or kind | Few file moves; a project's history is one folder |
| Triggers | Make items due, never queue them | No surprises in the queue |
| v1 plans | One-shot `wk migrate` plus a guide for the judgment parts | The mapping is mechanical; old ids stay findable through `was` |
| Setup | A separate `wk-setup` skill wrapping `wk guide setup` | Callable any time; keeps one-off text out of the every-session skill; guides keep it agent-neutral |
| User's workflow | Stored in config once, fingerprints flag changes | Sessions follow it without rereading instruction files |
| Check commands | `checks.quick` at each check, `checks.full` at close and last handoff | Settles v1's open question on slow suites |

## Settled while building

- `start:<area>` fires when a task in or touching the area starts, and when a project touching it is created. It fires once and shows as due.
- One global ranked queue, as in v1. Projects group tasks; they don't order them.
- Commit modes are `ask`, `task` and `check`; branch modes are `none`, `task` and `project`.
- A v1-looking id with a dash (`T-013`) is always a `was` lookup; without a dash (`t13`) only when no v2 id starts that way, because `d869` is a valid v2 id.

## Open questions

- Should `bug` default to `when: next`, or is that preset config (`tags: { bug: { when: next } }`)?
- Is 7 days the right review cadence, and should it be config?
- Thresholds (10 inbox items, 30-day staleness, 15 principles per area) are guesses to revisit after use.
