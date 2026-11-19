package app

import (
	"path/filepath"
	"regexp"
	"strings"
)

const (
	SummaryFile     = "summary.md"
	SessionFile     = "session.md"
	coreDescription = "Always in scope. Its principles load for every task; items with no better home live here."
)

type presetSeed struct {
	tags  []string
	areas [][2]string
}

// presetSeeds is what a preset seeds. Nothing else differs: the core stays domain-agnostic.
var presetSeeds = map[string]presetSeed{
	"software": {tags: []string{"bug", "quick", "perf", "ux"}, areas: [][2]string{{"code", "How it's built: structure, conventions and tooling."}}},
	"general":  {tags: []string{"quick"}},
}

var storeHelp = []string{
	"Choose where to keep the plan:",
	"  wk init --store repo     .work/ in the repo, committed",
	"  wk init --store ignore   .work/ in the repo, listed in .gitignore",
	"  wk init --store local    .work/ in the repo, listed in .git/info/exclude (only you)",
	"  wk init --store home     outside the repo, in ~/.wk/projects/<slug>/",
}

var newline = regexp.MustCompile(`\r?\n`)

// addIgnores appends ignore patterns that are not there yet. Returns the ones added.
func addIgnores(file string, patterns []string) []string {
	existing := ""
	if exists(file) {
		existing = readFile(file)
	}
	have := map[string]bool{}
	for _, l := range newline.Split(existing, -1) {
		have[Trim(l)] = true
	}
	missing := filter(patterns, func(p string) bool { return !have[p] && !have[strings.TrimSuffix(p, "/")] })
	if len(missing) == 0 {
		return nil
	}
	sep := "\n"
	if existing == "" || strings.HasSuffix(existing, "\n") {
		sep = ""
	}
	mkdirAll(filepath.Dir(file))
	writeFile(file, existing+sep+strings.Join(append([]string{"# wk"}, missing...), "\n")+"\n")
	return missing
}

func writeIfMissing(file, text string) {
	if !exists(file) {
		writeFile(file, text)
	}
}

func areaText(name, description string) string { return "# " + name + "\n\n" + description + "\n" }

// ensureLayout creates whatever part of the layout is missing; never overwrites.
func ensureLayout(root, store string) {
	for _, dir := range []string{InboxDir, ProjectsDir, ArchiveDir, filepath.Join(AreasDir, CoreArea)} {
		mkdirAll(filepath.Join(root, dir))
	}
	writeIfMissing(filepath.Join(root, AreasDir, CoreArea, AreaFile), areaText(CoreArea, coreDescription))
	writeIfMissing(filepath.Join(root, SummaryFile), "")
	writeIfMissing(filepath.Join(root, SessionFile), "")
	if store == "repo" {
		for _, dir := range []string{InboxDir, ProjectsDir, ArchiveDir} {
			writeIfMissing(filepath.Join(root, dir, ".gitkeep"), "")
		}
	}
}

func isPersonal(store string) bool { return store == "local" || store == "home" }

// wireAgent sets up skills, ignores and the AGENTS.md pointer: shared by a fresh init and a rerun.
func wireAgent(base, store string, git bool) []string {
	lines := []string{"Skills: " + strings.Join(installSkills(base), ", ")}
	skillPatterns := mapList(Skills, func(s string) string { return filepath.ToSlash(skillsDir) + "/" + s + "/" })
	var patterns []string
	switch store {
	case "repo":
	case "home":
		patterns = skillPatterns
	default:
		patterns = append([]string{WorkDir + "/"}, skillPatterns...)
	}
	if len(patterns) > 0 && git {
		file := ""
		if store == "ignore" {
			file = filepath.Join(base, ".gitignore")
		} else {
			file = excludeFile(base)
		}
		var added []string
		if file != "" {
			added = addIgnores(file, patterns)
		}
		if file != "" && len(added) > 0 {
			rel, _ := filepath.Rel(base, file)
			lines = append(lines, "Ignored in "+filepath.ToSlash(rel)+": "+strings.Join(added, " "))
		}
	}
	if isPersonal(store) {
		lines = append(lines, "No AGENTS.md change (personal store). For other agents, add to your own instructions:", "  "+AgentPointer)
	} else {
		pointed := filter([]string{"AGENTS.md", "CLAUDE.md"}, func(name string) bool { return addPointer(base, name, name == "CLAUDE.md") })
		if len(pointed) > 0 {
			lines = append(lines, "Added the wk pointer to "+strings.Join(pointed, " and "))
		}
	}
	return lines
}

func initCmd(cwd string, store, preset string, hasStore, hasPreset bool, home string) Result {
	if root, base, ok := findRoot(cwd, home); ok {
		config := readConfig(root)
		if config.Version < 2 {
			fail(v1Plan)
		}
		ensureLayout(root, config.Store)
		lines := []string{"Already set up (store: " + config.Store + "): " + root}
		if hasStore && store != "" && store != config.Store {
			lines = append(lines, `Not moving it to "`+store+`". Moving a plan is not supported.`)
		}
		_, git := projectBase(base)
		lines = append(lines, wireAgent(base, config.Store, git)...)
		return resultData(lines, Obj("root", root, "store", config.Store))
	}
	if !hasStore || store == "" {
		fail(strings.Join(storeHelp, "\n"))
	}
	if !contains(Stores, store) {
		fail(strings.Join(append([]string{`Unknown store "` + store + `".`}, storeHelp...), "\n"))
	}
	base, git := projectBase(cwd)
	if (store == "ignore" || store == "local") && !git {
		fail("--store " + store + " needs a git repo. Use --store repo or --store home here.")
	}
	if hasPreset && preset != "" && !contains(Presets, preset) {
		fail(`Unknown preset "` + preset + `". Use: ` + strings.Join(Presets, ", "))
	}
	if !hasPreset || preset == "" {
		preset = "general"
		if git {
			preset = "software"
		}
	}
	root := filepath.Join(base, WorkDir)
	if store == "home" {
		root = homeRoot(base, home)
	}
	mkdirAll(root)
	config := defaultConfig(store, preset)
	config.Tags = append([]string{}, presetSeeds[preset].tags...)
	writeFile(filepath.Join(root, ConfigFile), configText(config))
	ensureLayout(root, store)
	for _, a := range presetSeeds[preset].areas {
		mkdirAll(filepath.Join(root, AreasDir, a[0]))
		writeIfMissing(filepath.Join(root, AreasDir, a[0], AreaFile), areaText(a[0], a[1]))
	}
	lines := append([]string{"Created " + root + " (preset: " + preset + ")"}, wireAgent(base, store, git)...)
	if found := sourcesLine(findSources(base, git)); found != "" {
		lines = append(lines, found)
	}
	if instr := filter(instructionFiles(base), func(f string) bool { return hasOwnContent(base, f) }); len(instr) > 0 {
		lines = append(lines, "Agent instructions: "+strings.Join(instr, ", ")+". Fit wk to them with the wk-setup skill (wk guide setup).")
	}
	lines = append(lines, "Next: wk brief, then the wk-setup skill (wk guide setup).")
	return resultData(lines, Obj("root", root, "store", store, "preset", preset))
}

// --- sources: existing plans worth migrating ---

type sources struct {
	files  []string
	todos  int // -1 outside git
	github bool
}

var planFileRe = regexp.MustCompile(`(?i)^(todo|todos|roadmap|backlog|tasks|plan|planning)(\.(md|txt|markdown))?$`)

var planDirs = [][2]string{
	{"docs/plans", "plans"},
	{"docs/roadmap", "plans"},
	{"docs/adr", "decisions"},
	{"docs/adrs", "decisions"},
	{"docs/decisions", "decisions"},
	{"adr", "decisions"},
	{"doc/adr", "decisions"},
}

func planFiles(dir, prefix string) []string {
	out := []string{}
	for _, e := range readDir(dir) {
		if e.Type().IsRegular() && planFileRe.MatchString(e.Name()) {
			out = append(out, prefix+e.Name())
		}
	}
	return out
}

// findSources looks for existing plans worth migrating: a few folder reads and one git grep.
func findSources(base string, git bool) sources {
	files := append(planFiles(base, ""), planFiles(filepath.Join(base, "docs"), "docs/")...)
	for _, d := range planDirs {
		if isDir(filepath.Join(base, filepath.FromSlash(d[0]))) {
			files = append(files, d[0]+"/ ("+d[1]+")")
		}
	}
	s := sources{files: files, todos: -1}
	if git {
		s.todos = todoCount(base)
		remote := remoteURL(base)
		s.github = remote != "" && strings.Contains(strings.ToLower(remote), "github.com")
	}
	return s
}

// sourcesLine is one line for wk init, or "" when there is nothing to migrate.
func sourcesLine(s sources) string {
	parts := append([]string{}, s.files...)
	if s.todos > 0 {
		parts = append(parts, pluralMany(s.todos, "TODO/FIXME comment", "TODO/FIXME comments"))
	}
	if s.github {
		parts = append(parts, "GitHub issues (ask first)")
	}
	if len(parts) == 0 {
		return ""
	}
	return "Existing plans: " + strings.Join(parts, ", ") + ". Offer onboarding (wk guide onboarding)."
}
