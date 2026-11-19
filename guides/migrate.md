# wk migrate

`wk migrate` has converted a v1 plan mechanically:

- epics became projects
- ideas became `someday` tasks
- blocked tasks are now `waiting`
- each principle file became an area with one principle per line

Every item keeps its old id as `was`, so `wk show T-013` still works. What a converter can't judge is yours, with the user, one step at a time.

1. **Review the diff.** The conversion is one change to the plan folder. Glance at `wk project` and `wk area` and tell the user in 3 lines what it became.
2. **Principles.** Each migrated principle has an empty `instead` and `because`. List them one area at a time. For each, ask: "Would a capable model get this wrong without being told?"
   - No (generic good practice, a fact the code already states, a list of flags, a library already in the manifest): supersede it with nothing; drop the rule and say so.
   - Yes: fill in `wk edit <id> --instead "<the default it overrides>" --because "<why>"`. If it can be a test, suggest one and add `--test` later.
   - Duplicates across areas: keep one, in the area it belongs to (core if it applies everywhere), and supersede the rest.
3. **Touches.** Each project touches the areas its tasks were tagged with. Check those make sense: `wk project show <id>`.
4. **Someday pile.** Run `wk review`. Go through old ideas in short batches: queue, keep or drop.
5. **Setup.** Run the instruction check and workflow steps of `wk guide setup`, then `wk setup --done`.
6. **Handoff.** `wk handoff` with where the migration stands.
