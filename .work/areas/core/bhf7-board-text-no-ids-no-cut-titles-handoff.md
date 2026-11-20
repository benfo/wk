---
id: bhf7
kind: task
state: done
when: next
tags: []
from: "36ar"
rank: 0
created: 2026-11-20
updated: 2026-11-20
done_on: 2026-11-20
checked: [go vet clean; go test ./... passes uncached, goldens regenerated]
---
# Board text: no ids, no cut titles (handoff, last change)

Test: Open the board: Last change and history show full titles; after a done with no --handoff, the handoff reads 'Done: <title>.' with no id.

Board 'Last change' line cuts long titles with an ellipsis (ready to try Flaky: … can pick a…). Show the full title, as the rows now do.
