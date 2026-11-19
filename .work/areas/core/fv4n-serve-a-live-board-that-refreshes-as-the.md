---
id: fv4n
kind: task
state: done
when: queue
tags: []
rank: 1
created: 2026-11-19
updated: 2026-11-19
done_on: 2026-11-19
checked: [typecheck passes; all 70 tests pass, ran wk board --serve as a process and fetched it]
---
# Serve a live board that refreshes as the plan changes

Test: wk board --serve --open; run wk jot in another terminal; the tab updates

wk board --serve: local server, watches the plan folder, pushes a reload.
Try: open it, run wk jot in a terminal; the board updates within a second.
