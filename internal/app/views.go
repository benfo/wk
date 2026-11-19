package app

import (
	"os"
	"path/filepath"
	"strings"
)

type NextView struct {
	now        *Item
	review     []*Item
	queue      []*Item
	queueTotal int
	due        []*Item
	waiting    []*Item
}

func nextView(s *Store, limit int) NextView {
	tasks := filter(s.list(), func(i *Item) bool { return i.Kind == "task" })
	ready := filter(tasks, func(t *Item) bool { return isQueued(t) && !isWaiting(t) })
	SortStable(ready, byQueue)
	v := NextView{
		review:     filter(tasks, func(t *Item) bool { return state(t) == "review" }),
		queue:      head(ready, limit),
		queueTotal: len(ready),
		due:        filter(tasks, func(t *Item) bool { return isDue(t) && state(t) == "open" && !isQueued(t) }),
		waiting:    filter(tasks, func(t *Item) bool { return isWaiting(t) && state(t) != "done" }),
	}
	for _, t := range tasks {
		if state(t) == "now" {
			v.now = t
			break
		}
	}
	return v
}

// queueLine: "r8vn Fix the banner (ui)"
func queueLine(i *Item) string { return itemLine(i) + " (" + i.Home.Name + ")" }

func nextLines(v NextView) []string {
	lines := []string{}
	if v.now != nil {
		lines = append(lines, "now    "+queueLine(v.now))
	} else {
		lines = append(lines, "now    (nothing in progress)")
	}
	for _, t := range v.review {
		lines = append(lines, "review "+queueLine(t)+" (waiting for the user)")
	}
	for _, t := range v.queue {
		lines = append(lines, "next   "+queueLine(t))
	}
	if v.queueTotal > len(v.queue) {
		lines = append(lines, "       +"+itoa(v.queueTotal-len(v.queue))+" more queued (wk ls queued)")
	}
	for _, t := range v.due {
		lines = append(lines, "due    "+queueLine(t))
	}
	for _, t := range v.waiting {
		lines = append(lines, "wait   "+queueLine(t))
	}
	if v.now == nil && len(v.review) == 0 && len(v.queue) == 0 && len(v.due) == 0 && len(v.waiting) == 0 {
		lines = append(lines, `Nothing queued. Add work with: wk add "<title>"`)
	}
	return lines
}

func nextData(v NextView) *OMap {
	var now any
	if v.now != nil {
		now = summary(v.now)
	}
	return Obj("now", now, "review", summaries(v.review), "queue", summaries(v.queue), "queue_total", v.queueTotal,
		"due", summaries(v.due), "waiting", summaries(v.waiting))
}

func nextCmd(_ *Ctx, s *Store) Result {
	v := nextView(s, 5)
	return resultData(nextLines(v), nextData(v))
}

func readHandoffFile(ctx *Ctx) string {
	file := filepath.Join(ctx.Root, SessionFile)
	if !exists(file) {
		return ""
	}
	return Trim(crlf(readFile(file)))
}

func readHandoff(ctx *Ctx) string {
	return Trim(strings.Replace(readHandoffFile(ctx), freshMark, "", 1))
}

func describeGit(wf Workflow) string {
	branch := "a branch per " + wf.Branch
	switch wf.Branch {
	case "":
		branch = "branching not chosen"
	case "none":
		branch = "no branches"
	}
	commit := "commit at each check"
	switch wf.Commit {
	case "":
		commit = "commits not chosen"
	case "ask":
		commit = "ask before each commit"
	case "task":
		commit = "commit after each task"
	}
	return branch + ", " + commit
}

// workflowLine is one line a fresh session reads before touching git or running checks.
func workflowLine(ctx *Ctx) string {
	wf := ctx.Config.Workflow
	parts := []string{}
	if ctx.Git {
		parts = append(parts, describeGit(wf))
		if wf.CommitStyle != "" {
			parts = append(parts, "commits: "+wf.CommitStyle)
		}
	}
	if wf.Quick != "" {
		parts = append(parts, "quick checks: "+wf.Quick)
	}
	if wf.Full != "" {
		parts = append(parts, "full checks: "+wf.Full)
	}
	if wf.Tracker != "" {
		parts = append(parts, "tracker: "+wf.Tracker)
	}
	if len(parts) == 0 {
		return ""
	}
	unchosen := ""
	if ctx.Git && (wf.Branch == "" || wf.Commit == "") {
		unchosen = " Ask before any branch or commit."
	}
	return "Workflow: " + strings.Join(parts, "; ") + "." + unchosen
}

// handoffAge is when the handoff was written, and whether an item changed after it.
func handoffAge(ctx *Ctx, s *Store) (written string, stale bool) {
	file := filepath.Join(ctx.Root, SessionFile)
	st, err := os.Stat(file)
	if err != nil || readHandoff(ctx) == "" {
		return "", false
	}
	at := st.ModTime()
	written = at.Local().Format("2006-01-02")
	for _, i := range s.list() {
		if i.Kind != "task" {
			continue
		}
		if is, err := os.Stat(i.File); err == nil && is.ModTime().After(at) {
			return written, true
		}
	}
	return written, false
}

func brief(ctx *Ctx, s *Store) Result {
	startSession(ctx)
	lines := []string{}
	empty := len(s.list()) == 0 && len(s.projects()) == 0 && len(s.archived()) == 0
	if empty {
		lines = append(lines, "Empty plan. Offer setup (wk guide setup).")
	}
	about := readSummary(ctx)
	if about != "" {
		lines = append(lines, "Summary: "+splitLines(about)[0])
	} else {
		lines = append(lines, "No summary yet.")
	}
	// Judge the handoff before the cues run: firing a dated trigger saves a task, which would make it look stale.
	written, stale := handoffAge(ctx, s)
	// Cues go early, so the line cap never hides them.
	lines = append(lines, briefDrift(ctx, s)...)
	lines = append(lines, briefDue(ctx, s)...)
	lines = append(lines, briefInbox(ctx, s)...)
	lines = append(lines, briefReview(ctx, s)...)
	lines = append(lines, briefPrinciples(ctx, s)...)
	if wf := workflowLine(ctx); wf != "" {
		lines = append(lines, wf)
	}
	handoff := readHandoff(ctx)
	if handoff != "" {
		fresh := ""
		if strings.HasPrefix(readHandoffFile(ctx), freshMark) {
			fresh = ", fresh session recommended"
		}
		w := written
		if stale {
			w = written + ", older than the latest task change"
		}
		lines = append(lines, "Handoff ("+w+fresh+"):")
		for _, l := range splitLines(handoff) {
			lines = append(lines, "  "+l)
		}
	} else {
		lines = append(lines, "Handoff: none yet.")
	}
	v := nextView(s, 3)
	lines = append(lines, nextLines(v)...)
	wf := ctx.Config.Workflow
	workflow := Obj(
		"git", Obj("branch", nullable(wf.Branch), "commit", nullable(wf.Commit)),
		"commit_style", nullable(wf.CommitStyle),
		"checks", Obj("quick", nullable(wf.Quick), "full", nullable(wf.Full)),
		"tracker", nullable(wf.Tracker),
	)
	data := Obj("summary", nullable(about), "handoff", nullable(handoff)).Spread(nextData(v))
	data.Set("empty_plan", empty)
	data.Set("workflow", workflow)
	return resultData(lines, data)
}
