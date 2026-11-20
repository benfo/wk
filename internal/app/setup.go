package app

import (
	"path"
	"path/filepath"
	"regexp"
	"strings"

	wk "github.com/benfo/wk"
)

// BuildVersion is the release this binary was built from, set at release time with
// -ldflags "-X github.com/benfo/wk/internal/app.BuildVersion=v1.2.3". The skills name the minimum they need.
var BuildVersion = "dev"

var Skills = []string{"wk", "wk-setup"}
var GuideTopics = []string{"setup", "onboarding", "migrate", "triage", "review", "close", "principles"}

var skillsDir = filepath.Join(".claude", "skills")

// AgentPointer is the line the wk-setup skill offers to add to AGENTS.md, for agents without the skill.
const AgentPointer = "Track work with the `wk` CLI. At the start of every session run `wk guide` once (skip it if the wk skill is loaded), then `wk brief`. Every change, however small, belongs to a task: the current one if it fits, else a planned one (`wk ls` to find it, then `wk start`), else a new one (`wk add`, then `wk start`). Follow the wk loop through `wk check`."

// pointerPrefix starts every version of AgentPointer, so an older pointer line never counts as drift.
const pointerPrefix = "Track work with the `wk` CLI."

var lineBreak = regexp.MustCompile(`\r?\n`)

// guide prints the agent rules (the wk skill's body), or one guide.
func guide(topic string, given bool) Result {
	if given && !contains(GuideTopics, topic) {
		fail(`No guide "` + topic + `". Topics: ` + strings.Join(GuideTopics, ", ") + ".")
	}
	file := "skills/wk/SKILL.md"
	if given {
		file = "guides/" + topic + ".md"
	}
	b, err := wk.Assets.ReadFile(file)
	if err != nil {
		fail("Guide missing from package: " + file)
	}
	_, body := parseFrontmatter(string(b))
	body = TrimStart(body)
	var t any
	if given {
		t = topic
	}
	return Result{Lines: lineBreak.Split(body, -1), Data: Obj("topic", t, "text", body), Full: true}
}

var instructionFileNames = []string{"AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md", ".cursorrules", ".windsurfrules", ".github/copilot-instructions.md"}
var cursorRule = regexp.MustCompile(`\.(md|mdc)$`)

// instructionFiles are the agent instruction files in the project, relative paths with forward
// slashes. wk's own skills are left out.
func instructionFiles(base string) []string {
	found := filter(instructionFileNames, func(f string) bool { return exists(filepath.Join(base, filepath.FromSlash(f))) })
	rules := filepath.Join(base, ".cursor", "rules")
	for _, e := range readDir(rules) {
		if cursorRule.MatchString(e.Name()) {
			found = append(found, ".cursor/rules/"+e.Name())
		}
	}
	skills := filepath.Join(base, skillsDir)
	for _, e := range readDir(skills) {
		if contains(Skills, e.Name()) {
			continue
		}
		if exists(filepath.Join(skills, e.Name(), "SKILL.md")) {
			found = append(found, path.Join(".claude/skills", e.Name(), "SKILL.md"))
		}
	}
	return found
}

// fingerprint ignores line endings and wk's own pointer line, so refreshing wk never looks like drift.
func fingerprint(base, rel string) string {
	lines := strings.Split(crlf(readFile(filepath.Join(base, filepath.FromSlash(rel)))), "\n")
	lines = filter(lines, func(l string) bool { return !strings.HasPrefix(Trim(l), pointerPrefix) })
	return sha1Hex(Trim(strings.Join(lines, "\n")))[:12]
}

// hasOwnContent is true when a file says more than wk's own pointer line.
func hasOwnContent(base, rel string) bool { return fingerprint(base, rel) != sha1Hex("")[:12] }

type driftItem struct{ file, how string }

// drift lists files that changed, appeared or disappeared since wk setup --done.
func drift(ctx *Ctx) []driftItem {
	seen := ctx.Config.Setup
	if seen == nil {
		seen = NewOMap()
	}
	now := instructionFiles(ctx.Base)
	out := []driftItem{}
	for _, f := range now {
		if !seen.Has(f) {
			out = append(out, driftItem{f, "new"})
		} else if dataStr(seen, f) != fingerprint(ctx.Base, f) {
			out = append(out, driftItem{f, "changed"})
		}
	}
	for _, f := range seen.Keys() {
		if !contains(now, f) {
			out = append(out, driftItem{f, "removed"})
		}
	}
	return out
}

func setupCmd(ctx *Ctx, _ *Store, o *Opts) Result {
	files := instructionFiles(ctx.Base)
	if o.Flag("done") {
		ctx.Config.Setup = NewOMap()
		for _, f := range files {
			ctx.Config.Setup.Set(f, fingerprint(ctx.Base, f))
		}
		writeConfig(ctx.Root, ctx.Config)
		return resultData([]string{"Recorded " + pluralMany(len(files), "instruction file", "instruction files") + ". wk brief will say when one changes."}, Obj("files", files))
	}
	changes := []driftItem{}
	if ctx.Config.Setup != nil {
		changes = drift(ctx)
	}
	mark := func(f string) string {
		for _, c := range changes {
			if c.file == f {
				return f + " (" + c.how + ")"
			}
		}
		return f
	}
	lines := []string{"Instructions: none found in the project."}
	if len(files) > 0 {
		lines = []string{"Instructions: " + strings.Join(mapList(files, mark), ", ")}
	}
	for _, c := range changes {
		if c.how == "removed" {
			lines = append(lines, "Removed since setup: "+c.file)
		}
	}
	lines = append(lines, orStr(workflowLine(ctx), "Workflow: nothing stored yet."))
	wf := ctx.Config.Workflow
	unset := []string{}
	if ctx.Git && wf.Branch == "" {
		unset = append(unset, "git.branch")
	}
	if ctx.Git && wf.Commit == "" {
		unset = append(unset, "git.commit")
	}
	if wf.Quick == "" {
		unset = append(unset, "checks.quick")
	}
	if wf.Full == "" {
		unset = append(unset, "checks.full")
	}
	if len(unset) > 0 {
		lines = append(lines, "Not set: "+strings.Join(unset, ", "))
	}
	if ctx.Config.Setup != nil {
		lines = append(lines, "Last setup recorded "+itoa(ctx.Config.Setup.Len())+" files.")
	} else {
		lines = append(lines, "Setup not recorded yet.")
	}
	lines = append(lines, "Next: read them, list the overlaps with wk (wk guide setup, step 3), store the workflow, then wk setup --done.")
	var recorded any
	if ctx.Config.Setup != nil {
		recorded = ctx.Config.Setup
	}
	return resultData(lines, Obj("files", files, "changes", mapList(changes, func(c driftItem) any { return Obj("file", c.file, "how", c.how) }),
		"workflow", workflowData(wf), "recorded", recorded))
}

// briefDrift: wk brief says when instruction files changed since setup.
func briefDrift(ctx *Ctx, s *Store) []string {
	if ctx.Config.Setup == nil {
		work := len(s.list()) > 0
		own := some(instructionFiles(ctx.Base), func(f string) bool { return hasOwnContent(ctx.Base, f) })
		if work && own {
			return []string{"Setup not recorded: fit wk to this project's instructions (wk-setup skill, wk guide setup)."}
		}
		return nil
	}
	changes := drift(ctx)
	if len(changes) == 0 {
		return nil
	}
	return []string{"Instructions changed since setup: " + strings.Join(mapList(changes, func(c driftItem) string { return c.file + " (" + c.how + ")" }), ", ") + ". Recheck (wk-setup skill)."}
}

// startChecks: wk start names the quick checks to run before checking in.
func startChecks(ctx *Ctx, _ *Store, _ *Item) []string {
	if q := ctx.Config.Workflow.Quick; q != "" {
		return []string{"", "Checks: run " + q + " before wk check."}
	}
	return nil
}
