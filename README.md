# wk

A small CLI plus agent skills for tracking work in plain text, for working with a coding agent. The agent drives it; you see short check-ins.

- **Capture costs nothing.** Say "idea: …", "bug: …" or "note that …" mid-task. The agent jots it into an inbox and carries on; it's sorted at the next check-in.
- **Filed work comes back.** Every task has a `when`: `next`, `queue`, `later`, `someday`, or a trigger like `after:<id>`, `end:<project>`, `start:<area>` or `on:<date>`. A fired trigger shows the item as due.
- **Projects end, areas don't.** Work lives in a project (with an end), an area (an ongoing concern, with its principles), or `core`.
- **Principles the agent would otherwise get wrong:** "do X, instead of Y, because Z", loaded when a task starts.
- **Domain-agnostic.** Software is a preset; a kitchen refit works too.

[docs/wk-guide.pdf](docs/wk-guide.pdf) explains the philosophy and usage with worked examples. [SPEC.md](SPEC.md) is the design.

Needs Node.js 20 or later.

## Install

```bash
git clone https://github.com/benfo/wk
cd wk
npm install
npm link
```

`npm install` builds the CLI and `npm link` puts it on the PATH as `wk`. Then, in each project:

```bash
wk init --store repo
```

`--store` picks where the plan lives: `repo` (committed), `ignore` (in `.gitignore`), `local` (private, in `.git/info/exclude`) or `home` (`~/.wk/`). Init copies two skills to `.claude/skills/`: `wk` for every session and `wk-setup` for fitting wk to your workflow. Agents without skills follow `wk guide`, which a line in `AGENTS.md` points to.

Then ask your agent to set up wk; the `wk-setup` skill takes it from there.

## Upgrade

```bash
git pull
npm install
```

Then run `wk init` again in each project to refresh its skills. Your plan is kept. A plan from wk v1 converts once with `wk migrate`; old ids like `T-013` keep working.

## See the plan

```bash
wk board --open
```

This writes the plan as one HTML page and opens it: the task in progress and the handoff, the queue and what wakes up later, what needs you (ready to try, due, the inbox, waits), what just happened, projects with progress, and areas with their principles.

For a live view, keep this running in a spare terminal and leave the tab open beside your agent:

```bash
wk board --serve --open
```

It serves the board on `http://localhost:4123/` (or the next free port) and refreshes the page within a second of any change to the plan, whoever made it. A dot in the corner shows whether it's connected. Ctrl+C stops it.

## Release

```bash
npm version patch
npm run release
```

`npm version` bumps the version and tags the commit. `npm run release` runs the tests, packs the tarball, pushes the commit and tag, and creates the GitHub release with the tarball attached. Add `-- --dry-run` to check and pack without publishing.

## Develop

Install as above; the linked `wk` is your working copy. Rebuild with `npm run build` after changes.
