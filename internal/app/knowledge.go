package app

import (
	"strings"
)

// currentHome is where knowledge lands by default: the now task's home, else core.
func currentHome(s *Store) Home {
	for _, i := range s.list() {
		if i.Kind == "task" && state(i) == "now" {
			if i.Home.Type != "inbox" {
				return i.Home
			}
			break
		}
	}
	return s.area(CoreArea)
}

func homeFor(s *Store, raw string) Home {
	var home Home
	if raw != "" {
		home = s.resolveHome(raw)
	} else {
		home = currentHome(s)
	}
	if home.Type == "inbox" {
		fail("The inbox is for unsorted jots.")
	}
	return home
}

// noteParts splits up to two lines of text into a title line and a body line.
func noteParts(raw, what string) (string, string) {
	text := checkLines(unescapeText(raw), limitNote, what)
	if text == "" {
		fail(what + " is empty.")
	}
	lines := splitLines(text)
	return checkTitle(lines[0], what+"'s first line"), strings.Join(lines[1:], "\n")
}

func decide(_ *Ctx, s *Store, rawWhat string, o *Opts) Result {
	title := checkTitle(rawWhat, "Decision title")
	whyRaw, _ := o.Str("why")
	if Trim(whyRaw) == "" {
		fail(`A decision needs a reason: --why "<why>"`)
	}
	why := checkLines(unescapeText(whyRaw), limitDecisionWhy, "Why")
	rejRaw, _ := o.Str("rejected")
	rejected := checkLines(unescapeText(rejRaw), limitDecisionRejected, "Rejected")
	body := "Why: " + strings.ReplaceAll(why, "\n", "\n  ")
	if rejected != "" {
		body += "\nRejected: " + rejected
	}
	in, _ := o.Str("in")
	home := homeFor(s, in)
	item := s.create("decision", home, title, body, NewOMap())
	return resultData([]string{"Decision " + item.ID + " " + title + " (" + home.Name + ")"}, summary(item))
}

func learn(_ *Ctx, s *Store, raw string, o *Opts) Result {
	title, body := noteParts(raw, "Learning")
	in, _ := o.Str("in")
	home := homeFor(s, in)
	item := s.create("learning", home, title, body, NewOMap())
	return resultData([]string{"Learning " + item.ID + " " + title + " (" + home.Name + ")"}, summary(item))
}

func activePrinciples(s *Store, area string) []*Item {
	return filter(s.list(), func(i *Item) bool {
		return i.Kind == "principle" && i.Home.Name == area && str(i, "superseded_by") == ""
	})
}

// principle earns its place only when a capable model would otherwise get it wrong, so it names
// the default it overrides (instead) and the reason (because).
func principle(_ *Ctx, s *Store, rawRule string, o *Opts) Result {
	title := checkTitle(rawRule, "Principle")
	insteadRaw, _ := o.Str("instead")
	becauseRaw, _ := o.Str("because")
	instead := checkLines(unescapeText(insteadRaw), 1, "Instead")
	because := checkLines(unescapeText(becauseRaw), limitPrincipleBecause, "Because")
	if instead == "" {
		fail(`Name the default it overrides: --instead "<what a model would do otherwise>". If there is none, it isn't a principle.`)
	}
	if because == "" {
		fail(`Say why: --because "<reason>"`)
	}
	var home Home
	if in, _ := o.Str("in"); in != "" {
		home = s.resolveHome(in)
	} else {
		home = s.area(CoreArea)
	}
	if home.Type != "area" {
		fail("Principles live in areas (core for everything).")
	}
	active := activePrinciples(s, home.Name)
	if len(active) >= limitPrinciplesPerArea {
		fail(home.Name + " has " + itoa(len(active)) + " principles, the limit. Supersede or drop one first.")
	}
	for _, p := range active {
		if isSimilar(title, p.Title) {
			fail("Similar: " + p.ID + " " + p.Title + "\nEdit or supersede it instead.")
		}
	}
	var source *Item
	if from, _ := o.Str("from"); from != "" {
		source = s.get(from)
	}
	if source != nil && source.Kind != "learning" && source.Kind != "decision" {
		fail("--from takes a learning or decision; " + source.ID + " is a " + source.Kind + ".")
	}
	data := Obj("instead", instead, "because", because)
	if test, _ := o.Str("test"); test != "" {
		data.Set("test", Trim(test))
	}
	if source != nil {
		data.Set("from", source.ID)
	}
	item := s.create("principle", home, title, "", data)
	if source != nil {
		source.Data.Set("distilled_into", item.ID)
		s.save(source)
	}
	return resultData([]string{"Principle " + item.ID + " " + title + " (" + home.Name + ")"}, summary(item))
}

func supersede(_ *Ctx, s *Store, rawOld, rawNew string) Result {
	old := s.get(rawOld)
	repl := s.get(rawNew)
	if old.Kind != "decision" && old.Kind != "principle" {
		fail("Only decisions and principles are superseded.")
	}
	if old.Kind != repl.Kind {
		fail(old.ID + " is a " + old.Kind + "; " + repl.ID + " is a " + repl.Kind + ".")
	}
	if old.ID == repl.ID {
		fail("An item can't supersede itself.")
	}
	if str(old, "superseded_by") != "" {
		fail(old.ID + " is already superseded by " + str(old, "superseded_by") + ".")
	}
	if str(repl, "superseded_by") != "" {
		fail(repl.ID + " is itself superseded.")
	}
	old.Data.Set("superseded_by", repl.ID)
	repl.Data.Set("supersedes", old.ID)
	s.save(old)
	s.save(repl)
	return resultData([]string{old.ID + " superseded by " + repl.ID + " " + repl.Title}, Obj("old", old.ID, "new", repl.ID))
}

var editKeys = []string{"title", "body", "tags", "instead", "because", "ref"}

func edit(_ *Ctx, s *Store, raw string, o *Opts) Result {
	item := s.get(raw)
	if item.Kind == "decision" {
		fail("Decisions are never edited. Record a new one and run: wk supersede <old> <new>")
	}
	if item.Archived {
		fail(item.ID + " is archived.")
	}
	changes := filter(o.order, func(k string) bool { return contains(editKeys, k) })
	if len(changes) == 0 {
		fail("Nothing to change. Use --title, --body, --tags, --instead, --because or --ref.")
	}
	if t, ok := o.Str("title"); ok {
		item.Title = checkTitle(t, strings.ToUpper(item.Kind[:1])+item.Kind[1:]+" title")
	}
	if b, ok := o.Str("body"); ok {
		max := limitTaskBody
		if item.Kind == "learning" {
			max = limitNote - 1
		}
		item.Body = checkLines(unescapeText(b), max, item.Kind+" body")
	}
	if t, ok := o.Str("tags"); ok {
		item.Data.Set("tags", parseTags(t))
	}
	instead, hasInstead := o.Str("instead")
	because, hasBecause := o.Str("because")
	if hasInstead || hasBecause {
		if item.Kind != "principle" {
			fail("Only principles have --instead and --because.")
		}
		if hasInstead {
			item.Data.Set("instead", checkLines(unescapeText(instead), 1, "Instead"))
		}
		if hasBecause {
			item.Data.Set("because", checkLines(unescapeText(because), limitPrincipleBecause, "Because"))
		}
	}
	if ref, ok := o.Str("ref"); ok {
		item.Data.Set("ref", nullable(Trim(ref)))
	}
	s.save(item)
	return resultData([]string{"Updated " + item.ID + " " + item.Title}, Obj("id", item.ID, "changed", changes, "file", item.File))
}

func drop(_ *Ctx, s *Store, raw string) Result {
	item := s.get(raw)
	if item.Archived {
		fail(item.ID + " is archived.")
	}
	if item.Kind == "decision" || item.Kind == "principle" {
		fail(item.Kind + "s are superseded, not dropped: wk supersede <old> <new>")
	}
	if state(item) == "now" {
		fail(item.ID + " is now. Check or wait it first.")
	}
	if state(item) == "done" {
		fail(item.ID + " is already done.")
	}
	s.remove(item)
	return resultData([]string{"Dropped " + item.ID + " " + item.Title}, Obj("deleted", item.ID))
}

func shorter(a, b string) string {
	if Trim(a) == "" {
		return b
	}
	if Trim(b) == "" {
		return a
	}
	if Len16(b) < Len16(a) {
		return b
	}
	return a
}

// merge folds one item into another of the same kind and deletes the duplicate.
func merge(_ *Ctx, s *Store, rawKeep, rawDrop string) Result {
	keep := s.get(rawKeep)
	gone := s.get(rawDrop)
	if keep.ID == gone.ID {
		fail("Can't merge an item into itself.")
	}
	if keep.Kind != gone.Kind {
		fail(keep.ID + " is a " + keep.Kind + "; " + gone.ID + " is a " + gone.Kind + ". Merge items of one kind.")
	}
	if keep.Kind == "decision" || keep.Kind == "principle" {
		fail(keep.Kind + "s are superseded, not merged.")
	}
	if keep.Archived || gone.Archived {
		fail("Can't merge archived items.")
	}
	if state(gone) == "now" {
		fail(gone.ID + " is now. Keep it instead: wk merge " + gone.ID + " " + keep.ID)
	}
	keep.Title = shorter(keep.Title, gone.Title)
	keep.Body = shorter(keep.Body, gone.Body)
	keep.Data.Set("tags", uniq(append(append([]string{}, tagsOf(keep)...), tagsOf(gone)...)))
	// A someday idea merged into a queued task leaves the task's timing alone; the reverse queues it.
	if keep.Kind == "task" && !isQueued(keep) && isQueued(gone) {
		applyWhen(s, keep, "queue")
	}
	s.save(keep)
	s.remove(gone)
	return resultData([]string{"Merged " + gone.ID + " into " + keep.ID + " " + keep.Title, "Deleted " + gone.ID}, Obj("kept", keep.ID, "deleted", gone.ID))
}
