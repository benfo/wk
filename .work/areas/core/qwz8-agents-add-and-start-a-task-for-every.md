---
id: qwz8
kind: task
state: done
when: next
tags: []
rank: 0
created: 2026-11-20
updated: 2026-11-20
done_on: 2026-11-20
checked: [go vet clean; go test ./... passes (app, golden)]
---
# Agents add and start a task for every new request, however small

Test: In a repo with the wk pointer, ask the agent for a one-line change with no task running: it should find or add a task and start it before editing. Ask for a tweak mid-task: it should fold it in, not add a task.

In another repo the agent went straight to code on a small request: the AGENTS.md pointer and the skill loop only say to start a task, not to create one for unplanned requests.
