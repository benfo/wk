---
id: "36ar"
kind: task
state: done
when: next
rank: 0
created: 2026-11-20
updated: 2026-11-20
done_on: 2026-11-20
checked: [go vet clean (also linux, darwin); go test ./... passes, port tests run 20x in a row, all pass]
---
# Flaky: TestLiveBoardMovesToTheNextFreePort can pick a…

Test: Nothing to try: a test and port-retry fix. Review live.go portUnavailable.

Flaky: TestLiveBoardMovesToTheNextFreePort can pick a Windows-reserved port (bind forbidden)
