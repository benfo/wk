---
name: wk-setup
description: Set up or re-fit wk to this project and the user's workflow - first-time setup, bringing in existing plans (TODO, ROADMAP, issues), converting a v1 wk plan, checking the repo's agent instructions (AGENTS.md, CLAUDE.md, other skills, rules files) against wk, storing the git and check workflow, and capturing principles. Use when the user says "set up wk", "fit wk to my workflow", "I changed my agent instructions", when wk says there is no plan, an empty plan, a v1 plan, or instructions changed since setup.
---

# wk setup

The steps live in the wk CLI so every agent gets the same ones. Run `wk guide setup` and follow it, one step at a time, waiting for the user between steps.

- No plan yet, or an empty one: `wk guide setup` from the top.
- Existing plans to bring in (TODO files, a roadmap, issues): `wk guide onboarding`.
- wk says "This is a v1 plan": run `wk migrate`, then `wk guide migrate`.
- `wk brief` says instructions changed since setup: `wk setup`, then the instruction check in `wk guide setup` for the changed files only.
- No principles yet, or an area without any: `wk guide principles`.

Never edit the user's own instruction files without asking. wk only ever adds its one pointer line.
