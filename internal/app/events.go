package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// PlanEvent is what changed in the plan, and when. Kept per machine in ~/.wk/events/, never in the
// plan, so a committed plan doesn't churn. The board reads it for its activity feed and timers.
type PlanEvent struct {
	At    string
	Verb  string
	ID    string
	Title string
	// Home is an area name, a project id or "inbox".
	Home string
}

const keepEvents = 500

type snap struct {
	kind, title, home, state, due, wait string
}

// snapshot holds items and projects as they stand, keyed by id, in plan order.
type snapshot struct {
	ids  []string
	byID map[string]snap
}

func eventsFile(ctx *Ctx) string {
	return filepath.Join(ctx.Home, "events", pathKey(ctx.Root, 12)+".jsonl")
}

func takeSnapshot(s *Store) snapshot {
	out := snapshot{byID: map[string]snap{}}
	add := func(id string, v snap) {
		if _, ok := out.byID[id]; !ok {
			out.ids = append(out.ids, id)
		}
		out.byID[id] = v
	}
	for _, i := range s.list() {
		add(i.ID, snap{i.Kind, i.Title, i.Home.Name, str(i, "state"), str(i, "due"), str(i, "wait")})
	}
	for _, p := range s.projects() {
		add(p.ID, snap{"project", p.Title, p.ID, pstate(p), "", ""})
	}
	return out
}

var createdVerb = map[string]string{"decision": "decided", "learning": "learned", "principle": "new principle", "project": "project started"}
var stateVerb = map[string]string{"now": "started", "review": "ready to try", "done": "done"}

// diffSnapshots turns two snapshots into events, in reading order: new, state changes, moves,
// due, waits, removed.
func diffSnapshots(before, after snapshot, archived func(string) bool) []PlanEvent {
	var created, changed, moved, due, waits, removed []PlanEvent
	ev := func(list *[]PlanEvent, verb, id string, s snap) {
		*list = append(*list, PlanEvent{Verb: verb, ID: id, Title: s.title, Home: s.home})
	}
	for _, id := range after.ids {
		a := after.byID[id]
		b, had := before.byID[id]
		if !had {
			verb := "added"
			if a.kind == "task" {
				if a.state == "inbox" {
					verb = "jotted"
				}
			} else if v, ok := createdVerb[a.kind]; ok {
				verb = v
			}
			ev(&created, verb, id, a)
			continue
		}
		if a.state != b.state {
			if a.kind == "project" {
				if a.state == "done" {
					ev(&changed, "project closed", id, a)
				}
			} else if b.state == "inbox" && a.state == "open" {
				ev(&changed, "sorted", id, a)
			} else if v, ok := stateVerb[a.state]; ok {
				ev(&changed, v, id, a)
			} else if b.state == "now" && a.state == "open" {
				ev(&changed, "paused", id, a)
			}
		} else if a.home != b.home && a.kind != "project" {
			ev(&moved, "moved", id, a)
		}
		if a.due != "" && b.due == "" {
			ev(&due, "due", id, a)
		}
		if a.wait != "" && b.wait == "" {
			ev(&waits, "waiting", id, a)
		}
		if a.wait == "" && b.wait != "" && a.state != "done" {
			ev(&waits, "no longer waiting", id, a)
		}
	}
	for _, id := range before.ids {
		if _, ok := after.byID[id]; ok {
			continue
		}
		b := before.byID[id]
		// A closed project moves to the archive with its items; old done items are archived quietly.
		if b.kind == "project" {
			ev(&removed, "project closed", id, b)
		} else if !archived(id) {
			ev(&removed, "dropped", id, b)
		}
	}
	out := []PlanEvent{}
	for _, l := range [][]PlanEvent{created, changed, moved, due, waits, removed} {
		out = append(out, l...)
	}
	return out
}

func eventJSON(e PlanEvent) string {
	return "{" + jsonQuote("at") + ":" + jsonQuote(e.At) + "," + jsonQuote("verb") + ":" + jsonQuote(e.Verb) + "," +
		jsonQuote("id") + ":" + jsonQuote(e.ID) + "," + jsonQuote("title") + ":" + jsonQuote(e.Title) + "," +
		jsonQuote("home") + ":" + jsonQuote(e.Home) + "}"
}

// appendEvents is best effort: the log only feeds the board, so a failure never fails a command.
func appendEvents(ctx *Ctx, events []PlanEvent, at string) {
	if len(events) == 0 {
		return
	}
	defer func() { _ = recover() }()
	file := eventsFile(ctx)
	if os.MkdirAll(filepath.Dir(file), 0o755) != nil {
		return
	}
	lines := []string{}
	for _, e := range events {
		e.At = at
		lines = append(lines, eventJSON(e))
	}
	f, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.WriteString(strings.Join(lines, "\n") + "\n")
	f.Close()
	b, err := os.ReadFile(file)
	if err != nil {
		return
	}
	all := filter(strings.Split(string(b), "\n"), func(l string) bool { return l != "" })
	if float64(len(all)) > keepEvents*1.2 {
		_ = os.WriteFile(file, []byte(strings.Join(all[len(all)-keepEvents:], "\n")+"\n"), 0o644)
	}
}

// readEvents returns the newest first.
func readEvents(ctx *Ctx, limit int) []PlanEvent {
	b, err := os.ReadFile(eventsFile(ctx))
	if err != nil {
		return []PlanEvent{}
	}
	lines := filter(strings.Split(string(b), "\n"), func(l string) bool { return l != "" })
	if len(lines) > limit {
		lines = lines[len(lines)-limit:]
	}
	out := []PlanEvent{}
	for i := len(lines) - 1; i >= 0; i-- {
		var raw map[string]any
		if json.Unmarshal([]byte(lines[i]), &raw) != nil {
			continue
		}
		s := func(k string) string {
			v, ok := raw[k]
			if !ok {
				return ""
			}
			return jsonString(v)
		}
		out = append(out, PlanEvent{At: s("at"), Verb: s("verb"), ID: s("id"), Title: s("title"), Home: s("home")})
	}
	return out
}

func lastEvent(events []PlanEvent, id, verb string) *PlanEvent {
	for i := range events {
		if events[i].ID == id && events[i].Verb == verb {
			return &events[i]
		}
	}
	return nil
}

// firstSeen maps each id to the time of its oldest logged event: when it was made, to the
// millisecond, for items still in the log. Plans only store the day.
func firstSeen(ctx *Ctx) map[string]string {
	seen := map[string]string{}
	for _, e := range readEvents(ctx, keepEvents*2) { // newest first: the last write wins
		seen[e.ID] = e.At
	}
	return seen
}

// byAge is the queue order with same-day ties broken by the logged time. Ids not in the log come
// last: on the same day that means a command that failed partway, not one that aged out.
func byAge(seen map[string]string) func(a, b *Item) int {
	return func(a, b *Item) int {
		if d := rank(a) - rank(b); d != 0 {
			if d < 0 {
				return -1
			}
			return 1
		}
		if c := LocaleCompare(str(a, "created"), str(b, "created")); c != 0 {
			return c
		}
		if sa, sb := seen[a.ID], seen[b.ID]; sa != sb {
			switch {
			case sa == "":
				return 1
			case sb == "":
				return -1
			}
			return strings.Compare(sa, sb)
		}
		return LocaleCompare(a.ID, b.ID)
	}
}
