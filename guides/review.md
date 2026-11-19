# Weekly review

`wk brief` says "Review due" once a week, or when the inbox piles up. Offer it at a natural pause, never mid-task. It takes a few minutes.

1. Run `wk review --all`. It lists the inbox, due items, long waits, stale `later` and `someday` items, projects with nothing queued or nothing left, areas without principles, principles without a reason, and likely duplicates.
2. Go through it with the user in batches of 3 to 5, each with a suggestion:
   - **Inbox:** sort each jot (`wk guide triage`).
   - **Due:** queue it, reschedule it, or drop it.
   - **Long waits:** chase it, change what it waits on, or drop it.
   - **Stale ideas:** queue, keep or drop. Keeping is fine. Dropping is better than a pile nobody reads.
   - **Project with nothing queued:** what's next for it? Add a task, or close the project if it's finished (`wk guide close`).
   - **Area without principles:** offer a principles session for that area (`wk guide principles`), once.
   - **Principle without a reason:** fill in `instead` and `because`, or supersede it if no reason exists.
   - **Duplicates:** `wk merge <keep> <drop>`.
3. Finish with `wk review --done` and one line on what changed.
