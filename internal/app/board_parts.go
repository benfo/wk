package app

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Small HTML pieces every part of the board shares.

var htmlEsc = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

func esc(s string) string { return htmlEsc.Replace(s) }

type View struct {
	homeNames map[string]string
	// hues is each project's colour slot, in plan order, so a project keeps its colour when others close.
	hues map[string]int
}

var labelPrefix = regexp.MustCompile(`^[A-Za-z][\w ]{0,20}:\s+`)

// headline: "Name: Daily Dad Joke CLI" reads better as "Daily Dad Joke CLI".
func headline(summaryText, fallback string) string {
	first := Trim(splitLines(summaryText)[0])
	text := labelPrefix.ReplaceAllString(first, "")
	if text == "" {
		text = fallback
	}
	if text == "" {
		return ""
	}
	r := []rune(text)
	// charAt(0).toUpperCase(): one UTF-16 unit, so astral characters stay as they are.
	if r[0] < 0x10000 {
		return strings.ToUpper(string(r[0])) + string(r[1:])
	}
	return text
}

func homeLabel(v View, i *Item) string {
	if n, ok := v.homeNames[i.Home.Name]; ok {
		return n
	}
	return i.Home.Name
}

var afterColon = regexp.MustCompile(`:.*$`)

// shortName: "Story across the eras: the Kestrel thread" fits a chip as "Story across the eras".
func shortName(name string) string { return afterColon.ReplaceAllString(name, "") }

// key changes when the row's meaning changes, so the live page can flash what's new.
func key(i *Item) string {
	return esc(i.ID + ":" + str(i, "state") + ":" + str(i, "when") + ":" + str(i, "due") + ":" + str(i, "wait") + ":" + i.Title)
}

// parseISO is Date.parse for the ISO timestamps wk writes; NaN-like zero when it can't read one.
func parseISO(iso string) (float64, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000Z07:00", "2006-01-02"} {
		if t, err := time.Parse(layout, iso); err == nil {
			return float64(t.UnixMilli()), true
		}
	}
	return 0, false
}

// ago: "just now", "12 min", "3 h", "2 d": short enough for a glance.
func ago(iso string, nowMs float64) string {
	at, ok := parseISO(iso)
	mins := math.NaN()
	if ok {
		mins = math.Max(0, jsRound((nowMs-at)/60000))
	}
	switch {
	case mins < 1:
		return "just now"
	case mins < 60:
		return JSNum(mins) + " min"
	case mins < 60*24:
		return JSNum(jsRound(mins/60)) + " h"
	case math.IsNaN(mins):
		return "NaN d"
	}
	return JSNum(jsRound(mins/(60*24))) + " d"
}

// clock is a relative time the live page keeps ticking; prefix and suffix wrap the number.
func clock(iso string, nowMs float64, prefix, suffix string) string {
	t := ago(iso, nowMs)
	text := prefix + t + suffix
	if t == "just now" {
		if suffix != "" {
			text = prefix + "just now"
		} else {
			text = prefix + "a moment"
		}
	}
	return `<time class="ago" datetime="` + esc(iso) + `" data-prefix="` + esc(prefix) + `" data-suffix="` + esc(suffix) + `">` + esc(text) + `</time>`
}

// wakeLabel is plain words for a trigger: when a sleeping item comes back.
func wakeLabel(v View, s *Store, w string) string {
	i := strings.Index(w, ":")
	kind, arg := "", w[i+1:]
	if i >= 0 {
		kind = w[:i]
	} else {
		kind = w[:max(0, len(w)-1)]
		arg = w
	}
	switch kind {
	case "after":
		for _, x := range s.list() {
			if x.ID == arg {
				return "After “" + x.Title + "” is done"
			}
		}
		return "After “" + arg + "” is done"
	case "end":
		if n, ok := v.homeNames[arg]; ok {
			return "When " + n + " ends"
		}
		return "When " + arg + " ends"
	case "start":
		return "Next time work starts in " + arg
	case "on":
		return "On " + arg
	}
	return w
}

var testPrefix = regexp.MustCompile(`(?i)^Test:\s*`)

func testsOf(i *Item) []string {
	out := []string{}
	for _, l := range splitLines(i.Body) {
		if testPrefix.MatchString(l) {
			out = append(out, testPrefix.ReplaceAllString(l, ""))
		}
	}
	return out
}

// BoardKind is where a task stands. Each has its own icon shape, so colour is never the only signal.
type BoardKind string

var kindLabel = map[BoardKind]string{
	"now": "In progress", "review": "Ready to try", "due": "Due", "todo": "Up next", "waiting": "Waiting",
	"sleeping": "Sleeping", "later": "Later", "inbox": "Inbox", "done": "Done",
}

func kindOf(t *Item) BoardKind {
	switch state(t) {
	case "now":
		return "now"
	case "review":
		return "review"
	case "done":
		return "done"
	case "inbox":
		return "inbox"
	}
	if isDue(t) {
		return "due"
	}
	if isWaiting(t) {
		return "waiting"
	}
	if isQueued(t) {
		return "todo"
	}
	if _, _, ok := triggerOf(when(t)); ok {
		return "sleeping"
	}
	return "later"
}

// icon draws status icons in the manner of an issue tracker, in currentColor; each status sets its
// own colour (.s-<kind> in the stylesheet), so the shape and the colour say the same thing.
func icon(kind BoardKind) string {
	ring := func(dash string) string {
		return `<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"` + dash + `/>`
	}
	line := func(d string) string {
		return `<path d="` + d + `" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`
	}
	body := map[BoardKind]string{
		"later":    ring(` stroke-dasharray="2.2 2.2"`),
		"inbox":    ring(` stroke-dasharray="2.2 2.2"`) + `<circle cx="7" cy="7" r="1.6" fill="currentColor"/>`,
		"sleeping": ring(` stroke-dasharray="0.6 2.6" stroke-linecap="round"`),
		"todo":     ring(""),
		"waiting":  ring("") + line("M5.6 5v4M8.4 5v4"),
		"due":      ring("") + line("M7 4.2V7.4l2 1.2"),
		"now":      ring("") + `<path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor"/>`,
		"review":   ring("") + `<path d="M7 3.5A3.5 3.5 0 1 1 3.5 7H7Z" fill="currentColor"/>`,
		"done":     `<circle cx="7" cy="7" r="6.25" fill="currentColor"/><path d="M4.4 7.2 6.2 9l3.5-3.7" fill="none" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
	}
	return `<svg class="ic s-` + string(kind) + `" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="` + kindLabel[kind] + `">` + body[kind] + `</svg>`
}

// hue is the style that gives an element its project's colour (one of six), or nothing for an area.
func hue(v View, home string) string {
	n, ok := v.hues[home]
	if !ok {
		return ""
	}
	return ` style="--pc:var(--p` + itoa(n%6+1) + `)"`
}

// chip shows where an item lives, in its project's colour.
func chip(v View, i *Item) string {
	return `<span class="chip"` + hue(v, i.Home.Name) + `>` + esc(shortName(homeLabel(v, i))) + `</span>`
}

func toFixed2(f float64) string { return strconv.FormatFloat(f, 'f', 2, 64) }

// ring is project progress as a small ring that fills clockwise.
func ringSVG(done, total, size int, style string) string {
	r := float64(size)/2 - 2
	c := 2 * math.Pi * r
	f := 0.0
	if total != 0 {
		f = float64(done) / float64(total)
	}
	mid := JSNum(float64(size) / 2)
	rs := JSNum(r)
	sz := itoa(size)
	return `<svg class="ring" width="` + sz + `" height="` + sz + `" viewBox="0 0 ` + sz + ` ` + sz + `" role="img" aria-label="` + itoa(done) + ` of ` + itoa(total) + ` done"` + style +
		`><circle cx="` + mid + `" cy="` + mid + `" r="` + rs + `" fill="none" class="ring-track" stroke-width="2"/><circle cx="` + mid + `" cy="` + mid + `" r="` + rs +
		`" fill="none" class="ring-fill" stroke-width="2" stroke-dasharray="` + toFixed2(c*f) + ` ` + toFixed2(c) + `" stroke-linecap="round" transform="rotate(-90 ` + mid + ` ` + mid + `)"/></svg>`
}

type rowOpts struct {
	noProject bool
	right     string
	note      string
	kind      BoardKind
}

// row is one task: status icon, title (with an optional note under it), then quiet facts and its project.
func row(v View, t *Item, o rowOpts) string {
	note := ""
	if o.note != "" {
		note = `<div class="note">` + o.note + `</div>`
	}
	right := ""
	if o.right != "" {
		right = `<span class="m">` + o.right + `</span>`
	}
	kind := o.kind
	if kind == "" {
		kind = kindOf(t)
	}
	project := chip(v, t)
	if o.noProject {
		project = ""
	}
	return `<li class="r" data-key="` + key(t) + `" title="id ` + t.ID + `">` + icon(kind) + `<div class="body"><div class="tt">` + esc(fullTitle(t)) + `</div>` + note + `</div>` + right + project + `</li>`
}

// group is a status group: a header bar with the icon, name and count, then its rows.
func group(kind BoardKind, name string, count int, rows string, closed bool) string {
	if count == 0 {
		return ""
	}
	cls, ic := "", ""
	if kind != "" {
		cls = " s-" + string(kind)
		ic = icon(kind)
	}
	open := " open"
	if closed {
		open = ""
	}
	return `<details class="g` + cls + `"` + open + `><summary>` + ic + `<b>` + esc(name) + `</b><span class="c">` + itoa(count) + `</span></summary><ul>` + rows + `</ul></details>`
}

// capped shows the first few rows, then the rest behind "N more".
func capped(rows []string, show int) string {
	if len(rows) <= show+1 {
		return strings.Join(rows, "")
	}
	return strings.Join(rows[:show], "") + `<li><details class="more"><summary>` + itoa(len(rows)-show) + ` more</summary><ul>` + strings.Join(rows[show:], "") + `</ul></details></li>`
}

var idWordRe = regexp.MustCompile(`\b[0-9a-z]{4}\b`)

// named is text as escaped HTML with each known id replaced by its name, the id kept as a tooltip:
// handoffs are written for agents, which want ids, but read on the board by people, who want names.
func named(text string, names map[string]string) string {
	var b strings.Builder
	last := 0
	for _, m := range idWordRe.FindAllStringIndex(text, -1) {
		id := text[m[0]:m[1]]
		name, ok := names[id]
		if !ok {
			continue
		}
		b.WriteString(esc(text[last:m[0]]))
		fmt.Fprintf(&b, `<span title="%s">%s</span>`, esc(id), esc(name))
		last = m[1]
	}
	b.WriteString(esc(text[last:]))
	return b.String()
}

// fullTitle undoes a long jot's cut title: jot keeps the whole first line at the top of the body.
func fullTitle(i *Item) string {
	head := strings.TrimSuffix(i.Title, "…")
	if head == i.Title {
		return i.Title
	}
	first, _, _ := strings.Cut(i.Body, "\n")
	if first = Trim(first); strings.HasPrefix(first, head) {
		return first
	}
	return i.Title
}
