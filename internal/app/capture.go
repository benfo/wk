package app

import (
	"regexp"
	"strings"
)

var trailingWord = regexp.MustCompile(`\s+\S*$`)

// jotParts: a jot's title is its first line, cut at a word boundary to the title limit; the full
// text stays in the body.
func jotParts(text string) (string, string) {
	lines := splitLines(text)
	first, rest := lines[0], lines[1:]
	if Len16(first) <= limitTitle {
		return first, strings.Join(rest, "\n")
	}
	cut := trailingWord.ReplaceAllString(Slice16(first, limitTitle-1), "")
	if cut == "" {
		cut = Slice16(first, limitTitle-1)
	}
	return cut + "…", text
}

// jot captures a thought with no questions: into the inbox, linked to the task it came up in.
// Sorting happens at the check-in, when the user is out of the zone anyway.
func jot(ctx *Ctx, s *Store, raw string, o *Opts) Result {
	text := checkLines(unescapeText(raw), limitNote, "Jot")
	if text == "" {
		fail("Jot is empty.")
	}
	title, body := jotParts(text)
	now := nowTask(s)
	inbox := s.resolveHome("inbox")
	data := Obj("state", "inbox")
	if now != nil {
		data.Set("from", now.ID)
	}
	item := s.create("task", inbox, title, body, data)
	files := []string{}
	for _, f := range o.List("file") {
		files = append(files, s.attach(item, resolvePath(ctx.Cwd, f)))
	}
	lines := []string{"Jotted " + item.ID + " " + title}
	if len(files) > 0 {
		lines = append(lines, "Attached: "+strings.Join(files, ", "))
	}
	d := summary(item)
	d.Set("attached", files)
	return resultData(lines, d)
}

func inboxItems(s *Store) []*Item {
	items := filter(s.list(), func(i *Item) bool { return state(i) == "inbox" })
	SortStable(items, byAge(firstSeen(s.ctx)))
	return items
}

func inbox(_ *Ctx, s *Store) Result {
	items := inboxItems(s)
	lines := mapList(items, func(i *Item) string {
		from := ""
		if str(i, "from") != "" {
			from = " (from " + str(i, "from") + ")"
		}
		return i.ID + " " + i.Title + from
	})
	if len(lines) == 0 {
		lines = []string{"Inbox is empty."}
	} else {
		lines = append(lines, "Sort each: wk move <id> --in <home> [--when <when>], or wk drop <id>. Knowledge: wk decide / wk learn, then drop the jot.")
	}
	return resultData(lines, summaries(items))
}

// checkCaptured: wk check lists what was jotted during this task, for sorting at the check-in.
func checkCaptured(_ *Ctx, s *Store, item *Item) []string {
	captured := filter(inboxItems(s), func(i *Item) bool { return str(i, "from") == item.ID })
	if len(captured) == 0 {
		return nil
	}
	lines := []string{"Captured: " + plural(len(captured), "jot") + " to sort at the check-in, with a suggested home and when for each:"}
	for _, i := range head(captured, 5) {
		lines = append(lines, "  "+i.ID+" "+i.Title)
	}
	return lines
}

// briefInbox: wk brief says how many jots wait for sorting.
func briefInbox(_ *Ctx, s *Store) []string {
	if n := len(inboxItems(s)); n > 0 {
		return []string{"Inbox: " + itoa(n) + " to sort (wk inbox)."}
	}
	return nil
}
