# Principles

Principles give the agent the project's own rules when a task starts. `wk start` prints those for `core`, the task's area, and the areas its project touches.

## The test

**A principle belongs only if a capable model, reading this project, would otherwise get it wrong.** Leave out:

- generic good practice ("write tests", "use clear names")
- facts the project already states (paths, the libraries in its manifest, a list of options)
- specs and feature lists

Those go stale and crowd out the rules that matter.

Each principle has three parts:

```
wk principle "Never print, block or exit nonzero on the startup path" \
  --instead "reporting errors the usual way" \
  --because "it runs inside every shell start; a failure breaks the terminal" \
  --in core
```

- **instead** names the default it overrides. If you can't name one, the model would do it anyway, so it isn't a principle.
- **because** lets the agent handle cases the rule doesn't cover.
- **--test** points to a check that enforces it. If a principle can be a test, make it a test.

Goals and targets ("feels instant", "fits on a phone") belong in the summary or the project, not in principles. Each area holds at most 15.

## Where they come from, best first

1. The user's corrections ("no, not emoji"). Offer to make one a principle on the spot.
2. Learnings and decisions, distilled when a project closes (`--from <id>`).
3. The same choice made twice.
4. A principles session.

## A principles session

Offer it once while `wk brief` says "No principles yet.", or once per session for an area that `wk start` says has none. Skipping is fine.

1. Read the project for patterns already in use that a newcomer would get wrong.
2. Take one area at a time and ask one question at a time, each with a recommended answer: "Here, X instead of Y, because Z. Keep?"
3. Save each kept rule with `wk principle`. Stop at a handful; more can come from use.

Change a rule with `wk supersede <old> <new>` after adding the new one; never let two contradict.
