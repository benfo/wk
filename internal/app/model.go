package app

import (
	"math"
	"regexp"
	"strings"
	"time"
)

var Horizons = []string{"next", "queue", "later", "someday"}

func state(i *Item) string { return str(i, "state") }
func when(i *Item) string  { return str(i, "when") }
func isTask(i *Item) bool  { return i.Kind == "task" }

// isOpen: not finished (inbox, open, now or review).
func isOpen(i *Item) bool    { return isTask(i) && state(i) != "done" }
func isWaiting(i *Item) bool { return str(i, "wait") != "" }
func isDue(i *Item) bool     { return str(i, "due") != "" }

// isQueued: open, horizon next or queue.
func isQueued(i *Item) bool {
	return isTask(i) && state(i) == "open" && (when(i) == "next" || when(i) == "queue")
}

func rank(i *Item) float64 {
	if r, ok := getV(i.Data, "rank").(float64); ok {
		return r
	}
	return math.MaxInt64 / 1024 // Number.MAX_SAFE_INTEGER
}

func byQueue(a, b *Item) int {
	if d := rank(a) - rank(b); d != 0 {
		if d < 0 {
			return -1
		}
		return 1
	}
	if c := LocaleCompare(str(a, "created"), str(b, "created")); c != 0 {
		return c
	}
	return LocaleCompare(a.ID, b.ID)
}

var triggerRe = regexp.MustCompile(`^(after|end|start|on):(.+)$`)

// triggerOf is the trigger kind and argument of a when, or ok=false for a horizon.
func triggerOf(w string) (kind, arg string, ok bool) {
	m := triggerRe.FindStringSubmatch(w)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

var isoDate = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)

// validDate accepts what Date.parse accepts for YYYY-MM-DD: month 1-12, day 1-31.
func validDate(s string) bool {
	m := isoDate.FindStringSubmatch(s)
	if m == nil {
		return false
	}
	month, day := atoi(m[2]), atoi(m[3])
	return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}

type whenResolver struct {
	item    func(string) string
	project func(string) string
	area    func(string) string
}

// parseWhen checks a when and normalises its argument (ids to full ids, area names).
func parseWhen(raw string, r whenResolver) string {
	w := strings.ToLower(Trim(raw))
	if contains(Horizons, w) {
		return w
	}
	kind, arg, ok := triggerOf(w)
	if !ok {
		fail(`Unknown when "` + raw + `". Use next, queue, later, someday, after:<id>, end:<project>, start:<area> or on:<YYYY-MM-DD>.`)
	}
	switch kind {
	case "after":
		return "after:" + r.item(arg)
	case "end":
		return "end:" + r.project(arg)
	case "start":
		return "start:" + r.area(arg)
	}
	if !validDate(arg) {
		fail(`on: needs a date like 2026-12-01, not "` + arg + `".`)
	}
	return "on:" + arg
}

// itemLine: "r8vn Banner border shifts right [waiting: design] [due]"
func itemLine(i *Item) string {
	line := i.ID + " " + i.Title
	if isWaiting(i) {
		line += " [waiting: " + str(i, "wait") + "]"
	}
	if isDue(i) {
		line += " [due]"
	}
	return line
}

func tagLine(i *Item) string {
	tags := tagsOf(i)
	if len(tags) == 0 {
		return ""
	}
	return " #" + strings.Join(tags, " #")
}

// parseDay is Date.parse of a YYYY-MM-DD at UTC midnight, allowing day overflow like V8 does.
func parseDay(s string) (time.Time, bool) {
	m := isoDate.FindStringSubmatch(s)
	if m == nil || !validDate(s) {
		return time.Time{}, false
	}
	return time.Date(atoi(m[1]), time.Month(atoi(m[2])), atoi(m[3]), 0, 0, 0, 0, time.UTC), true
}

func daysBetween(from, to string) int {
	a, ok1 := parseDay(from)
	b, ok2 := parseDay(to)
	if !ok1 || !ok2 {
		return 0
	}
	return int(jsRound(b.Sub(a).Hours() / 24))
}
