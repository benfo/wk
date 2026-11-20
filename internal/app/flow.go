package app

import (
	"path/filepath"
	"regexp"
	"strings"
)

const freshMark = "<!-- fresh session -->"
const archiveAfterDays = 7

func nowTask(s *Store) *Item {
	for _, i := range s.list() {
		if i.Kind == "task" && state(i) == "now" {
			return i
		}
	}
	return nil
}

func task(s *Store, raw string) *Item {
	item := s.get(raw)
	if item.Kind != "task" {
		fail(item.ID + " is a " + item.Kind + ", not a task.")
	}
	return item
}

// commitHint is what the git workflow says to do at a stop, or "" when it says nothing (or there's
// no git). The agent follows this instead of its own git habits.
func commitHint(ctx *Ctx, moment string) string {
	if !ctx.Git {
		return ""
	}
	commit, branch := ctx.Config.Workflow.Commit, ctx.Config.Workflow.Branch
	if commit == "" || branch == "" {
		return "Git: workflow not chosen. Ask the user before any commit or branch, then save it with wk config set."
	}
	if commit == "ask" {
		return "Git: ask the user before committing."
	}
	due := "check"
	if commit == "task" {
		due = "done"
	}
	style := ""
	if ctx.Config.Workflow.CommitStyle != "" {
		style = " Style: " + ctx.Config.Workflow.CommitStyle + "."
	}
	if moment == due {
		return "Git: commit now (commit: " + commit + ")." + style
	}
	return ""
}

func nonBlank(lines []string) []string {
	return filter(lines, func(l string) bool { return Trim(l) != "" })
}

// start sets a task to now; branch is "task", "none" or "" (follow config).
func start(ctx *Ctx, s *Store, raw string, branchFlag *bool) Result {
	item := task(s, raw)
	current := nowTask(s)
	if current != nil && current.ID != item.ID {
		fail(current.ID + " is already now. Check it or wait it first.")
	}
	if current != nil && current.ID == item.ID {
		return resultData([]string{item.ID + " is already now."}, Obj("id", item.ID, "state", "now"))
	}
	if state(item) == "inbox" {
		fail(item.ID + " is in the inbox. Sort it first: wk move " + item.ID + " --in <home>")
	}
	if state(item) == "done" {
		fail(item.ID + " is done.")
	}
	if isWaiting(item) {
		fail(item.ID + " is waiting on " + str(item, "wait") + ". Clear it first: wk wait " + item.ID + " --clear")
	}

	lines := []string{}
	branch := ""
	mode := ctx.Config.Workflow.Branch
	if mode == "" {
		mode = "none"
	}
	if branchFlag != nil {
		if *branchFlag {
			mode = "task"
		} else {
			mode = "none"
		}
	}
	if mode != "none" {
		if !ctx.Git {
			lines = append(lines, "Not a git repo, no branch created.")
		} else {
			var project *Project
			if mode == "project" && item.Home.Type == "project" {
				project = s.project(item.Home.Name)
			}
			if mode == "project" && project == nil {
				lines = append(lines, "Not in a project, so no project branch.")
			} else {
				name := item.ID + "-" + slugify(item.Title)
				if project != nil {
					name = project.ID + "-" + slugify(project.Title)
				}
				if currentBranch(ctx.Base) != name {
					var ok bool
					var msg string
					if branchExists(ctx.Base, name) {
						ok, msg = checkoutBranch(ctx.Base, name)
					} else {
						ok, msg = createBranch(ctx.Base, name)
					}
					if !ok {
						fail("Could not switch to branch " + name + ": " + msg)
					}
				}
				branch = name
			}
		}
	}
	item.Data.Set("state", "now")
	item.Data.Delete("due")
	s.save(item)
	lines = append([]string{"now   " + item.ID + " " + item.Title + " (" + item.Home.Name + ")"}, lines...)
	if branch != "" {
		lines = append(lines, "Branch: "+branch)
	} else if ctx.Git {
		b := currentBranch(ctx.Base)
		if b == "" {
			b = "unknown"
		}
		lines = append(lines, "On branch: "+b)
	}

	// A task from another home rarely needs this session's context.
	session := readSession(ctx)
	switched := session.LastHome != "" && session.LastHome != item.Home.Name
	if switched {
		lines = append(lines, "Different home from the last task ("+session.LastHome+"): suggest a fresh session, after a handoff.")
	}
	next := readSession(ctx)
	next.LastHome = item.Home.Name
	writeSession(ctx, next)

	// Everything needed to begin, so starting a task is one call.
	if body := nonBlank(splitLines(item.Body)); len(body) > 0 {
		lines = append(append(lines, ""), body...)
	}
	lines = append(lines, startPrinciples(ctx, s, item)...)
	lines = append(lines, startTriggers(ctx, s, item)...)
	lines = append(lines, startRelated(ctx, s, item)...)
	lines = append(lines, startChecks(ctx, s, item)...)
	return Result{Lines: lines, Data: Obj("id", item.ID, "state", "now", "branch", nullable(branch), "home_switch", switched, "body", item.Body), Full: true}
}

var testLineRe = regexp.MustCompile(`(?i)^Test:\s*`)

func splitValues(values []string) []string {
	out := []string{}
	for _, v := range values {
		for _, t := range splitLines(unescapeText(v)) {
			if t = Trim(t); t != "" {
				out = append(out, t)
			}
		}
	}
	return out
}

// check moves the now task to review: checked is what the agent ran, test is for a person to try.
func check(ctx *Ctx, s *Store, o *Opts) Result {
	item := nowTask(s)
	if item == nil {
		fail("Nothing is now. Start a task first: wk start <id>")
	}
	note := ""
	handoffRaw, hasHandoff := o.Str("handoff")
	if hasHandoff {
		note = handoffText(handoffRaw)
	}
	given := splitValues(o.List("test"))
	checked := splitValues(o.List("checked"))
	for _, c := range checked {
		checkTitle(c, "A --checked line")
	}
	bodyLines := splitLines(item.Body)
	rest := filter(bodyLines, func(l string) bool { return !testLineRe.MatchString(l) })
	tests := mapList(filter(bodyLines, func(l string) bool { return testLineRe.MatchString(l) }), func(l string) string {
		return testLineRe.ReplaceAllString(l, "")
	})
	if len(given) > 0 {
		tests = given
		parts := mapList(tests, func(t string) string { return "Test: " + t })
		if some(rest, func(l string) bool { return Trim(l) != "" }) {
			parts = append(append(parts, ""), rest...)
		}
		item.Body = checkLines(strings.Join(parts, "\n"), limitTaskBody, "Task body with tests")
	}
	if len(checked) > 0 {
		item.Data.Set("checked", checked)
	} else {
		item.Data.Delete("checked")
	}
	item.Data.Set("state", "review")
	s.save(item)

	lines := []string{"review " + item.ID + " " + item.Title}
	for _, t := range tests {
		lines = append(lines, "Test (you): "+t)
	}
	for _, c := range checked {
		lines = append(lines, "Checked: "+c)
	}
	if len(tests) == 0 && len(checked) == 0 {
		lines = append(lines, `Nothing checked or tested. Add --checked "<automated result>" and/or --test "<for a person>".`)
	} else if len(tests) == 0 {
		lines = append(lines, "Nothing for a person to try. Use Review: what changed, why, which files.")
	}

	var diff *diffSum
	if ctx.Git {
		diff = diffSummary(ctx.Base)
	}
	if diff != nil {
		if len(diff.files) == 0 {
			lines = append(lines, "No uncommitted changes.")
		} else {
			stat := ""
			if diff.shortstat != "" {
				stat = " (" + shortstatFiles.ReplaceAllString(diff.shortstat, "") + ")"
			}
			lines = append(lines, "Changed: "+pluralMany(len(diff.files), "file", "files")+stat)
			shown := head(diff.files, 3)
			more := ""
			if len(diff.files) > len(shown) {
				more = ", +" + itoa(len(diff.files)-len(shown)) + " more"
			}
			lines = append(lines, "  "+strings.Join(shown, ", ")+more)
		}
	}
	lines = append(lines, checkCaptured(ctx, s, item)...)
	lines = append(lines, checkTidy(ctx, s)...)
	git := commitHint(ctx, "check")
	if git != "" {
		lines = append(lines, git)
	}
	if hasHandoff {
		writeHandoff(ctx, note, o.Flag("fresh"))
	}
	sess := readSession(ctx)
	sess.FreshFor = ""
	if o.Flag("fresh") {
		sess.FreshFor = item.ID
	}
	writeSession(ctx, sess)
	then := "send the check-in, then wk done " + item.ID + " once the user confirms."
	if hasHandoff {
		lines = append(lines, "Handoff saved. Next: "+then)
	} else {
		lines = append(lines, "Next: wk handoff (keeps a fresh session safe), "+then)
	}
	var changed any
	if diff != nil {
		changed = diff.files
	}
	return resultData(lines, Obj("id", item.ID, "state", "review", "tests", tests, "checked", checked, "git", nullable(git), "handoff", nullableIf(note, hasHandoff), "changed", changed))
}

var shortstatFiles = regexp.MustCompile(`^\d+ files? changed, `)

func nullableIf(s string, ok bool) any {
	if !ok {
		return nil
	}
	return s
}

// archiveOld moves done area items older than a week to the archive, so lists stay short.
func archiveOld(ctx *Ctx, s *Store) []*Item {
	old := filter(s.list(), func(i *Item) bool {
		if i.Kind != "task" || state(i) != "done" || i.Home.Type != "area" {
			return false
		}
		from := str(i, "done_on")
		if from == "" {
			from = str(i, "updated")
		}
		return daysBetween(from, ctx.Today) > archiveAfterDays
	})
	for _, i := range old {
		year := str(i, "done_on")
		if year == "" {
			year = ctx.Today
		}
		s.archive(i, Slice16(year, 4))
	}
	return old
}

func done(ctx *Ctx, s *Store, raw string, o *Opts) Result {
	item := task(s, raw)
	handoffRaw, hasHandoff := o.Str("handoff")
	given := ""
	if hasHandoff {
		given = handoffText(handoffRaw)
	}
	if state(item) == "done" {
		return resultData([]string{item.ID + " is already done."}, Obj("id", item.ID, "state", "done"))
	}
	if state(item) != "review" && !o.Flag("force") {
		fail(item.ID + " is " + state(item) + ", not review. Run wk check first, or --force for trivial tasks.")
	}
	item.Data.Set("state", "done")
	item.Data.Set("done_on", ctx.Today)
	item.Data.Delete("wait")
	item.Data.Delete("wait_since")
	item.Data.Delete("due")
	s.save(item)
	git := commitHint(ctx, "done")

	session := readSession(ctx)
	finished := session.Done
	if !contains(finished, item.ID) {
		finished = append(append([]string{}, finished...), item.ID)
	}
	fresh := session.FreshFor == item.ID
	if _, set := o.flags["fresh"]; set {
		fresh = o.Flag("fresh")
	}
	session.Done = finished
	session.FreshFor = ""
	writeSession(ctx, session)
	advice := "Next task unrelated, or context heavy? Suggest a fresh session."
	if fresh {
		advice = "You recommended a fresh session: stop here."
	} else if len(finished) >= FreshAfterTasks {
		advice = itoa(len(finished)) + " tasks done this session: suggest a fresh session unless the next task builds on this one."
	}

	lines := []string{"done  " + item.ID + " " + item.Title}
	if git != "" {
		lines = append(lines, git)
	}
	lines = append(lines, doneTriggers(ctx, s, item)...)
	lines = append(lines, doneProject(ctx, s, item)...)
	archived := archiveOld(ctx, s)
	if len(archived) > 0 {
		lines = append(lines, "Archived "+pluralMany(len(archived), "old done item", "old done items")+".")
	}
	note := given
	if !hasHandoff {
		// People read the handoff on the board: no id, the full title, and no "Next" that goes stale
		// as soon as the queue changes (brief and the board show the queue live).
		note = "Done: " + fullTitle(item) + "."
	}
	writeHandoff(ctx, note, fresh)
	how := "written from this task (pass --handoff for more)"
	if hasHandoff {
		how = "saved"
	}
	lines = append(lines, "Handoff "+how+". "+advice)
	return resultData(lines, Obj("id", item.ID, "state", "done", "git", nullable(git), "session_tasks", len(finished), "handoff", note,
		"archived", mapList(archived, func(i *Item) string { return i.ID })))
}

func wait(ctx *Ctx, s *Store, raw, reason string, o *Opts) Result {
	item := task(s, raw)
	if o.Flag("clear") {
		if !isWaiting(item) {
			return resultData([]string{item.ID + " isn't waiting."}, Obj("id", item.ID, "wait", nil))
		}
		item.Data.Delete("wait")
		item.Data.Delete("wait_since")
		s.save(item)
		return resultData([]string{item.ID + " " + item.Title + " is no longer waiting."}, Obj("id", item.ID, "wait", nil))
	}
	if state(item) == "done" {
		fail(item.ID + " is done.")
	}
	why := checkLines(Trim(reason), 1, "Wait reason")
	if why == "" {
		fail("Say what it waits on: wk wait " + item.ID + ` "<a decision, a person, another item>"`)
	}
	item.Data.Set("wait", why)
	item.Data.Set("wait_since", ctx.Today)
	if state(item) == "now" {
		item.Data.Set("state", "open")
	}
	s.save(item)
	return resultData([]string{item.ID + " " + item.Title + " waits on: " + why}, Obj("id", item.ID, "wait", why))
}

func handoffText(raw string) string {
	text := checkLines(unescapeText(raw), limitHandoff, "Handoff")
	if text == "" {
		fail("Handoff is empty.")
	}
	return text
}

func writeHandoff(ctx *Ctx, text string, fresh bool) {
	mark := ""
	if fresh {
		mark = freshMark + "\n"
	}
	writeFile(filepath.Join(ctx.Root, SessionFile), mark+text+"\n")
}

func handoffCmd(ctx *Ctx, _ *Store, raw string, o *Opts) Result {
	text := handoffText(raw)
	writeHandoff(ctx, text, o.Flag("fresh"))
	n := len(splitLines(text))
	lines := []string{"Handoff saved (" + pluralMany(n, "line", "lines") + ")."}
	if full := ctx.Config.Workflow.Full; full != "" {
		lines = append(lines, "Ending the session? Run the full checks first if they have not run: "+full)
	}
	return resultData(lines, Obj("handoff", text))
}
