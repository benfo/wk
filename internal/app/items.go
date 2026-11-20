package app

import (
	"math"
	"regexp"
	"sort"
	"strings"
)

// Opts holds a command's parsed options, as commander gives them.
type Opts struct {
	vals  map[string]string
	flags map[string]bool
	lists map[string][]string
	// order is the order options were given in, as commander keeps them.
	order []string
}

func newOpts() *Opts {
	return &Opts{vals: map[string]string{}, flags: map[string]bool{}, lists: map[string][]string{}}
}

// Str is a value option and whether it was given.
func (o *Opts) Str(k string) (string, bool) {
	v, ok := o.vals[k]
	return v, ok
}

func (o *Opts) Flag(k string) bool { return o.flags[k] }

func (o *Opts) List(k string) []string { return o.lists[k] }

func parseTags(raw string) []string {
	if raw == "" {
		return []string{}
	}
	out := []string{}
	for _, t := range strings.Split(raw, ",") {
		t = strings.TrimPrefix(strings.ToLower(Trim(t)), "#")
		if t != "" {
			out = append(out, t)
		}
	}
	return uniq(out)
}

// guardSimilar stops with "Similar: …" when a title is close to an open task.
func guardSimilar(title string, pool []*Item, force bool) {
	if force {
		return
	}
	hits := filter(pool, func(i *Item) bool { return isSimilar(title, i.Title) })
	if len(hits) == 0 {
		return
	}
	lines := mapList(head(hits, 3), func(h *Item) string { return "Similar: " + h.ID + " " + h.Title })
	lines = append(lines, "Update or merge the existing item, or rerun with --force.")
	fail(strings.Join(lines, "\n"))
}

func openTasks(s *Store) []*Item { return filter(s.list(), isOpen) }

// newTagNotes is a note for each tag the plan has never seen, so typos and near-duplicates surface early.
func newTagNotes(ctx *Ctx, s *Store, tags []string, self *Item) []string {
	if len(tags) == 0 {
		return nil
	}
	known := uniq(append(append([]string{}, ctx.Config.Tags...), flatTags(filter(s.list(), func(i *Item) bool { return i != self }))...))
	knownSet := map[string]bool{shapeTag: true} // wk's own tag is always known
	for _, k := range known {
		knownSet[k] = true
	}
	fresh := filter(tags, func(t string) bool { return !knownSet[t] })
	if len(fresh) == 0 || len(known) == 0 {
		return nil
	}
	return mapList(fresh, func(t string) string {
		near := filter(known, func(k string) bool { return editDistance(t, k) <= 2 })
		SortStable(near, func(a, b string) int { return editDistance(t, a) - editDistance(t, b) })
		if len(near) > 0 {
			return "New tag: " + t + ". Did you mean " + near[0] + "?"
		}
		sorted := append([]string{}, known...)
		sort.Strings(sorted)
		return "New tag: " + t + " (known: " + strings.Join(sorted, ", ") + ")."
	})
}

func flatTags(items []*Item) []string {
	out := []string{}
	for _, i := range items {
		out = append(out, tagsOf(i)...)
	}
	return out
}

// editDistance is the Levenshtein distance, over UTF-16 units like the TS version.
func editDistance(a, b string) int {
	ua, ub := []rune(a), []rune(b)
	row := make([]int, len(ub)+1)
	for i := range row {
		row[i] = i
	}
	for i := 1; i <= len(ua); i++ {
		prev := row[0]
		row[0] = i
		for j := 1; j <= len(ub); j++ {
			cur := row[j]
			cost := 1
			if ua[i-1] == ub[j-1] {
				cost = 0
			}
			row[j] = min(row[j]+1, row[j-1]+1, prev+cost)
			prev = cur
		}
	}
	return row[len(ub)]
}

func tagsList(ctx *Ctx, s *Store) Result {
	counts := NewOMap()
	for _, t := range ctx.Config.Tags {
		counts.Set(t, 0)
	}
	for _, i := range s.list() {
		for _, t := range tagsOf(i) {
			n, _ := counts.Get(t)
			c, _ := n.(int)
			counts.Set(t, c+1)
		}
	}
	keys := counts.Keys()
	cnt := func(k string) int { v, _ := counts.Get(k); return v.(int) }
	SortStable(keys, func(a, b string) int {
		if d := cnt(b) - cnt(a); d != 0 {
			return d
		}
		return LocaleCompare(a, b)
	})
	data := NewOMap()
	parts := []string{}
	for _, k := range keys {
		data.Set(k, cnt(k))
		parts = append(parts, k+" "+itoa(cnt(k)))
	}
	lines := []string{"No tags yet."}
	if len(keys) > 0 {
		lines = []string{strings.Join(parts, ", ")}
	}
	return resultData(lines, data)
}

func addTask(ctx *Ctx, s *Store, rawTitle string, o *Opts) Result {
	title := checkTitle(rawTitle, "Task title")
	bodyRaw, _ := o.Str("body")
	body := checkLines(unescapeText(bodyRaw), limitTaskBody, "Task body")
	guardSimilar(title, openTasks(s), o.Flag("force"))
	var home Home
	if in, ok := o.Str("in"); ok && in != "" {
		home = s.resolveHome(in)
	} else {
		home = s.area(CoreArea)
	}
	if home.Type == "inbox" {
		fail(`The inbox is for unsorted jots: wk jot "<text>".`)
	}
	tagsRaw, _ := o.Str("tags")
	item := s.create("task", home, title, body, Obj("state", "open", "when", "queue", "tags", parseTags(tagsRaw), "rank", float64(bottomRank(s))))
	w, hasWhen := o.Str("when")
	timed := hasWhen && w != "" && w != "queue"
	if timed {
		applyWhen(s, item, w)
		s.save(item)
	}
	notes := newTagNotes(ctx, s, parseTags(tagsRaw), item)
	data := Obj("id", item.ID, "title", title, "home", home.Name, "file", item.File)
	if len(notes) > 0 || timed {
		timing := ""
		if !isQueued(item) {
			timing = ", when " + when(item)
		}
		return resultData(append([]string{"Added " + item.ID + " " + title + " (" + home.Name + timing + ")"}, notes...), data)
	}
	return resultData([]string{"Added " + item.ID + " " + title + " (" + home.Name + ")"}, data)
}

var checklistMarker = regexp.MustCompile(`^[ \t]*(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)`)

// addMany adds one task per line, all or nothing: every problem line is listed before anything is
// written. Checklist markers ("- [ ] ", "* ", "1. ") are stripped.
func addMany(ctx *Ctx, s *Store, input string, o *Opts) Result {
	titles := []string{}
	for _, l := range strings.Split(crlf(input), "\n") {
		if t := Trim(checklistMarker.ReplaceAllString(l, "")); t != "" {
			titles = append(titles, t)
		}
	}
	if len(titles) == 0 {
		fail("No titles given.")
	}
	problems := []string{}
	pool := openTasks(s)
	for i, t := range titles {
		func() {
			defer func() {
				if r := recover(); r != nil {
					if e, ok := r.(*WkError); ok {
						problems = append(problems, "Line "+itoa(i+1)+": "+strings.Split(e.Msg, "\n")[0])
					} else {
						panic(r)
					}
				}
			}()
			checkTitle(t, "Line "+itoa(i+1))
			if !o.Flag("force") {
				guardSimilar(t, pool, false)
			}
			if first := indexOf(titles, t); first != i {
				problems = append(problems, "Line "+itoa(i+1)+" repeats line "+itoa(first+1)+".")
			}
		}()
	}
	if len(problems) > 0 {
		fail(strings.Join(append(problems, "Nothing added. Fix those lines and rerun."), "\n"))
	}
	each := newOpts()
	for k, v := range o.vals {
		if k != "body" {
			each.vals[k] = v
		}
	}
	each.flags["force"] = true
	lines := []string{}
	added := []any{}
	for _, t := range titles {
		r := addTask(ctx, s, t, each)
		d := r.Data.(*OMap)
		id, _ := d.Get("id")
		title, _ := d.Get("title")
		lines = append(lines, id.(string)+" "+title.(string))
		added = append(added, d)
	}
	return resultData(append([]string{"Added " + itoa(len(added)) + " tasks:"}, lines...), added)
}

func queuedRanks(s *Store) []float64 {
	out := []float64{}
	for _, i := range s.list() {
		if isQueued(i) {
			if r, ok := getV(i.Data, "rank").(float64); ok {
				out = append(out, r)
			}
		}
	}
	return out
}

// bottomRank is just below the last queued task, so a new task joins the bottom of the queue.
func bottomRank(s *Store) float64 {
	ranks := queuedRanks(s)
	if len(ranks) == 0 {
		return 1
	}
	m := ranks[0]
	for _, r := range ranks {
		m = math.Max(m, r)
	}
	return math.Floor(m) + 1
}

// topRank is just above the first queued task.
func topRank(s *Store) float64 {
	ranks := queuedRanks(s)
	if len(ranks) == 0 {
		return 1
	}
	m := ranks[0]
	for _, r := range ranks {
		m = math.Min(m, r)
	}
	return math.Floor(m) - 1
}

func show(_ *Ctx, s *Store, raw string) Result {
	item := s.get(raw)
	facts := filter([]string{item.Kind, str(item, "state"), str(item, "when"), item.Home.Name}, func(f string) bool { return f != "" })
	if item.Archived {
		facts = append(facts, "archived")
	}
	lines := []string{item.ID + "  " + strings.Join(facts, " · "), item.Title}
	if tags := tagsOf(item); len(tags) > 0 {
		lines = append(lines, "tags: "+strings.Join(tags, ", "))
	}
	for _, key := range []string{"instead", "because", "test", "due", "wait", "from", "distilled_into", "supersedes", "superseded_by", "files", "was", "ref"} {
		v, _ := item.Data.Get(key)
		if list, ok := v.([]string); ok {
			if len(list) > 0 {
				lines = append(lines, key+": "+strings.Join(list, ", "))
			}
		} else if str(item, key) != "" {
			lines = append(lines, key+": "+str(item, key))
		}
	}
	lines = append(lines, "created "+str(item, "created")+" · updated "+str(item, "updated"))
	if item.Body != "" {
		lines = append(append(lines, ""), splitLines(item.Body)...)
	}
	return Result{Lines: lines, Data: summary(item), Full: true}
}

func summary(i *Item) *OMap {
	d := i.Data.Clone()
	d.Set("title", i.Title)
	d.Set("body", i.Body)
	d.Set("home", i.Home.Name)
	d.Set("archived", i.Archived)
	return d
}

func summaries(items []*Item) []any {
	out := []any{}
	for _, i := range items {
		out = append(out, summary(i))
	}
	return out
}

var stateOrder = []string{"now", "review", "open", "inbox", "done"}

func kindWord(w string) (string, bool) {
	for _, k := range Kinds {
		if w == k || w == k+"s" {
			return k, true
		}
	}
	return "", false
}

// matches: one word of wk ls is true when it names the item's kind, state, when, home, tag or id.
func matches(i *Item, word string) bool {
	if k, ok := kindWord(word); ok {
		return i.Kind == k
	}
	switch word {
	case "due":
		return isDue(i)
	case "waiting":
		return isWaiting(i)
	case "queued":
		return isQueued(i)
	}
	if state(i) == word {
		return true
	}
	w := when(i)
	if w == word || strings.HasPrefix(w, word+":") {
		return true
	}
	if i.Home.Name == word || (i.Home.Type == "project" && strings.HasPrefix(i.Home.Name, word)) {
		return true
	}
	if contains(tagsOf(i), strings.TrimPrefix(word, "#")) {
		return true
	}
	return i.ID == word
}

// whenOrder: sooner first: queued, later, waiting on a trigger, someday.
func whenOrder(i *Item) int {
	switch when(i) {
	case "next", "queue":
		return 0
	case "later":
		return 1
	case "someday":
		return 3
	}
	return 2
}

func boolOrder(a, b bool) int {
	if a == b {
		return 0
	}
	if a {
		return -1
	}
	return 1
}

func lsOrder(a, b *Item) int {
	if a.Kind != b.Kind {
		return indexOf(Kinds, a.Kind) - indexOf(Kinds, b.Kind)
	}
	if d := indexOf(stateOrder, state(a)) - indexOf(stateOrder, state(b)); d != 0 {
		return d
	}
	if d := boolOrder(isQueued(a), isQueued(b)); d != 0 {
		return d
	}
	if d := boolOrder(isDue(a), isDue(b)); d != 0 {
		return d
	}
	if d := whenOrder(a) - whenOrder(b); d != 0 {
		return d
	}
	return byQueue(a, b)
}

// column is the left column: state once started, else when for tasks, else the kind.
func column(i *Item) string {
	if i.Kind != "task" {
		return i.Kind
	}
	if s := state(i); s != "open" {
		return s
	}
	return strings.Split(when(i), ":")[0]
}

func ls(_ *Ctx, s *Store, rawWords []string, archivedOnly bool) Result {
	words := []string{}
	for _, w := range rawWords {
		if w = strings.ToLower(Trim(w)); w != "" {
			words = append(words, w)
		}
	}
	pool := s.list()
	if archivedOnly {
		pool = s.archived()
	}
	var picked []*Item
	if len(words) > 0 {
		picked = filter(pool, func(i *Item) bool {
			for _, w := range words {
				if !matches(i, w) {
					return false
				}
			}
			return true
		})
	} else {
		// No words: the open tasks, the list people ask for most.
		picked = filter(pool, isOpen)
	}
	SortStable(picked, lsOrder)
	lines := mapList(picked, func(i *Item) string {
		return PadEnd(column(i), 7) + " " + itemLine(i) + " (" + i.Home.Name + ")" + tagLine(i)
	})
	if len(lines) == 0 {
		if len(words) > 0 {
			lines = []string{"Nothing matches: " + strings.Join(words, " ")}
		} else {
			lines = []string{"No open tasks."}
		}
	}
	return resultData(lines, summaries(picked))
}

// placeRank is a queue rank for a place: top, bottom, or between an anchor and its neighbour.
func placeRank(s *Store, item *Item, o *Opts) float64 {
	queue := filter(s.list(), func(t *Item) bool { return isQueued(t) && t != item })
	SortStable(queue, byQueue)
	r := func(i *Item) float64 {
		if v, ok := getV(i.Data, "rank").(float64); ok {
			return v
		}
		return 0
	}
	if o.Flag("top") {
		if len(queue) > 0 {
			return r(queue[0]) - 1
		}
		return 1
	}
	if o.Flag("bottom") {
		if len(queue) > 0 {
			return r(queue[len(queue)-1]) + 1
		}
		return 1
	}
	before, isBefore := o.Str("before")
	ref := before
	if !isBefore {
		ref, _ = o.Str("after")
	}
	anchor := s.get(ref)
	if anchor == item {
		fail("Move it relative to another task.")
	}
	if !isQueued(anchor) {
		fail(anchor.ID + " isn't in the queue, so nothing can go next to it.")
	}
	i := indexOf(queue, anchor)
	var neighbour *Item
	if isBefore {
		if i-1 >= 0 {
			neighbour = queue[i-1]
		}
	} else if i+1 < len(queue) {
		neighbour = queue[i+1]
	}
	if neighbour != nil {
		return (r(anchor) + r(neighbour)) / 2
	}
	if isBefore {
		return r(anchor) - 1
	}
	return r(anchor) + 1
}

// move sorts an inbox item, changes an item's home or timing, or reorders the queue.
func move(_ *Ctx, s *Store, raw string, o *Opts) Result {
	item := s.get(raw)
	if item.Archived {
		fail(item.ID + " is archived.")
	}
	places := 0
	for _, k := range []string{"before", "after"} {
		if _, ok := o.Str(k); ok {
			places++
		}
	}
	for _, k := range []string{"top", "bottom"} {
		if o.Flag(k) {
			places++
		}
	}
	in, _ := o.Str("in")
	w, _ := o.Str("when")
	if places > 1 {
		fail("Give one place: --before <id>, --after <id>, --top or --bottom.")
	}
	if in == "" && w == "" && places == 0 {
		fail("Say what changes: --in <home>, --when <when>, or a place (--before, --after, --top, --bottom).")
	}
	facts := []string{}
	if in != "" {
		home := s.resolveHome(in)
		if home.Type == "inbox" {
			fail("Items leave the inbox; they don't go back.")
		}
		s.moveTo(item, home)
		facts = append(facts, "in "+home.Name)
	}
	if item.Kind == "task" && state(item) == "inbox" {
		if in == "" {
			fail("Sort it into a home first: wk move " + item.ID + " --in <area or project>")
		}
		item.Data.Set("state", "open")
		if when(item) == "" {
			item.Data.Set("when", "queue")
		}
	}
	if w != "" {
		applyWhen(s, item, w)
	}
	if places > 0 {
		if !isQueued(item) {
			fail(item.ID + " isn't in the queue. Queue it with --when queue or --when next.")
		}
		item.Data.Set("rank", placeRank(s, item, o))
	} else if _, ok := getV(item.Data, "rank").(float64); isQueued(item) && !ok {
		if when(item) == "next" {
			item.Data.Set("rank", topRank(s))
		} else {
			item.Data.Set("rank", bottomRank(s))
		}
	}
	s.save(item)
	if isQueued(item) {
		queue := filter(s.list(), isQueued)
		SortStable(queue, byQueue)
		facts = append(facts, "#"+itoa(indexOf(queue, item)+1)+" of "+itoa(len(queue))+" in the queue")
	} else if when(item) != "" {
		facts = append(facts, "when "+when(item))
	}
	return resultData([]string{"Moved " + item.ID + " " + item.Title + ": " + strings.Join(facts, ", ")}, summary(item))
}

// applyWhen sets a task's when, and its queue rank to match.
func applyWhen(s *Store, item *Item, raw string) {
	if item.Kind != "task" {
		fail("Only tasks have a when.")
	}
	w := parseWhen(raw, whenResolver{
		item:    func(id string) string { return s.get(id).ID },
		project: func(id string) string { return s.project(id).ID },
		area:    func(name string) string { return s.area(name).Name },
	})
	wasQueued := isQueued(item)
	item.Data.Set("when", w)
	item.Data.Delete("due")
	if w == "next" {
		item.Data.Set("rank", topRank(s))
	} else if w == "queue" && !wasQueued {
		item.Data.Set("rank", bottomRank(s))
	} else if !isQueued(item) {
		item.Data.Delete("rank")
	}
}
