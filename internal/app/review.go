package app

import (
	"sort"
	"strings"
)

const (
	reviewEveryDays = 7
	staleDays       = 30
	staleWaitDays   = 7
	inboxNudge      = 10
)

// duplicates are pairs of open tasks with near-identical titles.
func duplicates(s *Store) [][2]*Item {
	open := filter(s.list(), isOpen)
	out := [][2]*Item{}
	for i := 0; i < len(open); i++ {
		for j := i + 1; j < len(open); j++ {
			if isSimilar(open[i].Title, open[j].Title) {
				out = append(out, [2]*Item{open[i], open[j]})
			}
		}
	}
	return out
}

func orStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// reviewLines is everything a weekly review goes through, one line each, most urgent first.
func reviewLines(ctx *Ctx, s *Store) []string {
	out := []string{}
	if inbox := inboxItems(s); len(inbox) > 0 {
		shown := strings.Join(mapList(head(inbox, 3), func(i *Item) string { return i.ID + " " + i.Title }), "; ")
		out = append(out, "Inbox: "+plural(len(inbox), "jot")+" to sort: "+shown)
	}
	for _, i := range filter(s.list(), func(t *Item) bool { return isDue(t) && state(t) == "open" && !isQueued(t) }) {
		out = append(out, "Due: "+i.ID+" "+i.Title+" ("+when(i)+")")
	}
	for _, i := range filter(s.list(), func(t *Item) bool { return isWaiting(t) && state(t) != "done" }) {
		if days := daysBetween(orStr(str(i, "wait_since"), str(i, "updated")), ctx.Today); days > staleWaitDays {
			out = append(out, "Waiting "+itoa(days)+" days: "+i.ID+" "+i.Title+" on "+str(i, "wait"))
		}
	}
	for _, i := range filter(s.list(), func(t *Item) bool {
		return t.Kind == "task" && state(t) == "open" && (when(t) == "later" || when(t) == "someday")
	}) {
		if days := daysBetween(orStr(str(i, "updated"), str(i, "created")), ctx.Today); days > staleDays {
			out = append(out, when(i)+" for "+itoa(days)+" days: "+i.ID+" "+i.Title+". Queue, keep or drop?")
		}
	}
	for _, p := range filter(s.projects(), func(x *Project) bool { return pstate(x) != "done" }) {
		tasks, _, _ := projectTasks(s, p)
		open := filter(tasks, func(t *Item) bool { return state(t) != "done" })
		if len(open) == 0 {
			out = append(out, "Project "+p.ID+" "+p.Title+" has nothing left: close it?")
		} else if !some(open, func(t *Item) bool { return isQueued(t) || state(t) == "now" || state(t) == "review" }) {
			out = append(out, "Project "+p.ID+" "+p.Title+" has nothing queued.")
		}
	}
	for _, a := range filter(s.areas(), func(x string) bool { return x != CoreArea }) {
		used := some(s.list(), func(i *Item) bool { return i.Home.Name == a })
		if used && len(activePrinciples(s, a)) == 0 {
			out = append(out, "Area "+a+" has no principles.")
		}
	}
	for _, r := range filter(s.list(), func(i *Item) bool { return i.Kind == "principle" && str(i, "superseded_by") == "" }) {
		if str(r, "because") == "" || str(r, "instead") == "" {
			lacks := "because"
			if str(r, "instead") == "" {
				lacks = "instead"
			}
			out = append(out, "Principle "+r.ID+" "+r.Title+" lacks "+lacks+": would a model get it wrong without it?")
		}
	}
	for _, d := range duplicates(s) {
		out = append(out, "Duplicate? "+d[0].ID+" "+d[0].Title+" / "+d[1].ID+" "+d[1].Title)
	}
	return out
}

func review(ctx *Ctx, s *Store, o *Opts) Result {
	if o.Flag("done") {
		ctx.Config.Reviewed = ctx.Today
		writeConfig(ctx.Root, ctx.Config)
		return resultData([]string{"Review recorded (" + ctx.Today + ")."}, Obj("reviewed", ctx.Today))
	}
	lines := reviewLines(ctx, s)
	if len(lines) == 0 {
		lines = append(lines, "Nothing to review. Record it: wk review --done")
	} else {
		lines = append(lines, "Go through these with the user in short batches, then: wk review --done")
	}
	return resultData(lines, Obj("items", lines))
}

// briefReview: wk brief nudges when a review is overdue or the inbox is piling up.
func briefReview(ctx *Ctx, s *Store) []string {
	if inbox := len(inboxItems(s)); inbox >= inboxNudge {
		return []string{"Review due: " + itoa(inbox) + " jots in the inbox (wk review, wk guide review)."}
	}
	if last := ctx.Config.Reviewed; last != "" {
		if days := daysBetween(last, ctx.Today); days > reviewEveryDays {
			return []string{"Review due: last one " + itoa(days) + " days ago (wk review, wk guide review)."}
		}
		return nil
	}
	created := filter(mapList(s.list(), func(i *Item) string { return str(i, "created") }), func(c string) bool { return c != "" })
	sort.Strings(created)
	if len(created) > 0 && daysBetween(created[0], ctx.Today) > reviewEveryDays {
		return []string{"Review due: no review recorded yet (wk review, wk guide review)."}
	}
	return nil
}

// checkTidy: wk check shows the first problem, so the plan gets a little cleaner each task.
func checkTidy(_ *Ctx, s *Store) []string {
	if d := duplicates(s); len(d) > 0 {
		return []string{"Tidy: Duplicate? " + d[0][0].ID + " " + d[0][0].Title + " / " + d[0][1].ID + " " + d[0][1].Title}
	}
	return nil
}
