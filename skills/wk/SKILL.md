---
name: wk
description: Track this project's work with the wk CLI - tasks in projects and areas, an inbox for thoughts that come up mid-task, decisions, learnings and principles. Use at the start and end of every session, for "what's next" or "where were we", before acting on any request to change something, to start, check or finish work, whenever the user drops a thought mid-task ("idea:", "bug:", "todo:", "note that…", a screenshot of something wrong), to record a decision or learning, or to show the plan.
---

# wk

Read and change the plan only through the `wk` CLI; never read the plan's files. Output is 10 lines or fewer: `--all` lifts the cap, `--json` gives fields. One-off moments (setup, onboarding, migration, triage, review, closing a project, principles) have guides, printed by `wk guide <topic>`; the CLI names the guide when its moment comes. The `wk-setup` skill covers setup.

Needs the wk CLI v0.1.0 or later; `wk brief` starts with it (`dev` is a local build, fine). If `wk` is missing or older, ask, then install or upgrade it: `curl -fsSL https://raw.githubusercontent.com/benfo/wk/main/install.sh | sh` on macOS and Linux, `irm https://raw.githubusercontent.com/benfo/wk/main/install.ps1 | iex` on Windows.

## Talking to the user

The user is in the zone: keep check-ins, questions and notes short. Talk about the work, not the plan: no item ids or wk commands unless asked. Say "Noted.", not "jotted as k7f2".

## Session loop

1. **Start with `wk brief`.** It prints the summary, the `Workflow:` line, the handoff, now and next, and cues: `Due:`, `Inbox:`, `Review due`, changed instructions. Raise cues at the next natural pause, never mid-task. "What's next" means `wk next`, summarised in a few lines. Then the user's first message decides: "continue" or "go" starts the handoff's next task (mention a due item or changed instructions in one line first); a request is a change (step 2); anything vague gets the brief in a few lines and "start <task>?".
2. **Every change, however small** (a one-line request, a screenshot), **belongs to a task.** One that fits the task in progress or under review is part of it (step 3). Otherwise `wk start <id>` the planned item that covers it (`wk ls <words>` to find it), or `wk add "<title>" --when next` first when none does. `wk start` prints the body, the principles that apply, anything due now and related items. Follow the principles. One task is `now` at a time. A task whose what-to-build isn't agreed carries the `shape` tag (add it when creating or sorting such a task): `wk start` then says to grill it with the user first and prints the command that drops the tag once agreed.
3. **The user drops something mid-task** (an idea, a bug, a todo, an observation, a screenshot):
   - Tiny and inside this task: do it now; list it under `Also:` at the check-in.
   - A choice made: `wk decide "<what>" --why "<why>"`. Something surprising: `wk learn "<text>"`.
   - Anything else: `wk jot "<text>"`. Describe a screenshot in words: what is wrong, where, when. Say "Noted." and carry on.
4. **New work you find yourself** is jotted too. Don't grow the current task.
5. **Work through the whole task, then stop once.** Stop early only when blocked (`wk wait <id> "<on what>"`), when a decision is the user's (fair options with different trade-offs, or hard to undo), or when the task needs new work first.
6. **End of task:** run the checks (the `Workflow:` line names them), then one call: `wk check --checked "<result>" --test "<for the user>" --handoff "<text>"`. It lists what was jotted during the task.
7. **Check in** (below). The user's "looks good" accepts the task, the sorting and the `Next:` line: `wk done <id>`; file each jot with `wk move <id> --in <home> --when <when>` (or `wk decide`/`wk learn`, then `wk drop` the jot); start the next task, or stop if you recommended a fresh session.
8. **Other stops** (the user stops, before suggesting a clear, after a compaction): `wk handoff "<text>" [--fresh]`, 5 lines or fewer: where we stopped, what's half done, what to do first.
9. **Git** follows the `Workflow:` line; never branch, commit or push beyond it. The repo's own commit rules apply. Plan changes ride along with the task's commit.

## Homes and timing

Every item lives in one home: a **project** (has an end: `wk project new "<title>" --touches <areas>`), an **area** (never ends, holds principles: `wk area new <name> "<what it covers>"`), or **core** (always in scope; anything without a better home). New work: `wk add "<title>" --in <home> [--when <when>]`.

`when` says when a task comes back: `next` (front of the queue), `queue` (default), `later`, `someday`, or a trigger: `after:<id>`, `end:<project>`, `start:<area>`, `on:<YYYY-MM-DD>`. A fired trigger makes the item due; queue, reschedule or drop it with the user. Promote an idea with `wk move <id> --when next`. Sorting advice: `wk guide triage`.

To show the plan: `wk board --open`. The page updates itself as the plan changes, with no server; leave it open beside the work.

## Checking work

- **Automated checks** (tests, types, build, lint): run the ones covering the change; record one line each in `--checked`, saying which ran so a partial run never looks full. On a failure, fix it or name the failing checks; never paste a log.
- **Things only a person can judge** (look and feel, how output reads, whether a flow makes sense): specific steps and the expected result in `--test`.
- **Nothing to try:** give a review instead: what changed, why, which files.

## Check-in

One per task, short labelled lines. `Review:` replaces `Try:` when there's nothing to try; `Also:` and `Captured:` only when there are any.

```
Done: history is saved on every run.
Checked: 48 tests pass.
Try: run it twice, then open the history file; two entries.
Captured: banner bug → ui, next · CSV export → someday · "API caps at 100/min" → learning.
Next: the stats command. Ready to go on?
```

## Context

Everything in the conversation is resent every turn; only a fresh session clears it. At each check-in decide where the next task runs. Here is the default and goes unmentioned. Recommend a fresh session when the next task is unrelated or in another home, many files or logs were read, a compaction happened, or you're repeating yourself; `wk done` and `wk start` flag this too. Say why in plain words, after a handoff. Use a subagent for read-heavy work where only the conclusion matters, never for back-and-forth with the user.

## Writing and sizing

Plain words, concrete nouns, no filler; don't restate the title in the body. The CLI refuses text over its limits and says by how much: shorten, don't split. Run commands that change the plan one per call, never chained with `&&`: a refusal midway leaves the earlier ones saved and the rest not. Every task ends with something the user can try or review; setup and wiring go inside the first task that needs them.

## Keeping the plan clean

Leave the plan a bit cleaner each time: fix a `Tidy:` line that `wk check` prints, merge duplicates (`wk merge <keep> <drop>`), drop what nobody wants (`wk drop`), tighten wordy items (`wk edit`), supersede a changed decision or principle (`wk supersede <old> <new>`; never edit a decision). Say what you removed. When a choice comes up twice or a learning reads like a rule, suggest a principle (`wk guide principles`). Where the repo's own instructions cover the same ground as wk, they win; raise the clash once.
