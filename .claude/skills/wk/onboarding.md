# wk onboarding

Onboard an existing project when `wk init` prints "Existing plans: …" or `wk brief` prints "Empty plan.". The user can skip it. Go one step at a time and wait for the user between steps.

1. **Survey.** Read the README, `git log --oneline -30`, open branches, and every file `wk init` listed. List TODO/FIXME comments with `git grep -n -E "TODO|FIXME"`. Read GitHub issues (`gh issue list`) only if the user says yes. Summarise what you found in 5 lines or fewer.
2. **Propose.** Draft a project summary from the README and history, ask the user to correct it, then save it with `wk project`. Then suggest epics for the work already in flight, the tasks under each, and a `later` pile for the rest. Leave out anything done, stale or vague. Ask the user to confirm or trim, one epic at a time.
3. **Migrate.** Create each confirmed epic with `wk add epic`. Then add its tasks in one go: pipe one title per line into `wk add task --from - --epic E-00N --tags <tags>` (add `--later` for the later pile). It adds all or nothing and lists every problem line, so fix those and rerun. Migrate ADRs and past choices with `wk decide`, and open questions with `wk idea`. Rewrite titles to fit the writing rules rather than copying them.
4. **Old files.** Never delete them silently. Ask whether to keep each one, delete it, or replace it with a one-line pointer to wk. Leave TODO comments in the code unless the user asks otherwise.
5. **Principles.** Run the principles session in `wk guide setup`. An existing codebase gives it plenty to work with.
6. **Handoff.** Finish with `wk tidy` and a first `wk handoff`.
