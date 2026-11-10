---
name: wk
description: Track this project's work with the wk CLI (epics, tasks, ideas, decisions, learnings, principles). Use at the start and end of every session, when the user asks "what's next", "where were we", or to plan, start, checkpoint or finish work, capture an idea, record a decision or learning, or check principles before coding.
---

# wk

Read and change the plan only through the `wk` CLI. If `wk` says there is no plan yet, ask the user where to keep it, then run `wk init --store <choice>`. The choices: `repo` commits it, `ignore` lists it in `.gitignore`, `local` keeps it private in `.git/info/exclude`, and `home` keeps it outside the repo. Output is 10 lines or fewer. Add `--all` if a line says "more lines", or `--json` if you need fields.

## Session loop

1. **Start every session with `wk brief`.** Do not read `.work/` or `~/.wk/` files directly. Use `wk show <id>` when you need an item's body.
2. **"What's next"** means run `wk next` and summarise it in a few lines.
3. **New work starts with a grilling session**, one question at a time with a recommended answer. The outcome becomes `wk add epic "<title>"` plus the first known tasks (`wk add task "<title>" --epic E-00N --tags <tags>`). Write the scope, out of scope and acceptance into the epic with `wk edit E-00N --body "..."`.
4. **Before coding a task**, run `wk principles --tags <the task's tags>` and follow what it returns. If it reports a gap, see "Capturing principles".
5. **Off-topic idea from the user:** `wk idea "<text>"`, say "captured as I-008", and carry on.
6. **A choice gets made:** `wk decide "<what>" --why "<why>" [--rejected "<what we didn't pick>"]`. **Something surprising:** `wk learn "<text>"`.
7. **New work found mid-task:** `wk add task`. Don't silently grow the current task. If `wk add` prints `Similar: …`, update the existing item (`wk edit`) or merge (`wk merge <keep> <drop>`) instead. Use `--force` only when it really is different.
8. **After each logical piece of work, stop and check it.** See "Checking work". Then `wk checkpoint --checked "<result>" --test "<for the user>"` (each repeatable). Say what changed. **Wait for the user** before `wk done <id>`.
9. **Hand off at every stop.** After every `wk checkpoint` and every `wk done`, run `wk handoff "<text>"`: 5 lines or fewer, covering where we stopped, what's half done and what to do first next time. Use `\n` between lines. It overwrites the last one, so it costs little, and it means the user can clear context at any moment. Always hand off when the user says they're stopping, before you suggest clearing, right after a compaction and before switching epics. If `wk brief` says the handoff is older than the latest task change, the last session skipped one, so check `wk next` before trusting it.
10. **At every stop, say whether to continue.** See "Context". One line, with the reason.

Use `wk start <id>` to pick up a task (only one can be `now`). Use `wk block <id> "<reason>"` / `wk unblock <id>` when stuck. Use `wk status` for the whole plan.

## Checking work

There are two kinds of check. Keep them apart.

- **Automated checks you run yourself:** unit tests, type checks, builds, lint. The user never has to run these. Run the ones that cover the change, then record the result in one line: `--checked "75 tests pass"` or `--checked "types check, build works"`. On a failure, fix it or report the failing names. Never paste a log. Say which checks ran, for example "related tests pass, full suite not run", so a partial run never looks like a full one.
- **Human tests for the user:** anything a person interacts with. How a UI looks and feels, keyboard and focus behaviour, how CLI output reads in a real terminal, wording, whether a flow makes sense. Make each one specific: what to do and what to expect. These go in `--test`.
- **Not sure which?** Ask the user: "Is this worth your eyes, or are the tests enough?"
- **Nothing for a human?** Say so, report the checks, and ask for a quick go-ahead to `wk done`.

## Context

Everything in the conversation is sent back to the model on every turn. Old file reads, logs and finished tasks cost tokens and blur attention, and you can't forget them selectively. Only a fresh session clears them. Be honest with the user about this. At every checkpoint and `wk done`, recommend one of these:

| Recommend | When |
| --- | --- |
| Continue here | The next task builds on what's loaded now: same files, same epic, a half-found bug, a decision just made |
| Fresh session | The task is done and the next one is unrelated, the work moves to another epic, many files or long logs have been read, a compaction happened, or you notice you're repeating yourself or re-reading things |
| Subagent | Read-heavy work where only the conclusion matters: surveying a codebase, wide searches, reviewing a diff, running a long command and summarising it |

Don't use a subagent for work that needs back-and-forth with the user, for tightly connected edits, or for a lookup of a few tool calls. A subagent starts empty and re-reads what it needs, so small jobs cost more that way. Before recommending a fresh session, write the handoff. The test of a good handoff: a fresh session that runs only `wk brief` knows what to do first.

## Onboarding an existing project

Offer this when `wk init` prints "Existing plans: …" or `wk brief` prints "Empty plan.". The user can skip it. Go one step at a time and wait for the user between steps.

1. **Survey.** Read the README, `git log --oneline -30`, open branches, and every file `wk init` listed. List TODO/FIXME comments with `git grep -n -E "TODO|FIXME"`. Read GitHub issues (`gh issue list`) only if the user says yes. Summarise what you found in 5 lines or fewer.
2. **Propose.** Suggest epics for the work already in flight, the tasks under each, and a `later` pile for the rest. Leave out anything done, stale or vague. Ask the user to confirm or trim, one epic at a time.
3. **Migrate.** Create each confirmed epic with `wk add epic`. Then add its tasks in one go: pipe one title per line into `wk add task --from - --epic E-00N --tags <tags>` (add `--later` for the later pile). It adds all or nothing and lists every problem line, so fix those and rerun. Migrate ADRs and past choices with `wk decide`, and open questions with `wk idea`. Rewrite titles to fit the writing rules rather than copying them.
4. **Old files.** Never delete them silently. Ask whether to keep each one, delete it, or replace it with a one-line pointer to wk. Leave TODO comments in the code unless the user asks otherwise.
5. **Principles.** Run the principles session below. An existing codebase gives it plenty to work with.
6. **Handoff.** Finish with `wk tidy` and a first `wk handoff`.

## Writing rules

Plain words, concrete nouns, no filler. Don't restate the title in the body. One task is one thing a person can test. The CLI refuses text over its limits: titles 70 characters, task body 6 lines, ideas and learnings 2 lines, decision why 2 lines, handoff 5 lines. If it refuses, shorten the text. Don't split it to get around the limit.

## Capturing principles

- **At setup.** While `wk brief` prints "No principles yet.", offer a principles session. Read the codebase for patterns already in use, then grill the user one area at a time, one question at a time, each with a recommended answer. Rules are one line each, numbered (`1. …`), checkable in a code review, 15 per file at most. Write them to the file `wk principles --tags <tag>` names. This is the only time you write a `.work/` file directly.
- **Before a task.** If `wk principles --tags ui` finds no UI rules, ask: "No UI principles yet. Capture a few now, or carry on?" Skipping is fine. Don't ask again for that tag in the same session.
- **While working.** When the same kind of decision comes up twice, or a learning reads like a rule, suggest promoting it: "This looks like a principle. Add to arch.md?" (`wk promote` arrives in phase two. Until then, add the agreed line to the principle file.)

## Keeping the plan clean

Leave the plan a bit cleaner every time you touch it. After `wk checkpoint` and before the handoff, run `wk tidy`. Fix small things that touch the current epic: merge a duplicate (`wk merge`), tighten a wordy task (`wk edit`), close a task the work made pointless (`wk done <id> --force`, and say so), supersede a decision you just changed (`wk decide` then `wk supersede <old> <new>`; never edit a decision). `wk tidy --fix` archives old done items and closes finished epics. Ask the user about anything bigger in one line. Never delete without saying so.

## Tracker

wk never syncs with Jira or any other tracker. When a ticket needs updating, remind the user to do it by hand.
