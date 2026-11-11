# wk

A small CLI plus an agent skill for tracking software work in plain text: epics, tasks, ideas, decisions and learnings. The agent drives it; you see short check-ins. See [SPEC.md](SPEC.md) for the design.

Needs Node.js 20 or later.

## Install

Pick a version from [Releases](https://github.com/benfo/wk/releases) and install its tarball:

```bash
npm i -g https://github.com/benfo/wk/releases/download/v0.1.0/wk-0.1.0.tgz
```

Then, in each project:

```bash
wk init
```

The first run asks where to keep the plan. It also copies the skill to `.claude/skills/wk/`.

## Upgrade

Install the newer tarball the same way, then run `wk init` again in each project to refresh its skill. Your plan is kept.

## Release

```bash
npm version patch
```

```bash
npm run release
```

`npm version` bumps the version and tags the commit. `npm run release` runs the tests, packs the tarball, pushes the commit and tag, and creates the GitHub release with the tarball attached. Add `-- --dry-run` to check and pack without publishing.

## Develop

```bash
npm install
```

```bash
npm link
```

`npm link` puts your working copy on the PATH as `wk`. Rebuild with `npm run build` after changes.
