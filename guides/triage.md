# Sorting jots

Jots are sorted at the check-in, when the user is out of the zone. Suggest a home and a `when` for each, in one `Captured:` line. The user's "looks good" accepts them all; they may change one in a word ("banner bug: now").

## Home

- Belongs to the work of an open project: that project.
- An ongoing concern (screens, the API, docs, the garden, the budget): its area. Create one only for a concern that will keep collecting items.
- Anything else: `core`.

## When

| The user means | when |
| --- | --- |
| "do it right after this" | `next` |
| part of this project, in order | `queue` |
| committed, not soon | `later` |
| an idea, not committed | `someday` |
| only makes sense once X is done | `after:<id>` |
| once this project is finished | `end:<project>` |
| next time anyone works on that area | `start:<area>` |
| on or after a date | `on:<YYYY-MM-DD>` |

A bug the user is hitting now goes `next`. Polish for this project goes `queue`, or `end:<project>` if it shouldn't hold up the project. If unsure, suggest `someday`; review brings it back.

## Not a task

- A choice already made: `wk decide`, then `wk drop` the jot.
- A fact or surprise: `wk learn`, then `wk drop` the jot.
- A rule the agent should always follow: suggest a principle (`wk guide principles`).

Then file each one: `wk move <id> --in <home> --when <when>`.
