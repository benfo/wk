package app

import (
	_ "embed"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

//go:embed web/board.css
var boardCSS string

//go:embed web/live.html
var liveScript string

const recentDays = 7

// Board is everything the board shows, sorted into the lists each view reads.
type Board struct {
	ctx          *Ctx
	store        *Store
	v            View
	all          []*Item
	tasks        []*Item
	openProjects []*Project
	now          *Item
	// heroItem: with nothing in progress, the hero shows the first queued task, which leaves the list.
	heroItem *Item
	review   []*Item
	due      []*Item
	inbox    []*Item
	queue    []*Item
	waiting  []*Item
	sleeping []*Item
	later    []*Item
	someday  []*Item
	recent   []*Item
	events   []PlanEvent
	nowMs    float64
	// needsYou counts only what asks you to act now; the inbox can wait for a sort.
	needsYou int
}

func collect(ctx *Ctx, s *Store) *Board {
	projects := s.projects()
	all := s.list()
	tasks := filter(all, func(i *Item) bool { return i.Kind == "task" })
	// Files are read in id order, which is random: every list below keeps the queue order (rank,
	// then oldest first) unless it sorts itself.
	SortStable(tasks, byAge(firstSeen(ctx)))
	b := &Board{ctx: ctx, store: s, all: all, tasks: tasks}
	b.v = View{homeNames: map[string]string{}, hues: map[string]int{}}
	for n, p := range projects {
		b.v.homeNames[p.ID] = p.Title
		b.v.hues[p.ID] = n
	}
	for _, t := range tasks {
		if state(t) == "now" {
			b.now = t
			break
		}
	}
	b.review = filter(tasks, func(t *Item) bool { return state(t) == "review" })
	b.due = filter(tasks, func(t *Item) bool { return isDue(t) && state(t) == "open" && !isQueued(t) })
	b.queue = filter(tasks, func(t *Item) bool { return isQueued(t) && !isWaiting(t) })
	resting := filter(tasks, func(t *Item) bool { return state(t) == "open" && !isQueued(t) && !isDue(t) && !isWaiting(t) })
	b.openProjects = filter(projects, func(p *Project) bool { return pstate(p) != "done" })
	if b.now == nil && len(b.queue) > 0 {
		b.heroItem = b.queue[0]
	}
	b.inbox = filter(tasks, func(t *Item) bool { return state(t) == "inbox" })
	b.waiting = filter(tasks, func(t *Item) bool { return isWaiting(t) && state(t) != "done" })
	b.sleeping = filter(resting, func(t *Item) bool { _, _, ok := triggerOf(when(t)); return ok })
	// Dated wake-ups first, soonest on top; the rest wait on other work and keep the queue order.
	SortStable(b.sleeping, func(x, y *Item) int {
		dx, dy := wakeDate(x), wakeDate(y)
		switch {
		case dx == dy:
			return 0
		case dx == "":
			return 1
		case dy == "":
			return -1
		}
		return strings.Compare(dx, dy)
	})
	b.later = filter(resting, func(t *Item) bool { return when(t) == "later" })
	b.someday = filter(resting, func(t *Item) bool { return when(t) == "someday" })
	b.recent = filter(tasks, func(t *Item) bool {
		return state(t) == "done" && daysBetween(orStr(str(t, "done_on"), str(t, "updated")), ctx.Today) <= recentDays
	})
	SortStable(b.recent, func(x, y *Item) int { return LocaleCompare(str(y, "done_on"), str(x, "done_on")) })
	b.events = readEvents(ctx, 200)
	// An event keeps the title as it was, cut for a long jot: show the item's full title while it exists.
	byID := map[string]*Item{}
	for _, i := range append(append([]*Item{}, all...), s.archived()...) {
		byID[i.ID] = i
	}
	for n, e := range b.events {
		if i := byID[e.ID]; i != nil {
			b.events[n].Title = fullTitle(i)
		}
	}
	b.nowMs, _ = parseISO(nowISO())
	b.needsYou = len(b.review) + len(b.due)
	return b
}

// wakeDate is an on:<date> trigger's date; "" for other triggers.
func wakeDate(t *Item) string {
	if kind, arg, ok := triggerOf(when(t)); ok && kind == "on" {
		return arg
	}
	return ""
}

var sentenceSplit =regexp.MustCompile(`\.\s+`)

// splitSentences is title.split(/(?<=\.)\s+/): the dot stays with the sentence before it.
func splitSentences(s string) []string {
	out := []string{}
	last := 0
	for _, m := range sentenceSplit.FindAllStringIndex(s, -1) {
		out = append(out, s[last:m[0]+1])
		last = m[1]
	}
	return append(out, s[last:])
}

// boardHTML is the plan as one HTML page with two tabs: Board (where things stand, what needs you,
// what's next, the rest of the plan) and History (done, recent changes, areas, knowledge). The tabs
// are plain HTML and CSS, so the static page needs no scripts; live mode adds remembering the tab.
// A live page follows the server's events, or with a feed, polls the feed script next to its file.
func boardHTML(ctx *Ctx, s *Store, live bool, feed *boardFeed) string {
	b := collect(ctx, s)
	title := headline(readSummary(ctx), filepath.Base(ctx.Base))
	first := ""
	if len(b.review) > 0 {
		first = "Ready for you: " + b.review[0].Title
	} else if len(b.due) > 0 {
		first = "Due: " + b.due[0].Title
	}
	count := ""
	if b.needsYou > 0 {
		count = "(" + itoa(b.needsYou) + ") "
	}
	script := ""
	if feed != nil {
		script = "<script>window.wkFeed = " + JSONStringify(Obj("src", feed.src, "stamp", feed.stamp)) + ";</script>"
	}
	if live {
		script += liveScript
	}
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>` + esc(count+title+" | wk") + `</title><style>` + boardCSS + `</style></head><body>
<div id="app" data-needs="` + itoa(b.needsYou) + `" data-first="` + esc(first) + `">
<input type="radio" name="tab" value="board" id="tab-board" class="tab-radio" checked><input type="radio" name="tab" value="history" id="tab-history" class="tab-radio">
` + boardTop(b, title, live) + `
` + boardTab(b) + `
` + historyTab(b) + `
</div>` + script + `</body></html>
`
}

// boardTop: what this is, the counts worth a glance, and the tabs.
func boardTop(b *Board, title string, live bool) string {
	parts := splitSentences(title)
	name, more := parts[0], parts[1:]
	branch := ""
	if b.ctx.Git {
		branch = currentBranch(b.ctx.Base)
	}
	status := ""
	if live {
		status = `<button id="notify" class="notify" hidden>Notify me</button><span id="live" class="live" title="Connecting">live</span>`
	}
	needs := ""
	if b.needsYou > 0 {
		verb := "need"
		if b.needsYou == 1 {
			verb = "needs"
		}
		needs = `<span class="hot"><b>` + itoa(b.needsYou) + `</b> ` + verb + ` you</span>`
	}
	tip := ""
	if len(more) > 0 {
		tip = ` title="` + esc(strings.Join(more, " ")) + `"`
	}
	br := ""
	if branch != "" {
		br = `<span class="branch" title="Current git branch">` + esc(branch) + `</span>`
	}
	return `<header class="top"><h1><span` + tip + `>` + esc(strings.TrimSuffix(name, ".")) + `</span>` + br + `</h1>
<div class="right">` + needs + status + `<nav class="tabs" aria-label="Views"><label for="tab-board" title="Press 1">Board</label><label for="tab-history" title="Press 2">History</label></nav></div></header>`
}

// boardTab is read top to bottom: where things stand now, what needs you, a few next, then the rest
// of the plan by status and by project. One row size throughout; status is an icon shape.
func boardTab(b *Board) string {
	v := b.v
	next := filter(b.queue, func(t *Item) bool { return t != b.heroItem })
	parked := append(append([]*Item{}, b.later...), b.someday...)
	rows := func(list []*Item, fn func(*Item) string) []string { return mapList(list, fn) }
	upNext := "Up next"
	if b.heroItem != nil {
		upNext = "After that"
	}
	groups := strings.Join([]string{
		group("review", "Ready to try", len(b.review), strings.Join(rows(b.review, func(t *Item) string { return reviewRow(b, t) }), ""), false),
		group("due", "Due", len(b.due), strings.Join(rows(b.due, func(t *Item) string { return row(v, t, rowOpts{right: esc(str(t, "due"))}) }), ""), false),
		group("todo", upNext, len(next), capped(rows(next, func(t *Item) string { return row(v, t, rowOpts{}) }), 5), false),
		group("waiting", "Waiting", len(b.waiting), strings.Join(rows(b.waiting, func(t *Item) string { return row(v, t, rowOpts{right: "on " + esc(str(t, "wait"))}) }), ""), false),
		group("inbox", "Inbox, to sort", len(b.inbox), strings.Join(rows(b.inbox, func(t *Item) string { return row(v, t, rowOpts{noProject: true}) }), ""), false),
		group("sleeping", "Sleeping", len(b.sleeping), capped(rows(b.sleeping, func(t *Item) string { return row(v, t, rowOpts{note: esc(wakeLabel(v, b.store, when(t)))}) }), 5), false),
		group("later", "Later", len(parked), capped(rows(parked, func(t *Item) string { return row(v, t, rowOpts{right: esc(when(t))}) }), 5), false),
	}, "")
	return `<main class="tab tab-board">` + focus(b) + groups + projectsSection(b) + `</main>`
}

// focus is the card at the top: what's in progress, or what's next when nothing is, with the
// handoff and the last change.
func focus(b *Board) string {
	t := b.now
	if t == nil {
		t = b.heroItem
	}
	handoff := readHandoff(b.ctx)
	pulse := ""
	if len(b.events) > 0 {
		last := b.events[0]
		pulse = `<div class="pulse">Last change ` + clock(last.At, b.nowMs, "", " ago") + `: ` + esc(last.Verb) + ` <span class="t2">` + esc(last.Title) + `</span></div>`
	}
	notes := pulse
	if handoff != "" {
		notes = `<p class="handoff">` + esc(handoff) + `</p>` + pulse
	}
	if t == nil {
		return `<section class="focus idle"><div class="fl">` + icon("later") + `<span class="lbl">Nothing in progress, nothing queued</span></div>` + notes + `</section>`
	}
	facts := chip(b.v, t)
	if b.now != nil {
		if started := lastEvent(b.events, t.ID, "started"); started != nil {
			facts = `<span class="t3">` + clock(started.At, b.nowMs, "started ", " ago") + `</span>` + facts
		}
		for _, p := range b.openProjects {
			if p.ID == t.Home.Name {
				_, done, total := projectTasks(b.store, p)
				facts += `<span class="t3 prog">` + ringSVG(done, total, 14, hue(b.v, p.ID)) + itoa(done) + ` of ` + itoa(total) + `</span>`
				break
			}
		}
	}
	kind, label, cls, style := BoardKind("todo"), "Nothing in progress. Next up", "idle", hue(b.v, t.Home.Name)
	if b.now != nil {
		kind, label, cls, style = "now", "In progress", "working", ""
	}
	return `<section class="focus ` + cls + `"` + style + ` data-key="` + key(t) + `">
<div class="fl">` + icon(kind) + `<span class="lbl">` + label + `</span>` + facts + `</div>
<h2 class="ft" title="id ` + t.ID + `">` + esc(fullTitle(t)) + `</h2>` + notes + `</section>`
}

// reviewRow is a task waiting for you to try it: what to try and how long it has waited.
func reviewRow(b *Board, t *Item) string {
	o := rowOpts{}
	if tests := testsOf(t); len(tests) > 0 {
		o.note = "Try: " + esc(tests[0])
	}
	if since := lastEvent(b.events, t.ID, "ready to try"); since != nil {
		o.right = clock(since.At, b.nowMs, "", "")
	}
	return row(b.v, t, o)
}

var projectKindOrder = []BoardKind{"now", "review", "due", "todo", "waiting", "inbox", "sleeping", "later"}

// projectsSection lists each open project with its progress ring; it opens to its tasks by status,
// done ones folded at the end.
func projectsSection(b *Board) string {
	rows := []string{}
	for _, p := range b.openProjects {
		own, done, total := projectTasks(b.store, p)
		open := filter(own, func(t *Item) bool { return state(t) != "done" })
		SortStable(open, func(x, y *Item) int {
			if d := indexOf(projectKindOrder, kindOf(x)) - indexOf(projectKindOrder, kindOf(y)); d != 0 {
				return d
			}
			return byQueue(x, y)
		})
		closed := filter(own, func(t *Item) bool { return state(t) == "done" })
		list := strings.Join(mapList(open, func(t *Item) string {
			right := ""
			if kindOf(t) == "later" {
				right = esc(when(t))
			}
			return row(b.v, t, rowOpts{noProject: true, right: right})
		}), "")
		doneList := ""
		if len(closed) > 0 {
			doneList = `<li><details class="more"><summary>` + itoa(len(closed)) + ` done</summary><ul>` +
				strings.Join(mapList(closed, func(t *Item) string { return row(b.v, t, rowOpts{noProject: true}) }), "") + `</ul></details></li>`
		}
		if list == "" {
			list = `<li class="empty">No open tasks.</li>`
		}
		frac := itoa(done) + "/" + itoa(total)
		rows = append(rows, `<li data-key="`+p.ID+`:`+frac+`"`+hue(b.v, p.ID)+`><details class="project" data-id="`+p.ID+`"><summary title="id `+p.ID+`">`+
			ringSVG(done, total, 16, "")+`<span class="pn">`+esc(p.Title)+`</span><span class="c">`+frac+`</span></summary><ul>`+list+doneList+`</ul></details></li>`)
	}
	if len(rows) == 0 {
		return ""
	}
	return `<section class="projects"><h3>Projects<span class="c">` + itoa(len(rows)) + `</span></h3><ul>` + strings.Join(rows, "") + `</ul></section>`
}

// historyTab: what got done, what changed, and what the plan has learned.
func historyTab(b *Board) string {
	done := mapList(b.recent, func(t *Item) string { return row(b.v, t, rowOpts{right: esc(str(t, "done_on"))}) })
	changes := mapList(head(b.events, 30), func(e PlanEvent) string {
		return `<li class="act" data-key="` + esc(e.At+e.ID+e.Verb) + `">` + clock(e.At, b.nowMs, "", " ago") + `<span class="verb">` + esc(e.Verb) + `</span><span class="what">` + esc(e.Title) + `</span></li>`
	})
	areas := areaRows(b)
	knowledgeItems := filter(b.all, func(i *Item) bool {
		return (i.Kind == "decision" || i.Kind == "learning") && str(i, "superseded_by") == ""
	})
	SortStable(knowledgeItems, func(x, y *Item) int { return LocaleCompare(str(y, "created"), str(x, "created")) })
	knowledge := mapList(head(knowledgeItems, 10), func(i *Item) string {
		return `<li class="r" data-key="` + i.ID + `" title="id ` + i.ID + `"><span class="kind">` + i.Kind + `</span><div class="body"><div class="tt">` + esc(fullTitle(i)) + `</div></div>` + chip(b.v, i) + `</li>`
	})
	body := group("done", "Done this week", len(done), capped(done, 12), false) +
		group("", "Just happened", len(changes), strings.Join(changes, ""), false) +
		group("", "Areas and principles", len(areas), strings.Join(areas, ""), false) +
		group("", "Decisions and learnings", len(knowledge), strings.Join(knowledge, ""), false)
	if body == "" {
		body = `<p class="empty">Nothing yet.</p>`
	}
	return `<main class="tab tab-history">` + body + `</main>`
}

// areaRows: each area opens to its principles, each with what it replaces and why.
func areaRows(b *Board) []string {
	return mapList(b.store.areas(), func(a string) string {
		rules := activePrinciples(b.store, a)
		open := len(filter(b.tasks, func(t *Item) bool { return t.Home.Name == a && state(t) != "done" }))
		list := strings.Join(mapList(rules, func(r *Item) string {
			ok := str(r, "instead") != "" && str(r, "because") != ""
			why, cls := "Needs instead and because", " missing"
			if ok {
				why, cls = "instead of "+esc(str(r, "instead"))+"; because "+esc(str(r, "because")), ""
			}
			return `<li><div>` + esc(r.Title) + `</div><div class="why` + cls + `">` + why + `</div></li>`
		}), "")
		word := "rules"
		if len(rules) == 1 {
			word = "rule"
		}
		ol := ""
		if list != "" {
			ol = `<ol>` + list + `</ol>`
		}
		return `<li><details class="area"><summary><span>` + esc(a) + `</span><span class="c">` + itoa(open) + ` open, ` + itoa(len(rules)) + ` ` + word + `</span></summary><div class="desc">` +
			esc(splitLines(b.store.areaDescription(a))[0]) + `</div>` + ol + `</details></li>`
	})
}

// boardPath is where the board goes: per machine, outside the plan, so a committed plan never churns.
func boardPath(ctx *Ctx) string {
	name := nonClean.ReplaceAllString(strings.ToLower(filepath.Base(ctx.Base)), "-")
	return filepath.Join(ctx.Home, "boards", name+"-"+pathKey(ctx.Root, 12)+".html")
}

// openURL opens a file or URL in the default browser; best effort.
func openURL(target string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", target)
	case "darwin":
		cmd = exec.Command("open", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	hideWindow(cmd)
	_ = cmd.Start()
}

func boardCmd(ctx *Ctx, s *Store, o *Opts) Result {
	file := boardPath(ctx)
	if out, ok := o.Str("out"); ok && out != "" {
		file = resolvePath(ctx.Cwd, out)
	}
	second := "Open it in a browser, or rerun with --open."
	if out, ok := o.Str("out"); ok && out != "" {
		// An export elsewhere is a snapshot: no script, nothing keeps it current.
		mkdirAll(filepath.Dir(file))
		writeFile(file, boardHTML(ctx, s, false, nil))
	} else {
		writeBoardFile(ctx, s, file, boardStamp(ctx))
		second = "It updates itself as the plan changes. Open it in a browser, or rerun with --open."
	}
	if o.Flag("open") {
		openURL(file)
		second = "Opened in your browser."
	}
	return resultData([]string{"Board: " + file, second}, Obj("file", file))
}
