package app

// principleAreas are the areas whose principles apply to a task: core, its own area, and the areas
// its project touches.
func principleAreas(s *Store, item *Item) []string {
	areas := []string{CoreArea}
	if item.Home.Type == "area" {
		areas = append(areas, item.Home.Name)
	}
	if item.Home.Type == "project" {
		for _, p := range s.projects() {
			if p.ID == item.Home.Name {
				areas = append(areas, touchesOf(p)...)
				break
			}
		}
	}
	known := s.areas()
	return filter(uniq(areas), func(a string) bool { return contains(known, a) })
}

func principleLines(s *Store, areas []string) (lines, missing []string, data *OMap) {
	data = NewOMap()
	for _, area := range areas {
		rules := activePrinciples(s, area)
		data.Set(area, mapList(rules, func(r *Item) any {
			return Obj("id", r.ID, "rule", r.Title, "instead", str(r, "instead"), "because", str(r, "because"), "test", nullable(str(r, "test")))
		}))
		if len(rules) == 0 {
			missing = append(missing, area)
			continue
		}
		lines = append(lines, area+":")
		for _, r := range rules {
			lines = append(lines, "  "+r.Title)
			why := []string{}
			if str(r, "instead") != "" {
				why = append(why, "instead of "+str(r, "instead"))
			}
			if str(r, "because") != "" {
				why = append(why, "because "+str(r, "because"))
			}
			if len(why) > 0 {
				lines = append(lines, "    "+joinWith(why, "; "))
			}
			if str(r, "test") != "" {
				lines = append(lines, "    enforced by "+str(r, "test"))
			}
		}
	}
	return lines, missing, data
}

func joinWith(list []string, sep string) string {
	out := ""
	for i, s := range list {
		if i > 0 {
			out += sep
		}
		out += s
	}
	return out
}

// startPrinciples: wk start lists the principles that apply, and asks once per area that has none.
func startPrinciples(ctx *Ctx, s *Store, item *Item) []string {
	lines, missing, _ := principleLines(s, principleAreas(s, item))
	out := []string{}
	if len(lines) > 0 {
		out = append(append(out, "", "Principles:"), lines...)
	}
	session := readSession(ctx)
	ask := filter(missing, func(a string) bool { return a != CoreArea && !contains(session.Asked, a) })
	if len(ask) > 0 {
		out = append(out, "No "+joinWith(ask, " or ")+" principles yet. Ask once: capture a few now (wk guide principles), or carry on?")
		session.Asked = append(append([]string{}, session.Asked...), ask...)
		writeSession(ctx, session)
	}
	return out
}

// briefPrinciples: wk brief nudges for a principles session while the plan has none at all.
func briefPrinciples(_ *Ctx, s *Store) []string {
	anyRule := some(s.list(), func(i *Item) bool { return i.Kind == "principle" })
	work := some(s.list(), func(i *Item) bool { return i.Kind == "task" })
	if !anyRule && work {
		return []string{"No principles yet. Offer a principles session (wk guide principles)."}
	}
	return nil
}

func linksOf(i *Item) []string { return listOf(i.Data, "links") }

// startRelated: wk start shows what else matters for this task: items noticed while working on it,
// items it links to or that link to it, and its project's decisions.
func startRelated(_ *Ctx, s *Store, item *Item) []string {
	live := func(i *Item) bool {
		return i != item && (i.Kind != "task" || isOpen(i)) && str(i, "superseded_by") == ""
	}
	order := []string{}
	hits := map[string]*Item{}
	add := func(i *Item) {
		if _, ok := hits[i.ID]; !ok {
			order = append(order, i.ID)
		}
		hits[i.ID] = i
	}
	for _, i := range s.list() {
		if !live(i) {
			continue
		}
		if str(i, "from") == item.ID || contains(linksOf(i), item.ID) || contains(linksOf(item), i.ID) {
			add(i)
		}
	}
	if item.Home.Type == "project" {
		for _, d := range s.list() {
			if d.Kind == "decision" && d.Home.Name == item.Home.Name && live(d) {
				add(d)
			}
		}
	}
	if len(order) == 0 {
		return nil
	}
	lines := []string{"", "Related:"}
	for _, id := range head(order, 5) {
		i := hits[id]
		kind := ""
		if i.Kind != "task" {
			kind = i.Kind + " "
		}
		lines = append(lines, "  "+kind+i.ID+" "+i.Title+" ("+i.Home.Name+")")
	}
	if len(order) > 5 {
		lines = append(lines, "  +"+itoa(len(order)-5)+" more")
	}
	return lines
}
