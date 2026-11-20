# wk

A small CLI plus agent skills for tracking work in plain text, for working with a coding agent. The agent drives it; you see short check-ins.

- **Capture costs nothing.** Say "idea: …", "bug: …" or "note that …" mid-task. The agent jots it into an inbox and carries on; it's sorted at the next check-in.
- **Filed work comes back.** Every task has a `when`: `next`, `queue`, `later`, `someday`, or a trigger like `after:<id>`, `end:<project>`, `start:<area>` or `on:<date>`. A fired trigger shows the item as due.
- **Projects end, areas don't.** Work lives in a project (with an end), an area (an ongoing concern, with its principles), or `core`.
- **Principles the agent would otherwise get wrong:** "do X, instead of Y, because Z", loaded when a task starts.
- **Domain-agnostic.** Software is a preset; a kitchen refit works too.

[docs/wk-guide.pdf](docs/wk-guide.pdf) explains the philosophy and usage with worked examples. [SPEC.md](SPEC.md) is the design.

One file, no runtime: wk is a single binary for Windows, macOS and Linux.

## Install

Add the skills, like any other agent skill:

```sh
npx skills add benfo/wk
```

Then tell your agent "set up wk". If the `wk` CLI isn't installed, the agent asks, then installs it; the `wk-setup` skill takes it from there.

Install the skills in the project (the default) when the plan is committed, so anyone who clones it gets them. Add `-g` to install them once for yourself, which suits a plan only you use. You get two skills: `wk` for every session and `wk-setup` for fitting wk to your workflow.

To install the CLI yourself, it goes in `~/.local/bin` (Windows: `%LOCALAPPDATA%\Programs\wk`, added to your PATH):

```sh
curl -fsSL https://raw.githubusercontent.com/benfo/wk/main/install.sh | sh   # macOS, Linux
irm https://raw.githubusercontent.com/benfo/wk/main/install.ps1 | iex       # Windows PowerShell
```

`wk init --store <store>` creates the plan: `repo` (committed), `ignore` (in `.gitignore`), `local` (private, in `.git/info/exclude`) or `home` (`~/.wk/`). Outside git, use `repo` or `home`. Setup offers a line in `AGENTS.md` so agents without the skill follow `wk guide`.

## Upgrade

`npx skills update` for the skills; run the CLI install line again for `wk`. Your plan is kept.

Upgrading from a wk whose `wk init` copied the skills: run `npx skills add benfo/wk` once in each project. A plan from wk v1 converts once with `wk migrate`; old ids like `T-013` keep working.

## See the plan

```bash
wk board --open
```

This writes the plan as one HTML page and opens it. The **Board** tab reads top to bottom like an issue tracker: a card for the task in progress (or what's next) with the handoff, then every task grouped by status (ready to try, due, up next, waiting, inbox, sleeping, later), each marked with a status icon, then projects with progress rings that open to their tasks. The **History** tab holds what got done this week, recent changes, areas with their principles, and decisions.

Leave the tab open beside your agent: it follows the plan with no server or port. Every wk command that changes the plan rewrites the page and a small feed script next to it, and the page checks the feed every two seconds and swaps in what changed. A dot in the corner shows whether it can read the feed. Edits made outside wk (a `git pull`, a hand edit) show up after the next wk command.

For instant updates on any change, whoever made it, serve it instead:

```bash
wk board --serve --open
```

It serves the board on `http://localhost:4123/` (or the next free port) and refreshes the page within a second of any change to the plan. Ctrl+C stops it.

## Release

```bash
go run ./scripts/release v0.2.0
```

It runs the checks, builds a binary for each platform, tags and pushes, and creates the GitHub release with the binaries attached; the installers fetch the latest one. Add `--dry-run` to check and build without publishing.

## Develop

Needs Go 1.26 or later. `go build -o wk.exe ./cmd/wk` (or `-o wk` off Windows) builds a working copy; `go test ./...` runs the checks. `internal/golden/testdata` holds scripted sessions with their expected output and files: a change in behaviour shows up there as a diff, and `go test ./internal/golden -update` rewrites them once it's intended.

To use your working copy as the `wk` on your PATH, run `go run ./scripts/devinstall`: it builds into the installer's location and copies `skills/` into `.claude/skills`. `git config core.hooksPath .githooks` runs it after every commit, merge, checkout and rebase.
