package app

import "strings"

// fire marks sleeping tasks whose trigger matches as due. A due task shows up until someone moves,
// queues or drops it; nothing jumps into the queue on its own.
func fire(ctx *Ctx, s *Store, match func(kind, arg string) bool) []*Item {
	fired := []*Item{}
	for _, item := range s.list() {
		if item.Kind != "task" || state(item) != "open" || isDue(item) {
			continue
		}
		if k, arg, ok := triggerOf(when(item)); ok && match(k, arg) {
			item.Data.Set("due", ctx.Today)
			s.save(item)
			fired = append(fired, item)
		}
	}
	return fired
}

func dueLines(fired []*Item, why string) []string {
	if len(fired) == 0 {
		return nil
	}
	lines := []string{"Due now (" + why + "):"}
	for _, i := range head(fired, 5) {
		lines = append(lines, "  "+i.ID+" "+i.Title+" ("+i.Home.Name+")")
	}
	if len(fired) > 5 {
		lines = append(lines, "  +"+itoa(len(fired)-5)+" more (wk ls due)")
	}
	return lines
}

// doneTriggers: on wk done, tasks waiting on this one wake up.
func doneTriggers(ctx *Ctx, s *Store, item *Item) []string {
	return dueLines(fire(ctx, s, func(k, arg string) bool { return k == "after" && arg == item.ID }), "after "+item.ID)
}

// startTriggers: on wk start, work is beginning in these areas, so their start: items wake up.
func startTriggers(ctx *Ctx, s *Store, item *Item) []string {
	areas := principleAreas(s, item)
	fired := fire(ctx, s, func(k, arg string) bool { return k == "start" && contains(areas, arg) })
	if len(fired) == 0 {
		return nil
	}
	woke := filter(areas, func(a string) bool {
		return some(fired, func(f *Item) bool { return when(f) == "start:"+a })
	})
	return append([]string{""}, dueLines(fired, "work starts in "+strings.Join(woke, ", "))...)
}

// briefDue: wk brief fires dated items whose day has come, then lists everything due.
func briefDue(ctx *Ctx, s *Store) []string {
	fire(ctx, s, func(k, arg string) bool { return k == "on" && arg <= ctx.Today })
	due := filter(s.list(), func(i *Item) bool { return i.Kind == "task" && state(i) == "open" && isDue(i) })
	if len(due) == 0 {
		return nil
	}
	shown := strings.Join(mapList(head(due, 3), func(i *Item) string { return i.ID + " " + i.Title + " (" + str(i, "when") + ")" }), "; ")
	more := ""
	if len(due) > 3 {
		more = "; +" + itoa(len(due)-3) + " more"
	}
	return []string{"Due: " + shown + more + ". Queue, reschedule or drop each."}
}
