---
id: dthk
kind: task
state: done
when: next
tags: []
rank: 0
created: 2026-11-20
updated: 2026-11-20
done_on: 2026-11-20
checked: [go vet clean; go test ./... passes, golden covers shape start]
---
# Shape tag cues grilling at start; fresh-session start rule

Test: wk add a task with --tags shape, then wk start it: two lines say to grill first and give the edit command; run it and wk show has no shape tag. In a fresh session say 'continue': the agent starts the handoff's next task.

Tasks tagged shape are not agreed yet: wk start prints a cue to grill first; grilling ends by rewriting the body, recording decisions and dropping the tag. Skill step 1: continue/go starts the handoff's next task, a request is handled as a change, anything vague gets a brief summary and a question; due items or changed instructions get one line first.
