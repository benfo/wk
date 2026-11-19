---
id: q9pk
kind: task
state: done
when: queue
tags: [skill]
created: 2026-11-19
updated: 2026-11-19
done_on: 2026-11-19
was: T-019
checked: [types pass; 65 v2 tests pass]
---
# Store workflow in config, print it in brief, flag instruction drift

Test: wk2 init in a repo; wk2 setup lists AGENTS.md; edit it; wk2 brief flags it

workflow: git, commit_style, checks quick/full, tracker. wk setup --done hashes files.
Try: edit AGENTS.md after setup; wk brief says it changed and offers a recheck.
