---
id: "5fk3"
kind: task
state: done
when: next
tags: []
rank: 0
created: 2026-11-20
updated: 2026-11-20
done_on: 2026-11-20
checked: [go vet + go test ./... pass (golden uncached), headless Edge swaps a stale page from the feed]
---
# Static board reloads itself when the plan changes, no port

Test: wk board --open, then wk jot in a terminal; row appears within ~2s
