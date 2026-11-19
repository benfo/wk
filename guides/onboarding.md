# wk onboarding

Onboard an existing project when `wk init` lists existing plans, or `wk brief` says "Empty plan.". The user can skip it. Go one step at a time and wait for the user between steps.

1. **Survey.** Read the README, recent history, open branches and every source `wk init` listed (TODO, ROADMAP, BACKLOG, PLAN files, ADR folders, TODO/FIXME comments). Read the issue tracker only if the user says yes. Summarise in 5 lines or fewer.
2. **Propose.** Draft a summary from the README and history, ask the user to correct it, then save it with `wk summary`. Suggest areas for the ongoing concerns, and projects for work already in flight, with the tasks under each. Ideas and vague items go to `someday`. Leave out anything done, stale or vague beyond saving. Confirm one project at a time.
3. **Migrate.** Create areas (`wk area new`) and projects (`wk project new --touches`). Add tasks in one go: pipe one title per line into `wk add --from - --in <project>` (add `--when someday` for ideas). It adds all or nothing and lists every problem line, so fix those and rerun. Past choices go in with `wk decide`, and lessons with `wk learn`. Rewrite titles to fit the writing rules rather than copying them.
4. **Old files.** Never delete them silently. For each one, ask: keep it, delete it, or replace it with a one-line pointer to wk. Leave TODO comments in the code unless the user asks otherwise.
5. **Instructions and workflow.** Steps 3 and 4 of `wk guide setup`.
6. **Principles.** `wk guide principles`. An existing codebase gives it plenty to work with.
7. **Handoff.** Finish with `wk review` and a first `wk handoff`.
