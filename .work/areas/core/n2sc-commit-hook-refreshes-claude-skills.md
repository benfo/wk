---
id: n2sc
kind: task
state: done
when: next
rank: 0
created: 2026-11-20
updated: 2026-11-20
done_on: 2026-11-20
checked: [go vet clean; app tests pass; --stage dry run staged the copy]
---
# Commit hook refreshes .claude/skills after the commit, so every…

Test: Next commit that edits skills/: git status after it is clean, no .claude/skills change left over.

Commit hook refreshes .claude/skills after the commit, so every skill change leaves a dirty file to amend in
