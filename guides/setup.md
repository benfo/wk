# wk setup

One step at a time. Ask one question at a time, each with a recommended answer, and wait for the user.

## 1. The plan

If `wk` says there is no plan, ask where to keep it, then run `wk init --store <choice>`:

- `repo`: committed with the project, so the team and future sessions share it.
- `ignore`: in the folder, listed in `.gitignore`.
- `local`: in the folder, private to you (`.git/info/exclude`).
- `home`: outside the folder, in `~/.wk/`.

Recommend `repo` for a project you own, `local` or `home` for someone else's. Outside git, `repo` and `home` work. `wk init` also takes `--preset software|general`. It picks `software` inside a git repo, and only seeds tags and a starting area; it changes nothing else. If `wk init` lists existing plans, offer onboarding (`wk guide onboarding`). If it says the plan is v1, run `wk migrate`, then follow `wk guide migrate`.

For a `repo` or `ignore` plan, offer one line in AGENTS.md so a teammate's agent without the wk skill still follows the plan. Add it only on a yes:

    Track work with the `wk` CLI. At the start of every session run `wk guide` once (skip it if the wk skill is loaded), then `wk brief`.

## 2. The summary

If `wk brief` says "No summary yet.": what the project is, who it's for, the goal, what's out of scope, what done means. Save it with `wk summary "<text>"`, 8 lines or fewer, one `Label: …` per line, `\n` between lines.

## 3. The user's instructions

wk should fit the workflow already here, not compete with it. Run `wk setup`. It lists the agent instruction files it found (AGENTS.md, CLAUDE.md, GEMINI.md, rules files, other skills) and the stored workflow. Also consider the user-level instructions you can see.

Read them and list only what overlaps with wk, in a few lines:

- another plan file to keep in sync (a ROADMAP, a TODO list, a wrap-up step that edits one)
- git and commit rules
- rituals at the start or end of a session
- tracker steps (tickets, issue links)

For each one, offer three choices:

1. Hand it to wk: replace the line with a pointer to wk. Only with permission.
2. Keep it and set wk to match.
3. Keep both, because they don't really overlap.

Recommend one choice per item. Never edit a file the user wrote without asking.

## 4. The workflow

Save the answers so no session has to reread those files:

- `wk config set git.branch none|task|project`: recommend `none` early on, or `project` when work is reviewed per project.
- `wk config set git.commit ask|task|check`: recommend `task`, a commit after each finished task.
- `wk config set commit_style "<one line>"`: only if the user has a rule, e.g. "one short line, no body".
- `wk config set checks.quick "<command>"`: fast checks run at every `wk check`, e.g. the tests for changed files.
- `wk config set checks.full "<command>"`: the whole suite, run when a project closes and before the last handoff of a session.
- `wk config set tracker "<name>"`: only if tasks carry ticket refs (`wk edit <id> --ref …`).

Don't promise a workflow in chat; the next session won't remember it. Then run `wk setup --done`. It records a fingerprint of each instruction file, so `wk brief` can say when one changes.

## 5. The first project

New work starts with a short grilling session, one question at a time. Create the project with its areas (`wk area new <name> "<what it covers>"` first, if needed): `wk project new "<title>" --touches <areas> --body "## Goal\n…\n\n## Acceptance\n…"`. Then add its first tasks: `wk add "<title>" --in <project>`. Each task must end with something the user can try.

## 6. Principles

While `wk brief` says "No principles yet.", offer a principles session (`wk guide principles`). Skipping is fine.

## Changed instructions

When `wk brief` says an instruction file changed since setup, run `wk setup` and do step 3 for the changed files only. Then run `wk setup --done`.
