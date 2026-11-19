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

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/benfo/wk/main/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/benfo/wk/main/install.ps1 | iex
```

Or just tell your agent: "install wk from github.com/benfo/wk". The installer puts `wk` in `~/.local/bin` (Windows: `%LOCALAPPDATA%\Programs\wk`, added to your PATH). Then, in each project:

```bash
wk init --store repo
```

`--store` picks where the plan lives: `repo` (committed), `ignore` (in `.gitignore`), `local` (private, in `.git/info/exclude`) or `home` (`~/.wk/`). Outside git, use `repo` or `home`. Init copies two skills to `.claude/skills/`: `wk` for every session and `wk-setup` for fitting wk to your workflow. Agents without skills follow `wk guide`, which a line in `AGENTS.md` points to.

Then ask your agent to set up wk; the `wk-setup` skill takes it from there.

## Upgrade

Run the install line again.

Then run `wk init` again in each project to refresh its skills. Your plan is kept. A plan from wk v1 converts once with `wk migrate`; old ids like `T-013` keep working.

## See the plan

```bash
wk board --open
```

This writes the plan as one HTML page and opens it. The **Board** tab reads top to bottom like an issue tracker: a card for the task in progress (or what's next) with the handoff, then every task grouped by status (ready to try, due, up next, waiting, inbox, sleeping, later), each marked with a status icon, then projects with progress rings that open to their tasks. The **History** tab holds what got done this week, recent changes, areas with their principles, and decisions.

For a live view, keep this running in a spare terminal and leave the tab open beside your agent:

```bash
wk board --serve --open
```

It serves the board on `http://localhost:4123/` (or the next free port) and refreshes the page within a second of any change to the plan, whoever made it. A dot in the corner shows whether it's connected. Ctrl+C stops it.

## Release

```bash
go run ./scripts/release v0.2.0
```

It runs the checks, builds a binary for each platform, tags and pushes, and creates the GitHub release with the binaries attached; the installers fetch the latest one. Add `--dry-run` to check and build without publishing.

## Develop

Needs Go 1.26 or later. `go build -o wk.exe ./cmd/wk` (or `-o wk` off Windows) builds a working copy; `go test ./...` runs the checks. `internal/golden/testdata` holds scripted sessions with their expected output and files: a change in behaviour shows up there as a diff, and `go test ./internal/golden -update` rewrites them once it's intended.
