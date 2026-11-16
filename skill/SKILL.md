---
name: wk
description: Track this project's work with the wk CLI (epics, tasks, ideas, decisions, learnings, principles). Use at the start and end of every session, when the user asks "what's next", "where were we", or to plan, start, checkpoint or finish work, capture an idea, record a decision or learning, or check principles before coding.
---

# wk

Read and change the plan only through the `wk` CLI; never read `.work/` or `~/.wk/` files directly. Output is 10 lines or fewer: add `--all` when a line says "more lines", `--json` for fields. Side guides, read only when their moment comes: `wk guide setup` (no plan, no project summary, no principles, git workflow not chosen, a new epic to scope) and `wk guide onboarding` (an existing project's old plans).

## Talking to the user

The user is in the zone: keep check-ins, questions and notes short. Talk about the product, not the plan: no item IDs or wk commands unless asked. Say "Saved that idea for later", not "captured as I-008".

## Session loop

1. **Start with `wk brief`.** "What's next" means `wk brief` (or `wk next`), summarised in a few lines. `wk show <id>` gives an item's body.
2. **Before coding a task:** `wk start <id>`. It prints the task's body and the principles for its tags; follow them. One task is `now` at a time.
3. **Ideas the user raises:** `wk idea "<text>"`, say "Saved that idea for later", carry on. Flag in one line anything outside the project summary. When it says too many ideas are saved, offer a review at the next check-in.
4. **A choice gets made:** `wk decide "<what>" --why "<why>" [--rejected "<other>"]`. **Something surprising:** `wk learn "<text>"`.
5. **New work found mid-task:** `wk add task "<title>" --epic E-00N --tags <tags>`, at the bottom of the queue; don't grow the current task. If it prints `Similar: …`, `wk edit` or `wk merge <keep> <drop>` instead; `--force` only when it truly differs.
6. **Work through the whole task, then stop once.** Stop early only when blocked, when a decision is the user's (fair options with different trade-offs, or hard to undo), or when the task needs new work (add it as a task first). `wk block <id> "<reason>"` when stuck.
7. **End of task:** run the checks, then one call: `wk checkpoint --checked "<result>" --test "<for the user>" --handoff "<text>"` (`--checked` and `--test` repeat). Add `--fresh` when you'll recommend a fresh session. Fix any small `Tidy:` problem it prints that touches this epic. Then send the check-in.
8. **The user's "looks good"** also accepts your `Next:` line: `wk done <id>`, then start the next task, or stop if you recommended a fresh session. `wk done` archives old done items and writes a handoff from the next task, keeping a `--fresh` from the checkpoint; pass `--handoff "<text>"` when there's more to say (half-done work, a pending question).
9. **Other stops** (the user stops, before suggesting a clear, after a compaction, before switching epics): `wk handoff "<text>" [--fresh]`. A handoff is 5 lines or fewer, `\n` between lines: where we stopped, what's half done, what to do first.
10. **Git** follows the `Git:` line in `wk brief`; never branch, commit or push beyond it. `wk start` branches when configured; checkpoint and done print a `Git:` line when it's time to commit. The user's commit-style rules still apply. Plan changes never get their own commit: they ride along with the task's commit, or go in one commit at the end of a planning burst.

## Checking work

- **Automated checks you run yourself** (tests, types, build, lint): run the ones covering the change; record one line, e.g. `--checked "75 tests pass"`, saying which ran so a partial run never looks full. On a failure, fix it or name the failing tests; never paste a log.
- **Human tests** (look and feel, keyboard and focus, how output reads, whether a flow makes sense): specific steps and the expected result, in `--test`.
- **Plumbing with nothing to try:** give a review instead: what changed, why, which files to look at.

## Check-in

One per task, four short labelled lines (`Review:` replaces `Try:` for plumbing):

```
Done: ideas can be deleted, or folded into the task they became.
Checked: tests, types and build pass.
Try: delete an old idea; it's gone from the later list.
Next: clean up stale tasks. Ready to go on?
```

Handoff, tidy and git run without comment unless something needs the user.

## Context

Everything in the conversation is resent every turn, and only a fresh session clears it. At each check-in decide where the next task runs. Here is the default and goes unmentioned. Recommend a fresh session when the next task is unrelated or in another epic, many files or logs were read, a compaction happened, or you're repeating yourself. `wk done` (from the third task) and `wk start` (epic switch) flag this too; follow them unless you can name what the next task needs from this session. Say why in plain words, after the handoff:

```
Next: the shell hook. It's new code, and this chat is full of the last task, so a fresh session will be faster and cheaper. Where we are is saved.
```

Use a subagent for read-heavy work where only the conclusion matters (surveys, wide searches, diff reviews, long commands), never for back-and-forth with the user or small lookups.

## Writing and sizing

Plain words, concrete nouns, no filler; don't restate the title in the body. Limits: titles 70 characters, task body 6 lines, ideas and learnings 2 lines, decision why 2 lines, handoff 5 lines, project summary 8 lines. If refused, shorten; don't split.

Every task ends with something the user can try (a command, a screen, an endpoint). Setup, wiring and refactors go inside the first task that needs them; a task with nothing to try gets folded into the next one with `wk merge`, said in one line. Plumbing (CI, a dependency bump) may stand alone if it ends with something to review.

## Keeping the plan clean

Leave the plan a bit cleaner each time: merge duplicates (an idea into the task it became, too), `wk drop <idea>` an unwanted idea, tighten a wordy task with `wk edit`, `wk done <id> --force` a task the work made pointless, and supersede a changed decision (`wk decide`, then `wk supersede <old> <new>`; never edit one). `wk tidy` lists problems; `wk tidy --fix` also closes finished epics. Say what you deleted or closed; ask in one line about anything bigger. If `wk start` finds no principles for a tag, ask once per session whether to capture a few (see `wk guide setup`). When the same decision comes up twice, suggest promoting it to a principle.
