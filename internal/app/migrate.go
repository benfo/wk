package app

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type v1Item struct {
	id       string
	kind     string // epic, task, idea, decision, learning
	data     *OMap
	body     string
	archived bool
}

var v1Dirs = []string{"epics", "tasks", "ideas", "decisions", "learnings"}
var v1Prefix = map[string]string{"E": "epic", "T": "task", "I": "idea", "D": "decision", "L": "learning"}
var v1File = regexp.MustCompile(`^([ETIDL])-(\d+)\.md$`)

func readV1(root string) []v1Item {
	out := []v1Item{}
	readDirItems := func(dir string, archived bool) {
		for _, e := range readDir(dir) {
			m := v1File.FindStringSubmatch(e.Name())
			if m == nil {
				continue
			}
			data, body := parseFrontmatter(readFile(filepath.Join(dir, e.Name())))
			out = append(out, v1Item{id: m[1] + "-" + m[2], kind: v1Prefix[m[1]], data: data, body: body, archived: archived})
		}
	}
	for _, d := range v1Dirs {
		readDirItems(filepath.Join(root, d), false)
	}
	readDirItems(filepath.Join(root, "archive"), true)
	return out
}

func firstLine(text string) (string, string) {
	lines := splitLines(Trim(text))
	title := Trim(lines[0])
	if title == "" {
		title = "(untitled)"
	}
	return title, Trim(strings.Join(lines[1:], "\n"))
}

func yearOf(d *OMap, today string) string {
	for _, k := range []string{"done_on", "updated", "created"} {
		if v := dataStr(d, k); v != "" {
			return Slice16(v, 4)
		}
	}
	return Slice16(today, 4)
}

var ruleLine = regexp.MustCompile(`^\s*\d+[.)]\s+(.+)$`)

// readRules reads the rules from a v1 principle file: one numbered line each.
func readRules(file string) []string {
	if !exists(file) {
		return nil
	}
	out := []string{}
	for _, l := range newline.Split(readFile(file), -1) {
		if m := ruleLine.FindStringSubmatch(l); m != nil {
			if r := Trim(m[1]); r != "" {
				out = append(out, r)
			}
		}
	}
	return out
}

func gitDirty(base, root string) bool {
	r := gitRun(base, []string{"status", "--porcelain", "--", root}, true)
	return r.ok && Trim(r.out) != ""
}

func gitTracked(base, root string) bool {
	r := gitRun(base, []string{"ls-files", "--", root}, true)
	return r.ok && Trim(r.out) != ""
}

var nonArea = regexp.MustCompile(`[^a-z0-9-]+`)

// migrate converts a v1 plan in place. The mapping is mechanical, so code does it; the judgment
// calls (which principles survive, the someday pile) are left to wk guide migrate.
func migrate(cwd, today, home string, pick Pick) Result {
	root, base, ok := findRoot(cwd, home)
	if !ok {
		fail("No wk plan found to migrate.")
	}
	rawV, _ := parseYAML(readFile(filepath.Join(root, ConfigFile)))
	raw, _ := rawV.(*OMap)
	if raw == nil {
		raw = NewOMap()
	}
	if v, ok := getV(raw, "version").(float64); ok && v >= 2 {
		return resultData([]string{"Already a v2 plan. Nothing to migrate."}, Obj("migrated", false))
	}
	git := repoTop(base) != ""
	isTracked := git && gitTracked(base, root)
	if isTracked && gitDirty(base, root) {
		fail("The plan folder has uncommitted changes. Commit or stash them first, so the conversion is one diff to review.")
	}

	// Read everything v1 first; nothing is touched until the whole plan has been read.
	items := readV1(root)
	v1git := sub(raw, "git")
	principlesDir := "principles"
	if s, ok := getV(raw, "principles_dir").(string); ok && s != "" {
		principlesDir = s
	}
	var pdir string
	switch {
	case strings.HasPrefix(principlesDir, "~"):
		h, _ := os.UserHomeDir()
		pdir = filepath.Join(h, principlesDir[1:])
	case filepath.IsAbs(principlesDir):
		pdir = principlesDir
	default:
		pdir = filepath.Join(root, principlesDir)
	}
	rules := NewOMap()
	for _, e := range readDir(pdir) {
		if !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		if r := readRules(filepath.Join(pdir, e.Name())); len(r) > 0 {
			rules.Set(strings.ToLower(strings.TrimSuffix(e.Name(), ".md")), r)
		}
	}
	readIf := func(name string) string {
		if p := filepath.Join(root, name); exists(p) {
			return readFile(p)
		}
		return ""
	}
	summaryText := readIf("project.md")
	handoff := readIf("handoff.md")

	// Keep a copy when git can't bring the old plan back.
	backup := ""
	if !isTracked {
		backup = root + ".v1-backup"
		must(os.RemoveAll(backup))
		copyTree(root, backup)
	}
	for _, e := range readDir(root) {
		must(os.RemoveAll(filepath.Join(root, e.Name())))
	}

	preset := "general"
	if git {
		preset = "software"
	}
	store := "repo"
	if s := dataStr(raw, "store"); s == "home" || s == "local" || s == "ignore" {
		store = s
	}
	config := defaultConfig(store, preset)
	branch := dataStr(v1git, "branch")
	if branch == "epic" {
		branch = "project"
	}
	if contains(BranchModes, branch) {
		config.Workflow.Branch = branch
	}
	switch commit := dataStr(v1git, "commit"); commit {
	case "checkpoint":
		config.Workflow.Commit = "check"
	case "ask", "task":
		config.Workflow.Commit = commit
	}
	allTags := uniq(append(append([]string{}, presetSeeds[preset].tags...), func() []string {
		out := []string{}
		for _, i := range items {
			out = append(out, listOf(i.data, "tags")...)
		}
		return out
	}()...))
	sort.Strings(allTags)
	config.Tags = allTags
	writeFile(filepath.Join(root, ConfigFile), configText(config))
	ensureLayout(root, config.Store)
	trimmedFile := func(t string) string {
		if Trim(t) == "" {
			return ""
		}
		return Trim(t) + "\n"
	}
	writeFile(filepath.Join(root, SummaryFile), trimmedFile(summaryText))
	writeFile(filepath.Join(root, SessionFile), trimmedFile(handoff))

	ctx := &Ctx{Cwd: cwd, Base: base, Root: root, Config: config, Today: today, Git: git, Home: wkHome(home), Pick: pick}
	s := NewStore(ctx)

	// Areas: one per principle file that has rules.
	areaNames := map[string]string{}
	for _, tag := range rules.Keys() {
		name := tag
		if !areaNameRe.MatchString(tag) {
			name = Slice16(strings.TrimLeft(nonArea.ReplaceAllString(tag, "-"), "-"), 30)
			if name == "" {
				name = "rules"
			}
		}
		areaNames[tag] = name
		if name != CoreArea && !contains(s.areas(), name) {
			s.createArea(name, "Migrated from v1 principles/"+tag+".md.")
		}
	}
	for _, tag := range rules.Keys() {
		list, _ := rules.Get(tag)
		for _, rule := range list.([]string) {
			item := s.create("principle", s.area(areaNames[tag]), rule, "", NewOMap())
			item.Data.Set("instead", "")
			item.Data.Set("because", "")
			s.persist(item)
		}
	}

	// Projects: one per epic.
	projectOf := map[string]*Project{}
	idMap := NewOMap()
	epics := filter(items, func(i v1Item) bool { return i.kind == "epic" })
	for _, e := range epics {
		tasks := filter(items, func(i v1Item) bool { return dataStr(i.data, "epic") == e.id })
		touches := []string{}
		for _, t := range tasks {
			for _, tag := range listOf(t.data, "tags") {
				if a, ok := areaNames[tag]; ok {
					touches = append(touches, a)
				}
			}
		}
		touches = filter(uniq(touches), func(a string) bool { return a != CoreArea })
		pstateV := "open"
		if dataStr(e.data, "status") == "done" {
			pstateV = "done"
		}
		data := Obj("state", pstateV, "touches", touches, "was", e.id)
		if ref := dataStr(e.data, "ref"); ref != "" {
			data.Set("ref", ref)
		}
		p := s.createProject(orStr(dataStr(e.data, "title"), e.id), e.body, data)
		for _, k := range []string{"created", "updated", "done_on"} {
			if v := dataStr(e.data, k); v != "" {
				p.Data.Set(k, v)
			}
		}
		s.persistProject(p)
		projectOf[e.id] = p
		idMap.Set(e.id, p.ID)
	}
	homeOf := func(i v1Item) Home {
		if p, ok := projectOf[dataStr(i.data, "epic")]; ok {
			return s.projectHome(p)
		}
		return s.area(CoreArea)
	}

	// Queue order: v1 ranks, else id order.
	v1rank := func(i v1Item) float64 {
		if r, ok := getV(i.data, "rank").(float64); ok {
			return r
		}
		n, _ := strconv.ParseFloat(strings.Split(i.id, "-")[1], 64)
		return n
	}
	queued := filter(items, func(i v1Item) bool { return i.kind == "task" && dataStr(i.data, "status") == "next" })
	SortStable(queued, func(a, b v1Item) int {
		d := v1rank(a) - v1rank(b)
		if d < 0 {
			return -1
		}
		if d > 0 {
			return 1
		}
		return 0
	})

	type made struct {
		v1   v1Item
		item *Item
	}
	created := []made{}
	for _, i := range filter(items, func(x v1Item) bool { return x.kind != "epic" }) {
		d := i.data
		kind := i.kind
		if kind == "idea" {
			kind = "task"
		}
		var title, body string
		if i.kind == "task" || i.kind == "decision" {
			title, body = orStr(dataStr(d, "title"), i.id), i.body
		} else {
			title, body = firstLine(i.body)
		}
		data := Obj("was", i.id)
		if i.kind == "task" {
			status := dataStr(d, "status")
			st := "open"
			if status == "now" || status == "review" || status == "done" {
				st = status
			}
			data.Set("state", st)
			w := "queue"
			if status == "later" {
				w = "later"
			}
			data.Set("when", w)
			if status == "next" {
				for n, q := range queued {
					if q.id == i.id {
						data.Set("rank", float64(n+1))
					}
				}
			}
			if getV(d, "blocked") == true {
				data.Set("wait", orStr(dataStr(d, "blocked_reason"), "unblock"))
			} else if getV(d, "needs_decision") == true {
				data.Set("wait", "decision")
			}
			if dataStr(data, "wait") != "" {
				data.Set("wait_since", orStr(dataStr(d, "updated"), today))
			}
			if c, ok := getV(d, "checked").([]string); ok {
				data.Set("checked", c)
			}
		} else if i.kind == "idea" {
			data.Set("state", "open")
			data.Set("when", "someday")
		}
		if tags := listOf(d, "tags"); len(tags) > 0 {
			data.Set("tags", tags)
		}
		if ref := dataStr(d, "ref"); ref != "" {
			data.Set("ref", ref)
		}
		item := s.create(kind, homeOf(i), title, body, data)
		for _, k := range []string{"created", "updated", "done_on"} {
			if v := dataStr(d, k); v != "" {
				item.Data.Set(k, v)
			}
		}
		s.persist(item)
		created = append(created, made{i, item})
		idMap.Set(i.id, item.ID)
	}
	// Supersession between decisions, now by new ids.
	for _, c := range created {
		if c.v1.kind != "decision" {
			continue
		}
		for _, k := range []string{"superseded_by", "supersedes"} {
			if old := dataStr(c.v1.data, k); old != "" {
				if nid, ok := idMap.Get(old); ok {
					c.item.Data.Set(k, nid)
				}
			}
		}
		s.persist(c.item)
	}

	// Archive: finished epics move whole; archived loose items move on their own.
	archived := 0
	for _, c := range created {
		if c.v1.archived && c.item.Home.Type == "area" {
			s.archive(c.item, yearOf(c.v1.data, today))
			archived++
		}
	}
	for _, e := range epics {
		if dataStr(e.data, "status") == "done" || e.archived {
			s.archiveProject(projectOf[e.id], yearOf(e.data, today))
			archived++
		}
	}

	count := func(k string) string { return itoa(len(filter(items, func(i v1Item) bool { return i.kind == k }))) }
	ruleCount := 0
	for _, k := range rules.Keys() {
		v, _ := rules.Get(k)
		ruleCount += len(v.([]string))
	}
	backupLine := "The v1 plan is in git history."
	if backup != "" {
		backupLine = "Backup of the v1 plan: " + backup
	}
	lines := []string{
		"Migrated to v2: " + count("epic") + " epics → projects, " + count("task") + " tasks, " + count("idea") + " ideas → someday tasks, " + count("decision") + " decisions, " + count("learning") + " learnings.",
		itoa(ruleCount) + " principles in " + itoa(rules.Len()) + " areas, each still needing instead and because.",
		itoa(archived) + " archived. Old ids still work: wk show T-013.",
		backupLine,
		"Next: npx skills add benfo/wk (updates the skills), then follow wk guide migrate with the user.",
	}
	return resultData(lines, Obj("migrated", true, "map", idMap, "backup", nullable(backup)))
}

func copyTree(src, dst string) {
	mkdirAll(dst)
	for _, e := range readDir(src) {
		s, d := filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())
		if e.IsDir() {
			copyTree(s, d)
		} else {
			copyFile(s, d)
		}
	}
}
