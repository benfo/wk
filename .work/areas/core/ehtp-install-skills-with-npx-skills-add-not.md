---
id: ehtp
kind: task
state: done
when: next
tags: []
rank: 0
created: 2026-11-20
updated: 2026-11-20
done_on: 2026-11-20
checked: [go vet clean; go test ./... passes, goldens regenerated]
---
# Install skills with npx skills add, not wk init

Test: Empty git repo: wk init --store repo makes only .work/, no skills or AGENTS.md. wk --version prints wk dev.

wk init only creates the plan: no skills, no AGENTS.md edit. wk-setup offers the AGENTS.md line (opt-in).
Skill: wk is a prerequisite; if missing, ask, then run install.sh/install.ps1. States minimum wk version; wk brief prints version.
README: npx skills add benfo/wk, project vs -g advice, upgrade note for old copied skills.
