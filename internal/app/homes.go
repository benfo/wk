package app

import (
	"path/filepath"
	"strings"
)

const projectTemplate = "## Goal\n\n## Acceptance"

// checkTouches checks that every touched area exists.
func checkTouches(s *Store, raw string) []string {
	touches := parseTags(raw)
	for _, t := range touches {
		if !contains(s.areas(), t) {
			fail(`No area "` + t + `". Create it first: wk area new ` + t + ` "<description>"`)
		}
	}
	return touches
}

func projectNew(ctx *Ctx, s *Store, rawTitle string, o *Opts) Result {
	title := checkTitle(rawTitle, "Project title")
	if some(s.projects(), func(p *Project) bool {
		return strings.ToLower(p.Title) == strings.ToLower(title) && pstate(p) != "done"
	}) {
		fail(`A project called "` + title + `" is already open.`)
	}
	touchesRaw, _ := o.Str("touches")
	touches := checkTouches(s, touchesRaw)
	body := projectTemplate
	if b, ok := o.Str("body"); ok {
		body = unescapeText(b)
	}
	p := s.createProject(title, body, Obj("state", "open", "touches", touches))
	head := "Project " + p.ID + " " + title
	if len(touches) > 0 {
		head += " (touches " + strings.Join(touches, ", ") + ")"
	}
	lines := []string{head, `Add tasks with: wk add "<title>" --in ` + p.ID}
	fired := fire(ctx, s, func(k, arg string) bool { return k == "start" && contains(touches, arg) })
	lines = append(lines, dueLines(fired, "work starts in its areas; pull them in with wk move <id> --in "+p.ID)...)
	return resultData(lines, Obj("id", p.ID, "title", title, "touches", touches, "dir", p.Dir))
}

func projectTasks(s *Store, p *Project) (tasks []*Item, done, total int) {
	tasks = filter(s.list(), func(i *Item) bool { return i.Kind == "task" && i.Home.Name == p.ID })
	for _, t := range tasks {
		if state(t) == "done" {
			done++
		}
	}
	return tasks, done, len(tasks)
}

// projectList is every open project with progress, then each area's open count: the whole plan at a glance.
func projectList(_ *Ctx, s *Store) Result {
	open := filter(s.projects(), func(p *Project) bool { return pstate(p) != "done" })
	width := 0
	for _, p := range open {
		width = max(width, Len16(p.ID+" "+p.Title))
	}
	lines := []string{}
	data := []any{}
	for _, p := range open {
		tasks, done, total := projectTasks(s, p)
		lines = append(lines, PadEnd(p.ID+" "+p.Title, width)+"  "+progressBar(done, total)+"  "+itoa(done)+"/"+itoa(total))
		active := filter(tasks, func(t *Item) bool { return state(t) == "now" || state(t) == "review" || isQueued(t) })
		SortStable(active, byQueue)
		for _, t := range head(active, 3) {
			st := state(t)
			if st == "open" {
				st = "next"
			}
			lines = append(lines, "  "+PadEnd(st, 6)+" "+itemLine(t))
		}
		data = append(data, Obj("id", p.ID, "title", p.Title, "done", done, "total", total))
	}
	counts := mapList(s.areas(), func(a string) string {
		return a + " " + itoa(len(filter(s.list(), func(i *Item) bool { return isOpen(i) && i.Home.Name == a })))
	})
	inbox := len(filter(s.list(), func(i *Item) bool { return i.Home.Type == "inbox" }))
	areaLine := "areas   " + strings.Join(counts, " · ")
	if inbox > 0 {
		areaLine += " · inbox " + itoa(inbox)
	}
	lines = append(lines, areaLine)
	if len(open) == 0 {
		lines = append([]string{`No open projects. Start one: wk project new "<title>" --touches <areas>`}, lines...)
	}
	return resultData(lines, Obj("projects", data))
}

func projectShow(_ *Ctx, s *Store, raw string) Result {
	p := s.project(raw)
	tasks, done, total := projectTasks(s, p)
	touches := touchesOf(p)
	closed := ""
	if pstate(p) == "done" {
		closed = " (closed)"
	}
	lines := []string{p.ID + " " + p.Title + "  " + progressBar(done, total) + "  " + itoa(done) + "/" + itoa(total) + closed}
	if len(touches) > 0 {
		lines = append(lines, "touches: "+strings.Join(touches, ", "))
	}
	if p.Body != "" {
		lines = append(append(append(lines, ""), splitLines(p.Body)...), "")
	}
	sorted := append([]*Item{}, tasks...)
	SortStable(sorted, func(a, b *Item) int { return indexOf(stateOrder, state(a)) - indexOf(stateOrder, state(b)) })
	for _, t := range sorted {
		lines = append(lines, "  "+PadEnd(state(t), 6)+" "+itemLine(t))
	}
	for _, k := range filter(s.list(), func(i *Item) bool { return i.Kind != "task" && i.Home.Name == p.ID }) {
		lines = append(lines, "  "+PadEnd(k.Kind, 6)+" "+k.ID+" "+k.Title)
	}
	data := p.Data.Clone()
	data.Set("title", p.Title)
	data.Set("body", p.Body)
	data.Set("done", done)
	data.Set("total", total)
	return Result{Lines: lines, Data: data, Full: true}
}

// projectClose closes a project: leftovers must find another home first; learnings and decisions
// are offered for distilling into principles; end: triggers fire; the folder moves to the archive.
func projectClose(ctx *Ctx, s *Store, raw string) Result {
	p := s.project(raw)
	if pstate(p) == "done" {
		return resultData([]string{p.Title + " is already closed."}, Obj("id", p.ID))
	}
	tasks, done, total := projectTasks(s, p)
	open := filter(tasks, func(t *Item) bool { return state(t) != "done" })
	if len(open) > 0 {
		msg := []string{"Still open in " + p.Title + ":"}
		for _, t := range head(open, 5) {
			msg = append(msg, "  "+itemLine(t))
		}
		if len(open) > 5 {
			msg = append(msg, "  +"+itoa(len(open)-5)+" more")
		}
		msg = append(msg, "Move each to an area or another project (wk move <id> --in <home>), or drop it, then close again.")
		fail(strings.Join(msg, "\n"))
	}
	knowledge := filter(s.list(), func(i *Item) bool {
		return (i.Kind == "learning" || i.Kind == "decision") && i.Home.Name == p.ID && str(i, "distilled_into") == ""
	})
	p.Data.Set("state", "done")
	p.Data.Set("done_on", ctx.Today)
	s.saveProject(p)
	fired := fire(ctx, s, func(k, arg string) bool { return k == "end" && arg == p.ID })
	s.archiveProject(p, Slice16(ctx.Today, 4))
	lines := []string{"Closed " + p.ID + " " + p.Title + " (" + itoa(done) + "/" + itoa(total) + " done), archived."}
	if len(knowledge) > 0 {
		lines = append(lines, "Distill: any of these a capable model would get wrong next time? Make them principles (wk principle --from <id>):")
		for _, k := range head(knowledge, 6) {
			lines = append(lines, "  "+k.Kind+" "+k.ID+" "+k.Title)
		}
	}
	lines = append(lines, dueLines(fired, p.Title+" ended")...)
	ids := func(list []*Item) []string { return mapList(list, func(i *Item) string { return i.ID }) }
	return resultData(lines, Obj("id", p.ID, "done", done, "total", total, "distill", ids(knowledge), "due", ids(fired)))
}

// doneProject: wk done says when a project has nothing left.
func doneProject(_ *Ctx, s *Store, item *Item) []string {
	if item.Home.Type != "project" {
		return nil
	}
	var p *Project
	for _, x := range s.projects() {
		if x.ID == item.Home.Name {
			p = x
		}
	}
	if p == nil {
		return nil
	}
	tasks, _, _ := projectTasks(s, p)
	if some(tasks, func(t *Item) bool { return state(t) != "done" }) {
		return nil
	}
	return []string{"Nothing left in " + p.Title + ": close it with wk project close " + p.ID + " (wk guide close)."}
}

func areaNew(_ *Ctx, s *Store, name string, rawDescription string) Result {
	description := checkLines(unescapeText(rawDescription), limitAreaDescription, "Area description")
	if description == "" {
		fail("Describe the area in a line: wk area new " + name + ` "<what it covers>"`)
	}
	home := s.createArea(strings.ToLower(Trim(name)), description)
	return resultData([]string{"Area " + home.Name + ": " + splitLines(description)[0]}, Obj("name", home.Name, "description", description))
}

func areaList(_ *Ctx, s *Store) Result {
	lines := mapList(s.areas(), func(a string) string {
		items := filter(s.list(), func(i *Item) bool { return i.Home.Name == a })
		open := len(filter(items, isOpen))
		rules := len(filter(items, func(i *Item) bool { return i.Kind == "principle" && !truthy(getV(i.Data, "superseded_by")) }))
		desc := splitLines(s.areaDescription(a))[0]
		return PadEnd(a, 10) + " " + plural(open, "open task") + ", " + plural(rules, "principle") + "  " + desc
	})
	data := mapList(s.areas(), func(a string) any { return Obj("name", a, "description", s.areaDescription(a)) })
	return resultData(lines, data)
}

// truthy is JS truthiness for a frontmatter value.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case float64:
		return x != 0
	case bool:
		return x
	}
	return true
}

func readSummary(ctx *Ctx) string {
	file := filepath.Join(ctx.Root, SummaryFile)
	if !exists(file) {
		return ""
	}
	return Trim(crlf(readFile(file)))
}

func summaryCmd(ctx *Ctx, _ *Store, raw string, given bool) Result {
	if !given {
		text := readSummary(ctx)
		if text == "" {
			return resultData([]string{`No summary yet. Write one: wk summary "What: …\nWho: …\nGoal: …\nOut of scope: …\nDone when: …"`}, Obj("summary", nil))
		}
		return Result{Lines: splitLines(text), Data: Obj("summary", text), Full: true}
	}
	text := checkLines(unescapeText(raw), limitSummary, "Summary")
	if text == "" {
		fail("Summary is empty.")
	}
	writeFile(filepath.Join(ctx.Root, SummaryFile), text+"\n")
	return resultData([]string{"Summary saved (" + plural(len(splitLines(text)), "line") + ")."}, Obj("summary", text))
}
