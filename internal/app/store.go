package app

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var Kinds = []string{"task", "decision", "learning", "principle"}

const (
	InboxDir    = "inbox"
	AreasDir    = "areas"
	ProjectsDir = "projects"
	ArchiveDir  = "archive"
	AreaFile    = "area.md"
	CoreArea    = "core"
	ProjectFile = "project.md"
)

// itemOrder is the frontmatter key order, so files read the same and diffs stay small.
var itemOrder = []string{"id", "kind", "state", "when", "tags", "from", "links", "rank", "wait", "ref", "created", "updated", "done_on"}
var projectOrder = []string{"id", "kind", "state", "touches", "was", "ref", "created", "updated", "done_on"}

var areaNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,29}$`)

type Home struct {
	Type string // inbox, area or project
	// Name is the area name, the project id, or "inbox".
	Name string
	Dir  string
}

type Item struct {
	ID       string
	Kind     string
	Title    string
	Body     string
	Data     *OMap
	File     string
	Home     Home
	Archived bool
}

func str(i *Item, key string) string { return dataStr(i.Data, key) }

func dataStr(d *OMap, key string) string {
	v, ok := d.Get(key)
	if !ok || v == nil {
		return ""
	}
	return jsString(v)
}

func listOf(d *OMap, key string) []string {
	switch v := getV(d, key).(type) {
	case []string:
		return v
	case string:
		if v != "" {
			return []string{v}
		}
	}
	return []string{}
}

func tagsOf(i *Item) []string { return listOf(i.Data, "tags") }

var titleRe = regexp.MustCompile(`^# (.*)\r?\n?`)
var leadingBlank = regexp.MustCompile(`^[ \t\r\f\v]*\n`)

// splitTitle: the title is the body's first "# " heading; the rest is the body.
func splitTitle(text string) (string, string) {
	m := titleRe.FindStringSubmatchIndex(text)
	if m == nil {
		return "", text
	}
	title := Trim(text[m[2]:m[3]])
	rest := text[m[1]:]
	if loc := leadingBlankJS(rest); loc > 0 {
		rest = rest[loc:]
	}
	return title, TrimEnd(rest)
}

// leadingBlankJS matches /^\s*\n/: the longest run of whitespace from the start that ends in a newline.
func leadingBlankJS(s string) int {
	end := 0
	for i, r := range s {
		if !isJSSpace(r) {
			break
		}
		if r == '\n' {
			end = i + 1
		}
	}
	return end
}

func joinTitle(title, body string) string {
	if Trim(body) != "" {
		return "# " + title + "\n\n" + Trim(body)
	}
	return "# " + title
}

type Project struct {
	ID       string
	Title    string
	Body     string
	Data     *OMap
	Dir      string
	Archived bool
}

func touchesOf(p *Project) []string { return listOf(p.Data, "touches") }

func pstate(p *Project) string { return dataStr(p.Data, "state") }

type Store struct {
	ctx          *Ctx
	cache        []*Item
	cached       bool
	projectCache []*Project
	projCached   bool
}

func NewStore(ctx *Ctx) *Store { return &Store{ctx: ctx} }

func withID(data *OMap, id string) *OMap {
	d := data.Clone()
	d.Set("id", id)
	return d
}

func (s *Store) readProject(dir string, archived bool) *Project {
	m := idDirRe.FindStringSubmatch(filepath.Base(dir))
	file := filepath.Join(dir, ProjectFile)
	if m == nil || !exists(file) {
		return nil
	}
	data, body := parseFrontmatter(readFile(file))
	title, rest := splitTitle(body)
	return &Project{ID: m[1], Title: title, Body: rest, Data: withID(data, m[1]), Dir: dir, Archived: archived}
}

// projects are open and closed projects that aren't archived.
func (s *Store) projects() []*Project {
	if !s.projCached {
		s.projCached = true
		s.projectCache = []*Project{}
		dir := filepath.Join(s.ctx.Root, ProjectsDir)
		for _, e := range readDir(dir) {
			if p := s.readProject(filepath.Join(dir, e.Name()), false); p != nil {
				s.projectCache = append(s.projectCache, p)
			}
		}
	}
	return s.projectCache
}

func (s *Store) archivedProjects() []*Project {
	out := []*Project{}
	dir := filepath.Join(s.ctx.Root, ArchiveDir)
	for _, year := range readDir(dir) {
		yd := filepath.Join(dir, year.Name())
		if !isDir(yd) {
			continue
		}
		for _, d := range readDir(yd) {
			if p := s.readProject(filepath.Join(yd, d.Name()), true); p != nil {
				out = append(out, p)
			}
		}
	}
	return out
}

func (s *Store) project(raw string) *Project {
	prefix := strings.ToLower(Trim(raw))
	hits := filter(s.projects(), func(p *Project) bool {
		return strings.HasPrefix(p.ID, prefix) || dataStr(p.Data, "was") == strings.ToUpper(Trim(raw)) && getV(p.Data, "was") != nil
	})
	if len(hits) == 0 {
		hits = filter(s.archivedProjects(), func(p *Project) bool { return strings.HasPrefix(p.ID, prefix) })
	}
	if len(hits) == 0 {
		fail("No project " + raw + ".")
	}
	if len(hits) > 1 {
		fail(prefix + " matches " + itoa(len(hits)) + " projects: " + strings.Join(mapList(hits, func(p *Project) string { return p.ID }), ", ") + ". Type more of the id.")
	}
	return hits[0]
}

func (s *Store) projectHome(p *Project) Home { return Home{Type: "project", Name: p.ID, Dir: p.Dir} }

// resolveHome takes "inbox", an area name, or a project id (any unique start of it).
func (s *Store) resolveHome(raw string) Home {
	w := strings.ToLower(Trim(raw))
	if w == "inbox" {
		return Home{Type: "inbox", Name: "inbox", Dir: filepath.Join(s.ctx.Root, InboxDir)}
	}
	if contains(s.areas(), w) {
		return s.area(w)
	}
	projects := filter(s.projects(), func(p *Project) bool { return strings.HasPrefix(p.ID, w) && pstate(p) != "done" })
	if len(projects) == 1 {
		return s.projectHome(projects[0])
	}
	if len(projects) > 1 {
		fail(w + " matches " + itoa(len(projects)) + " projects. Type more of the id.")
	}
	fail(`No home "` + raw + `". Use inbox, an area (` + strings.Join(s.areas(), ", ") + `) or an open project id.`)
	return Home{}
}

func (s *Store) createProject(title, body string, data *OMap) *Project {
	id := newID(s.takenIDs(), s.ctx.Pick)
	dir := filepath.Join(s.ctx.Root, ProjectsDir, id+"-"+slugify(title))
	d := Obj("id", id, "kind", "project").Spread(data)
	d.Set("created", s.ctx.Today)
	d.Set("updated", s.ctx.Today)
	p := &Project{ID: id, Title: title, Body: body, Data: d, Dir: dir}
	s.writeProject(p)
	s.projects()
	s.projectCache = append(s.projectCache, p)
	return p
}

func (s *Store) saveProject(p *Project) {
	p.Data.Set("updated", s.ctx.Today)
	want := filepath.Join(filepath.Dir(p.Dir), p.ID+"-"+slugify(p.Title))
	if want != p.Dir {
		must(os.Rename(p.Dir, want))
		p.Dir = want
		s.cached = false
	}
	s.writeProject(p)
}

func (s *Store) writeProject(p *Project) {
	mkdirAll(p.Dir)
	writeFile(filepath.Join(p.Dir, ProjectFile), stringifyFrontmatter(p.Data, joinTitle(p.Title, p.Body), projectOrder))
}

// archiveProject moves a closed project's whole folder to archive/<year>/.
func (s *Store) archiveProject(p *Project, year string) {
	dest := filepath.Join(s.ctx.Root, ArchiveDir, year, filepath.Base(p.Dir))
	mkdirAll(filepath.Dir(dest))
	must(os.Rename(p.Dir, dest))
	p.Dir = dest
	p.Archived = true
	s.cached = false
	s.projCached = false
}

func (s *Store) createArea(name, description string) Home {
	if !areaNameRe.MatchString(name) {
		fail("Area names are lowercase letters, digits and dashes, like ui or front-end.")
	}
	if contains(s.areas(), name) {
		fail("Area " + name + " already exists.")
	}
	dir := filepath.Join(s.ctx.Root, AreasDir, name)
	mkdirAll(dir)
	writeFile(filepath.Join(dir, AreaFile), "# "+name+"\n\n"+description+"\n")
	return Home{Type: "area", Name: name, Dir: dir}
}

func (s *Store) areaDescription(name string) string {
	file := filepath.Join(s.ctx.Root, AreasDir, name, AreaFile)
	if !exists(file) {
		return ""
	}
	_, body := splitTitle(crlf(readFile(file)))
	return Trim(body)
}

// attachments are the files that travel with an item: <id>-<n>.<ext> next to it.
func (s *Store) attachments(i *Item) []string {
	dir := filepath.Dir(i.File)
	re := regexp.MustCompile(`(?i)^` + i.ID + `-\d+\.[a-z0-9]+$`)
	out := []string{}
	for _, e := range readDir(dir) {
		if re.MatchString(e.Name()) {
			out = append(out, filepath.Join(dir, e.Name()))
		}
	}
	return out
}

// attach copies a file next to the item as <id>-<n>.<ext> and lists it in files.
func (s *Store) attach(i *Item, source string) string {
	if !exists(source) {
		fail("File not found: " + source)
	}
	n := len(s.attachments(i)) + 1
	ext := strings.ToLower(filepath.Ext(source))
	if ext == "" || ext == filepath.Base(source) {
		ext = ".bin"
	}
	name := i.ID + "-" + itoa(n) + ext
	copyFile(source, filepath.Join(filepath.Dir(i.File), name))
	files := []string{}
	if f, ok := getV(i.Data, "files").([]string); ok {
		files = append(files, f...)
	}
	i.Data.Set("files", append(files, name))
	s.write(i)
	return name
}

// moveTo moves an item, and its attachments, to another home.
func (s *Store) moveTo(i *Item, home Home) {
	if i.Home.Dir == home.Dir {
		return
	}
	mkdirAll(home.Dir)
	for _, f := range s.attachments(i) {
		must(os.Rename(f, filepath.Join(home.Dir, filepath.Base(f))))
	}
	dest := filepath.Join(home.Dir, filepath.Base(i.File))
	must(os.Rename(i.File, dest))
	i.File = dest
	i.Home = home
}

// archive moves a finished item to archive/<year>/<home path>/, attachments too.
func (s *Store) archive(i *Item, year string) {
	rel, _ := filepath.Rel(s.ctx.Root, filepath.Dir(i.File))
	dir := filepath.Join(s.ctx.Root, ArchiveDir, year, rel)
	h := i.Home
	h.Dir = dir
	s.moveTo(i, h)
	i.Archived = true
	s.dropCached(i)
}

func (s *Store) dropCached(i *Item) {
	s.cache = filter(s.cache, func(x *Item) bool { return x != i })
}

func (s *Store) remove(i *Item) {
	for _, f := range s.attachments(i) {
		must(os.Remove(f))
	}
	must(os.Remove(i.File))
	s.dropCached(i)
}

func (s *Store) homeDirs() []Home {
	root := s.ctx.Root
	homes := []Home{{Type: "inbox", Name: "inbox", Dir: filepath.Join(root, InboxDir)}}
	for _, name := range s.areas() {
		homes = append(homes, Home{Type: "area", Name: name, Dir: filepath.Join(root, AreasDir, name)})
	}
	projects := filepath.Join(root, ProjectsDir)
	for _, d := range readDir(projects) {
		if m := idDirRe.FindStringSubmatch(d.Name()); m != nil {
			homes = append(homes, Home{Type: "project", Name: m[1], Dir: filepath.Join(projects, d.Name())})
		}
	}
	return homes
}

func (s *Store) read(file string, home Home, archived bool) *Item {
	m := itemFileRe.FindStringSubmatch(filepath.Base(file))
	if m == nil {
		return nil
	}
	data, body := parseFrontmatter(readFile(file))
	title, rest := splitTitle(body)
	kind := "task"
	if k := dataStr(data, "kind"); contains(Kinds, k) && getV(data, "kind") != nil {
		kind = k
	}
	return &Item{ID: m[1], Kind: kind, Title: title, Body: rest, Data: withID(data, m[1]), File: file, Home: home, Archived: archived}
}

// areas are the folders under areas/ that hold an area.md, sorted.
func (s *Store) areas() []string {
	dir := filepath.Join(s.ctx.Root, AreasDir)
	out := []string{}
	for _, e := range readDir(dir) {
		if exists(filepath.Join(dir, e.Name(), AreaFile)) {
			out = append(out, e.Name())
		}
	}
	return out
}

func (s *Store) area(name string) Home {
	if !contains(s.areas(), name) {
		fail(`No area "` + name + `". Areas: ` + strings.Join(s.areas(), ", "))
	}
	return Home{Type: "area", Name: name, Dir: filepath.Join(s.ctx.Root, AreasDir, name)}
}

// list is every item that isn't archived.
func (s *Store) list() []*Item {
	if !s.cached {
		s.cached = true
		s.cache = []*Item{}
		for _, home := range s.homeDirs() {
			for _, f := range readDir(home.Dir) {
				if f.IsDir() {
					continue
				}
				if i := s.read(filepath.Join(home.Dir, f.Name()), home, false); i != nil {
					s.cache = append(s.cache, i)
				}
			}
		}
	}
	return s.cache
}

// archived items are read on demand: only lookups by id and --archived lists need them.
func (s *Store) archived() []*Item {
	out := []*Item{}
	var walk func(dir string)
	walk = func(dir string) {
		for _, e := range readDir(dir) {
			p := filepath.Join(dir, e.Name())
			if e.IsDir() {
				walk(p)
			} else if i := s.read(p, Home{Type: "area", Name: filepath.Base(dir), Dir: dir}, true); i != nil {
				out = append(out, i)
			}
		}
	}
	walk(filepath.Join(s.ctx.Root, ArchiveDir))
	return out
}

// takenIDs is every id in use anywhere in the plan, archive and project folders included.
func (s *Store) takenIDs() map[string]bool {
	taken := map[string]bool{}
	var walk func(dir string)
	walk = func(dir string) {
		for _, e := range readDir(dir) {
			re := itemFileRe
			if e.IsDir() {
				re = idDirRe
			}
			if m := re.FindStringSubmatch(e.Name()); m != nil {
				taken[m[1]] = true
			}
			if e.IsDir() {
				walk(filepath.Join(dir, e.Name()))
			}
		}
	}
	walk(s.ctx.Root)
	return taken
}

var v1IDRe = regexp.MustCompile(`(?i)^([ETIDL])(-?)(\d+)$`)

// get finds an item by its id or any unique start of it.
func (s *Store) get(raw string) *Item {
	// A v1 id, kept as was by wk migrate, so old commit messages and handoffs still resolve.
	// "T-013" is always a v1 id; "t13" only when no v2 id starts that way ("d869" is a fine v2 id).
	v1 := v1IDRe.FindStringSubmatch(Trim(raw))
	byWas := func() *Item {
		num := v1[3]
		if len(num) < 3 {
			num = strings.Repeat("0", 3-len(num)) + num
		}
		was := strings.ToUpper(v1[1]) + "-" + num
		for _, i := range s.list() {
			if dataStr(i.Data, "was") == was {
				return i
			}
		}
		for _, i := range s.archived() {
			if dataStr(i.Data, "was") == was {
				return i
			}
		}
		fail("No item " + was + ".")
		return nil
	}
	if v1 != nil && v1[2] == "-" {
		return byWas()
	}
	prefix := strings.ToLower(Trim(raw))
	if !isIDPrefix(prefix) {
		if v1 != nil {
			return byWas()
		}
		fail(`"` + raw + `" is not an id. Ids look like r8vn.`)
	}
	match := func(i *Item) bool { return strings.HasPrefix(i.ID, prefix) }
	matches := filter(s.list(), match)
	if len(matches) == 0 {
		matches = filter(s.archived(), match)
	}
	if len(matches) == 0 && v1 != nil {
		return byWas()
	}
	if len(matches) == 0 {
		fail("No item " + prefix + ".")
	}
	if len(matches) > 1 {
		ids := strings.Join(mapList(head(matches, 5), func(i *Item) string { return i.ID }), ", ")
		fail(prefix + " matches " + itoa(len(matches)) + " items: " + ids + ". Type more of the id.")
	}
	return matches[0]
}

func (s *Store) create(kind string, home Home, title, body string, data *OMap) *Item {
	id := newID(s.takenIDs(), s.ctx.Pick)
	d := Obj("id", id, "kind", kind).Spread(data)
	d.Set("created", s.ctx.Today)
	d.Set("updated", s.ctx.Today)
	i := &Item{ID: id, Kind: kind, Title: title, Body: body, Data: d, File: filepath.Join(home.Dir, id+"-"+slugify(title)+".md"), Home: home}
	s.write(i)
	s.list()
	s.cache = append(s.cache, i)
	return i
}

// save writes an item, renaming its file when the title changed.
func (s *Store) save(i *Item) {
	i.Data.Set("updated", s.ctx.Today)
	want := filepath.Join(filepath.Dir(i.File), i.ID+"-"+slugify(i.Title)+".md")
	if want != i.File {
		must(os.Rename(i.File, want))
		i.File = want
	}
	s.write(i)
}

// persist writes an item exactly as it is, keeping its dates; for wk migrate.
func (s *Store) persist(i *Item) { s.write(i) }

func (s *Store) persistProject(p *Project) { s.writeProject(p) }

func (s *Store) write(i *Item) {
	mkdirAll(filepath.Dir(i.File))
	writeFile(i.File, stringifyFrontmatter(i.Data, joinTitle(i.Title, i.Body), itemOrder))
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func copyFile(src, dst string) {
	in, err := os.Open(src)
	must(err)
	defer in.Close()
	out, err := os.Create(dst)
	must(err)
	defer out.Close()
	_, err = io.Copy(out, in)
	must(err)
}
