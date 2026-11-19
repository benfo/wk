# Closing a project

`wk done` says "Nothing left in <project>" after its last task. Offer to close it at the check-in.

1. **Full checks.** If the `Workflow:` line names full checks, run them first.
2. **Leftovers.** `wk project close <id>` refuses while tasks are open and lists them. For each, ask: move it to an area (`wk move <id> --in <area>`), keep it for a follow-up project, or drop it.
3. **Close.** Run `wk project close <id>`. It archives the project folder and fires `end:` triggers. Tell the user what came due.
4. **Distill.** It lists the project's learnings and decisions. Go through them with the user and ask of each: would a capable model get this wrong next time? If yes, make it a principle in the area it belongs to: `wk principle "<rule>" --instead "<default>" --because "<why>" --in <area> --from <id>`. Most won't qualify, and that's fine. A principle should change behaviour, not record history.
5. **Handoff.** `wk handoff`, and say in one line what the project delivered.
