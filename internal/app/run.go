package app

import (
	"fmt"
	"io"
	"os"
	"runtime/debug"
	"sort"
	"strings"
)

// RunOptions mirror the TS run() options; empty values fall back to the environment.
type RunOptions struct {
	Cwd   string
	Today string
	Home  string
	Stdin io.Reader
	Pick  Pick
	Now   string
	// Stdout and Stderr receive output from long-running commands (wk board --serve) as it happens.
	Stdout func(string)
	Stderr func(string)
}

type RunOutput struct {
	Code   int
	Stdout string
	Stderr string
}

type argSpec struct {
	name     string
	required bool
	variadic bool
}

type optSpec struct {
	long   string // without dashes
	value  string // "<home>" for value options, "" for flags
	desc   string
	repeat bool
	negate bool // --no-<long>
}

type call struct {
	args []string
	opts *Opts
	// set lists options given on the command line (commander's "cli" value source).
	set map[string]bool
}

type command struct {
	name      string
	args      []argSpec
	desc      string
	opts      []optSpec
	subs      []*command
	isDefault bool
	run       func(r *runner, c *call)
}

func (c *command) usage() string {
	parts := []string{}
	if len(c.opts) > 0 {
		parts = append(parts, "[options]")
	}
	if len(c.subs) > 0 {
		parts = append(parts, "[command]")
	}
	for _, a := range c.args {
		parts = append(parts, argLabel(a))
	}
	return strings.Join(parts, " ")
}

func argLabel(a argSpec) string {
	n := a.name
	if a.variadic {
		n += "..."
	}
	if a.required {
		return "<" + n + ">"
	}
	return "[" + n + "]"
}

func (o optSpec) flags() string {
	f := "--" + o.long
	if o.negate {
		f = "--no-" + o.long
	}
	if o.value != "" {
		f += " " + o.value
	}
	return f
}

type usageError struct{ msg string }

type helpShown struct{ text string }

type runner struct {
	o     RunOptions
	today string
	pick  Pick
	json  bool
	all   bool
	out   []string
	root  *command
	code  int
}

func (r *runner) emit(res Result) { r.out = append(r.out, render(res, r.json, r.all)) }

// act runs a command against the plan and logs what changed, for the board: a snapshot before and
// after, so no command has to remember to.
func (r *runner) act(fn func(ctx *Ctx, s *Store) Result) {
	ctx := loadContext(r.o.Cwd, r.today, r.o.Home, r.pick)
	s := NewStore(ctx)
	before := takeSnapshot(s)
	r.emit(fn(ctx, s))
	after := NewStore(ctx)
	var known map[string]bool
	archived := func(id string) bool {
		if known == nil {
			known = map[string]bool{}
			for _, i := range after.archived() {
				known[i.ID] = true
			}
			for _, p := range after.archivedProjects() {
				known[p.ID] = true
			}
		}
		return known[id]
	}
	now := r.o.Now
	if now == "" {
		now = nowISO()
	}
	appendEvents(ctx, diffSnapshots(before, takeSnapshot(after), archived), now)
	refreshBoard(ctx)
}

func flag(long, desc string) optSpec       { return optSpec{long: long, desc: desc} }
func val(long, value, desc string) optSpec { return optSpec{long: long, value: value, desc: desc} }
func list(long, value, desc string) optSpec {
	return optSpec{long: long, value: value, desc: desc, repeat: true}
}
func req(name string) argSpec { return argSpec{name: name, required: true} }
func opt(name string) argSpec { return argSpec{name: name} }
func (c *call) arg(i int) (string, bool) {
	if i < len(c.args) {
		return c.args[i], true
	}
	return "", false
}

func commands() *command {
	whenHelp := "next, queue, later, someday, after:<id>, end:<project>, start:<area>, on:<date>"
	root := &command{name: "wk", desc: "Track work in plain text: tasks, decisions, learnings and principles, in projects and areas.",
		opts: []optSpec{flag("json", "machine-readable output"), flag("all", "lift the 10-line output limit"), flag("version", "print the wk version")}}
	add := func(c *command) *command { root.subs = append(root.subs, c); return c }

	add(&command{name: "init", desc: "set up the plan",
		opts: []optSpec{val("store", "<where>", "repo, ignore (.gitignore), local (.git/info/exclude) or home (~/.wk)"),
			val("preset", "<preset>", "software (default in a git repo) or general: seeds tags and a starting area")},
		run: func(r *runner, c *call) {
			store, hasStore := c.opts.Str("store")
			preset, hasPreset := c.opts.Str("preset")
			r.emit(initCmd(r.o.Cwd, store, preset, hasStore, hasPreset, r.o.Home))
		}})
	add(&command{name: "guide", args: []argSpec{opt("topic")}, desc: "print the agent rules, or a guide: " + strings.Join(GuideTopics, ", "),
		run: func(r *runner, c *call) { t, ok := c.arg(0); r.emit(guide(t, ok)) }})
	add(&command{name: "migrate", desc: "convert a v1 plan in place; old ids stay findable (wk show T-013)",
		run: func(r *runner, c *call) { r.emit(migrate(r.o.Cwd, r.today, r.o.Home, r.pick)) }})
	add(&command{name: "setup", desc: "list agent instruction files and the stored workflow; --done records their fingerprints",
		opts: []optSpec{flag("done", "record the instruction files as checked")},
		run:  func(r *runner, c *call) { r.act(func(ctx *Ctx, s *Store) Result { return setupCmd(ctx, s, c.opts) }) }})
	add(&command{name: "add", args: []argSpec{opt("title")}, desc: "add a sorted task: in core unless --in says otherwise, at the bottom of the queue",
		opts: []optSpec{val("in", "<home>", "an area or a project id"), val("when", "<when>", "next, queue (default), later, someday, after:<id>, end:<project>, start:<area>, on:<date>"),
			val("body", "<text>", "short notes, 6 lines max"), val("tags", "<tags>", "comma-separated tags, e.g. bug,quick"),
			flag("force", "add even if a similar task exists"), val("from", "<file>", "one title per line from a file, or - for stdin; all or nothing")},
		run: func(r *runner, c *call) {
			title, _ := c.arg(0)
			if from, ok := c.opts.Str("from"); ok {
				if title != "" {
					fail("Give a title or --from, not both.")
				}
				var input string
				if from == "-" {
					in := r.o.Stdin
					if in == nil {
						in = os.Stdin
					}
					b, _ := io.ReadAll(in)
					input = string(b)
				} else {
					file := resolvePath(r.o.Cwd, from)
					if !exists(file) {
						fail("File not found: " + file)
					}
					input = readFile(file)
				}
				r.act(func(ctx *Ctx, s *Store) Result { return addMany(ctx, s, input, c.opts) })
				return
			}
			if title == "" {
				fail(`Give a title: wk add "<title>" (or --from <file>)`)
			}
			r.act(func(ctx *Ctx, s *Store) Result { return addTask(ctx, s, title, c.opts) })
		}})
	add(&command{name: "show", args: []argSpec{req("id")}, desc: "print one item in full; any unique start of the id works",
		run: func(r *runner, c *call) { r.act(func(ctx *Ctx, s *Store) Result { return show(ctx, s, c.args[0]) }) }})
	add(&command{name: "ls", args: []argSpec{{name: "words", variadic: true}}, desc: "list items; each word filters by kind, state, when, home, tag or id (e.g. wk ls bug ui someday)",
		opts: []optSpec{flag("archived", "list archived items instead")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return ls(ctx, s, c.args, c.opts.Flag("archived")) })
		}})
	add(&command{name: "move", args: []argSpec{req("id")}, desc: "sort an inbox item, change a home or when, or reorder the queue",
		opts: []optSpec{val("in", "<home>", "an area or a project id"), val("when", "<when>", whenHelp),
			val("before", "<id>", "just ahead of this queued task"), val("after", "<id>", "just behind this queued task"),
			flag("top", "first in the queue"), flag("bottom", "last in the queue")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return move(ctx, s, c.args[0], c.opts) })
		}})

	project := add(&command{name: "project", desc: "projects: work with an end"})
	project.subs = []*command{
		{name: "list", isDefault: true, desc: "open projects with progress, then open counts per area",
			run: func(r *runner, c *call) { r.act(projectList) }},
		{name: "new", args: []argSpec{req("title")}, desc: "start a project",
			opts: []optSpec{val("touches", "<areas>", "comma-separated areas it touches; their principles load for its tasks"), val("body", "<text>", "goal and acceptance")},
			run: func(r *runner, c *call) {
				r.act(func(ctx *Ctx, s *Store) Result { return projectNew(ctx, s, c.args[0], c.opts) })
			}},
		{name: "show", args: []argSpec{req("id")}, desc: "one project with its tasks, decisions and learnings",
			run: func(r *runner, c *call) {
				r.act(func(ctx *Ctx, s *Store) Result { return projectShow(ctx, s, c.args[0]) })
			}},
		{name: "close", args: []argSpec{req("id")}, desc: "close a finished project: offers learnings to distill, fires end: triggers, archives it",
			run: func(r *runner, c *call) {
				r.act(func(ctx *Ctx, s *Store) Result { return projectClose(ctx, s, c.args[0]) })
			}},
	}
	add(&command{name: "review", desc: "the weekly review: inbox, due, stale, waiting, empty projects, principles, duplicates",
		opts: []optSpec{flag("done", "record that the review happened")},
		run:  func(r *runner, c *call) { r.act(func(ctx *Ctx, s *Store) Result { return review(ctx, s, c.opts) }) }})
	area := add(&command{name: "area", desc: "areas: ongoing responsibilities that never end"})
	area.subs = []*command{
		{name: "list", isDefault: true, desc: "areas with open tasks and principle counts",
			run: func(r *runner, c *call) { r.act(areaList) }},
		{name: "new", args: []argSpec{req("name"), opt("description")}, desc: `create an area, e.g. wk area new ui "Screens, layout and styling"`,
			run: func(r *runner, c *call) {
				d, _ := c.arg(1)
				r.act(func(ctx *Ctx, s *Store) Result { return areaNew(ctx, s, c.args[0], d) })
			}},
	}
	add(&command{name: "brief", isDefault: true, desc: "summary, workflow, handoff, now and next; first call of a session",
		run: func(r *runner, c *call) {
			// brief is the default, so a mistyped command lands here: say so instead of briefing.
			if len(c.args) > 0 {
				fail(`Unknown command "` + c.args[0] + `". See wk --help.`)
			}
			r.act(brief)
		}})
	add(&command{name: "tags", desc: "tags in use, with counts, and the ones the plan knows",
		run: func(r *runner, c *call) { r.act(tagsList) }})
	add(&command{name: "next", desc: "now, up to 5 queued, due and waiting tasks",
		run: func(r *runner, c *call) { r.act(nextCmd) }})
	add(&command{name: "start", args: []argSpec{req("id")}, desc: "set a task to now (one at a time); prints its body and what applies",
		opts: []optSpec{flag("branch", "make a <id>-<slug> branch for it"), {long: "branch", negate: true, desc: "stay on the current branch even if config says to branch"}},
		run: func(r *runner, c *call) {
			var b *bool
			if c.set["branch"] {
				v := c.opts.Flag("branch")
				b = &v
			}
			r.act(func(ctx *Ctx, s *Store) Result { return start(ctx, s, c.args[0], b) })
		}})
	add(&command{name: "check", desc: "move the now task to review; record automated checks and what a person should try",
		opts: []optSpec{list("test", "<text>", "for a person: how it looks, feels, reads or responds (repeatable)"),
			list("checked", "<result>", `an automated check you already ran, e.g. "75 tests pass" (repeatable)`),
			val("handoff", "<text>", "also save the handoff (5 lines max)"), flag("fresh", "the handoff recommends a fresh session")},
		run: func(r *runner, c *call) { r.act(func(ctx *Ctx, s *Store) Result { return check(ctx, s, c.opts) }) }})
	add(&command{name: "done", args: []argSpec{req("id")}, desc: "finish a reviewed task",
		opts: []optSpec{flag("force", "skip review for a trivial task"), val("handoff", "<text>", "the handoff; without it, one is written from the next task"),
			flag("fresh", "the handoff recommends a fresh session")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return done(ctx, s, c.args[0], c.opts) })
		}})
	add(&command{name: "wait", args: []argSpec{req("id"), opt("on")}, desc: "mark a task as waiting on something: a decision, a person, another item",
		opts: []optSpec{flag("clear", "it's no longer waiting")},
		run: func(r *runner, c *call) {
			on, _ := c.arg(1)
			r.act(func(ctx *Ctx, s *Store) Result { return wait(ctx, s, c.args[0], on, c.opts) })
		}})
	add(&command{name: "handoff", args: []argSpec{req("text")}, desc: "overwrite the handoff, 5 lines max; at every stop",
		opts: []optSpec{flag("fresh", "the handoff recommends a fresh session")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return handoffCmd(ctx, s, c.args[0], c.opts) })
		}})
	add(&command{name: "config", args: []argSpec{opt("action"), opt("key"), opt("value")},
		desc: "show settings, or: wk config set <key> <value> (git.branch, git.commit, commit_style, checks.quick, checks.full, tracker, preset, tags)",
		run: func(r *runner, c *call) {
			action, _ := c.arg(0)
			key, _ := c.arg(1)
			value, hasValue := c.arg(2)
			r.act(func(ctx *Ctx, s *Store) Result { return configure(ctx, action, key, value, hasValue) })
		}})
	add(&command{name: "decide", args: []argSpec{req("what")}, desc: "record a decision in the current home (the now task's, else core)",
		opts: []optSpec{val("why", "<why>", "the reason, 2 lines max"), val("rejected", "<text>", "what was rejected, 1 line"), val("in", "<home>", "an area or a project id")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return decide(ctx, s, c.args[0], c.opts) })
		}})
	add(&command{name: "learn", args: []argSpec{req("text")}, desc: "record something surprising, 2 lines max, in the current home",
		opts: []optSpec{val("in", "<home>", "an area or a project id")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return learn(ctx, s, c.args[0], c.opts) })
		}})
	add(&command{name: "principle", args: []argSpec{req("rule")}, desc: "a rule a capable model would otherwise get wrong: do X, instead of Y, because Z",
		opts: []optSpec{val("instead", "<default>", "the default it overrides, 1 line"), val("because", "<why>", "the reason, 2 lines max"),
			val("in", "<area>", "the area it belongs to (default core: applies everywhere)"), val("from", "<id>", "the learning or decision it distills"),
			val("test", "<ref>", "a check that enforces it")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return principle(ctx, s, c.args[0], c.opts) })
		}})
	add(&command{name: "supersede", args: []argSpec{req("old"), req("new")}, desc: "mark a decision or principle as replaced",
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return supersede(ctx, s, c.args[0], c.args[1]) })
		}})
	add(&command{name: "edit", args: []argSpec{req("id")}, desc: "rewrite an item in place; the same limits apply",
		opts: []optSpec{val("title", "<title>", "new title (renames the file)"), val("body", "<text>", "new body"), val("tags", "<tags>", "replace tags"),
			val("instead", "<default>", "principles: the default it overrides"), val("because", "<why>", "principles: the reason"),
			val("ref", "<text>", "free-text reference, e.g. a ticket id")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return edit(ctx, s, c.args[0], c.opts) })
		}})
	add(&command{name: "drop", args: []argSpec{req("id")}, desc: "delete a task, jot or learning that is no longer wanted",
		run: func(r *runner, c *call) { r.act(func(ctx *Ctx, s *Store) Result { return drop(ctx, s, c.args[0]) }) }})
	add(&command{name: "merge", args: []argSpec{req("keep"), req("drop")}, desc: "fold a duplicate into another item of the same kind and delete it",
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return merge(ctx, s, c.args[0], c.args[1]) })
		}})
	add(&command{name: "jot", args: []argSpec{req("text")}, desc: "capture a thought mid-task, no questions: into the inbox, sorted at the check-in",
		opts: []optSpec{list("file", "<path>", "attach a file next to it (repeatable); describe screenshots in the text instead when you can")},
		run: func(r *runner, c *call) {
			r.act(func(ctx *Ctx, s *Store) Result { return jot(ctx, s, c.args[0], c.opts) })
		}})
	add(&command{name: "inbox", desc: "list jots waiting to be sorted",
		run: func(r *runner, c *call) { r.act(inbox) }})
	add(&command{name: "board", desc: "the plan as an HTML page: now, queue, due, waiting, projects, areas and principles",
		opts: []optSpec{flag("open", "open it in the browser"), val("out", "<file>", "where to write it (default: ~/.wk/boards/, outside the plan)"),
			flag("serve", "serve it live on localhost; it refreshes whenever the plan changes (Ctrl+C to stop)"),
			val("port", "<port>", fmt.Sprintf("port for --serve (default %d, or the next free one)", DefaultPort))},
		run: func(r *runner, c *call) {
			if c.opts.Flag("serve") {
				ctx := loadContext(r.o.Cwd, r.today, r.o.Home, r.pick)
				r.code = serveCommand(ctx, c.opts, r.o.Stdout, r.o.Stderr)
				return
			}
			r.act(func(ctx *Ctx, s *Store) Result { return boardCmd(ctx, s, c.opts) })
		}})
	add(&command{name: "summary", args: []argSpec{opt("text")}, desc: "show the plan summary, or overwrite it (8 lines max)",
		run: func(r *runner, c *call) {
			t, ok := c.arg(0)
			r.act(func(ctx *Ctx, s *Store) Result { return summaryCmd(ctx, s, t, ok) })
		}})
	return root
}

// Run runs one wk command in-process. argv excludes the program name.
func Run(argv []string, o RunOptions) (res RunOutput) {
	if o.Cwd == "" {
		o.Cwd, _ = os.Getwd()
	}
	if o.Stdout == nil {
		o.Stdout = func(s string) { fmt.Fprintln(os.Stdout, s) }
	}
	if o.Stderr == nil {
		o.Stderr = func(s string) { fmt.Fprintln(os.Stderr, s) }
	}
	today := o.Today
	if today == "" {
		today = os.Getenv("WK_TODAY")
	}
	if today == "" {
		today = todayString()
	}
	pick := o.Pick
	if pick == nil {
		pick = envPick()
	}
	r := &runner{o: o, today: today, pick: pick, root: commands()}
	jsonMode := contains(argv, "--json")

	defer func() {
		rec := recover()
		if rec == nil {
			return
		}
		stdout := strings.Join(r.out, "\n")
		switch e := rec.(type) {
		case usageError:
			res = RunOutput{Code: 1, Stdout: stdout, Stderr: e.msg}
		case helpShown:
			res = RunOutput{Code: 0, Stdout: e.text}
		case *WkError:
			if jsonMode {
				res = RunOutput{Code: 1, Stdout: JSONStringify(Obj("error", e.Msg))}
			} else {
				res = RunOutput{Code: 1, Stdout: stdout, Stderr: e.Msg}
			}
		default:
			msg := fmt.Sprintf("Unexpected error: %v\n%s", rec, debug.Stack())
			if jsonMode {
				res = RunOutput{Code: 1, Stdout: JSONStringify(Obj("error", msg))}
			} else {
				res = RunOutput{Code: 1, Stdout: stdout, Stderr: msg}
			}
		}
	}()

	// Global options apply anywhere before "--", as commander reads them.
	rest := []string{}
	for i, a := range argv {
		if a == "--" {
			rest = append(rest, argv[i:]...)
			break
		}
		switch a {
		case "--json":
			r.json = true
		case "--all":
			r.all = true
		default:
			rest = append(rest, a)
		}
	}
	r.dispatch(r.root, rest, []*command{})
	out := filter(r.out, func(s string) bool { return s != "" })
	return RunOutput{Code: r.code, Stdout: strings.Join(out, "\n")}
}

func findSub(c *command, name string) *command {
	for _, s := range c.subs {
		if s.name == name {
			return s
		}
	}
	return nil
}

func defaultSub(c *command) *command {
	for _, s := range c.subs {
		if s.isDefault {
			return s
		}
	}
	return nil
}

func isHelp(a string) bool { return a == "-h" || a == "--help" }

func (r *runner) dispatch(c *command, args []string, path []*command) {
	path = append(path, c)
	if len(c.subs) > 0 {
		// Help for this command when asked before any subcommand.
		if len(args) > 0 && isHelp(args[0]) {
			panic(helpShown{helpText(c, path)})
		}
		if c == r.root && len(args) > 0 && args[0] == "--version" {
			panic(helpShown{"wk " + BuildVersion})
		}
		if c == r.root && len(args) > 0 && args[0] == "help" {
			target := c
			for _, name := range args[1:] {
				if s := findSub(target, name); s != nil {
					target = s
					path = append(path, s)
				}
			}
			panic(helpShown{helpText(target, path)})
		}
		if len(args) > 0 {
			if s := findSub(c, args[0]); s != nil {
				r.dispatch(s, args[1:], path)
				return
			}
		}
		if d := defaultSub(c); d != nil {
			r.dispatch(d, args, path)
			return
		}
		panic(helpShown{helpText(c, path)})
	}
	call := r.parse(c, args, path)
	c.run(r, call)
}

// parse reads a command's options and arguments the way commander does.
func (r *runner) parse(c *command, args []string, path []*command) *call {
	o := newOpts()
	set := map[string]bool{}
	operands := []string{}
	find := func(name string) (optSpec, bool) {
		for _, s := range c.opts {
			if (!s.negate && name == s.long) || (s.negate && name == "no-"+s.long) {
				return s, true
			}
		}
		return optSpec{}, false
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			operands = append(operands, args[i+1:]...)
			break
		}
		if isHelp(a) {
			panic(helpShown{helpText(c, path)})
		}
		if strings.HasPrefix(a, "-") && len(a) > 1 {
			name, value, hasValue := strings.Cut(strings.TrimLeft(a, "-"), "=")
			spec, ok := find(name)
			if !ok || !strings.HasPrefix(a, "--") {
				panic(usageError{"error: unknown option '" + strings.SplitN(a, "=", 2)[0] + "'" + suggestOption(strings.SplitN(a, "=", 2)[0], c)})
			}
			set[spec.long] = true
			if spec.value == "" {
				if hasValue {
					panic(usageError{"error: option '" + spec.flags() + "' does not take an argument"})
				}
				o.flags[spec.long] = !spec.negate
				continue
			}
			if !hasValue {
				if i+1 >= len(args) {
					panic(usageError{"error: option '" + spec.flags() + "' argument missing"})
				}
				i++
				value = args[i]
			}
			if spec.repeat {
				o.lists[spec.long] = append(o.lists[spec.long], value)
			} else {
				o.vals[spec.long] = value
			}
			o.order = appendOnce(o.order, spec.long)
			continue
		}
		operands = append(operands, a)
	}
	for i, a := range c.args {
		if a.required && i >= len(operands) {
			panic(usageError{"error: missing required argument '" + a.name + "'"})
		}
	}
	return &call{args: operands, opts: o, set: set}
}

func appendOnce(list []string, s string) []string {
	if contains(list, s) {
		return list
	}
	return append(list, s)
}

// suggestOption is commander's "(Did you mean …?)" for a mistyped option.
func suggestOption(word string, c *command) string {
	candidates := []string{}
	for _, s := range c.opts {
		candidates = append(candidates, strings.SplitN(s.flags(), " ", 2)[0])
	}
	candidates = append(candidates, "--help", "--json", "--all", "--help")
	candidates = uniq(candidates)
	searching := strings.HasPrefix(word, "--")
	if searching {
		word = word[2:]
		for i := range candidates {
			candidates[i] = strings.TrimPrefix(candidates[i], "--")
		}
	}
	similar := []string{}
	best := 3
	for _, cand := range candidates {
		if len(cand) <= 1 {
			continue
		}
		d := osaDistance(word, cand)
		length := max(len(word), len(cand))
		if float64(length-d)/float64(length) > 0.4 {
			if d < best {
				best = d
				similar = []string{cand}
			} else if d == best {
				similar = append(similar, cand)
			}
		}
	}
	sort.SliceStable(similar, func(i, j int) bool { return LocaleCompare(similar[i], similar[j]) < 0 })
	if searching {
		for i := range similar {
			similar[i] = "--" + similar[i]
		}
	}
	if len(similar) > 1 {
		return "\n(Did you mean one of " + strings.Join(similar, ", ") + "?)"
	}
	if len(similar) == 1 {
		return "\n(Did you mean " + similar[0] + "?)"
	}
	return ""
}

// osaDistance is the optimal string alignment distance commander uses for suggestions.
func osaDistance(a, b string) int {
	d := make([][]int, len(a)+1)
	for i := range d {
		d[i] = make([]int, len(b)+1)
		d[i][0] = i
	}
	for j := 0; j <= len(b); j++ {
		d[0][j] = j
	}
	for j := 1; j <= len(b); j++ {
		for i := 1; i <= len(a); i++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost)
			if i > 1 && j > 1 && a[i-1] == b[j-2] && a[i-2] == b[j-1] {
				d[i][j] = min(d[i][j], d[i-2][j-2]+1)
			}
		}
	}
	return d[len(a)][len(b)]
}

// helpText is a commander-style help page.
func helpText(c *command, path []*command) string {
	names := mapList(path, func(p *command) string { return p.name })
	usage := strings.Join(names, " ")
	if u := c.usage(); u != "" {
		usage += " " + u
	}
	if c == path[0] {
		usage = "wk [options] [command]"
	}
	type row struct{ term, desc string }
	opts := []row{}
	for _, o := range c.opts {
		opts = append(opts, row{o.flags(), o.desc})
	}
	opts = append(opts, row{"-h, --help", "display help for command"})
	cmds := []row{}
	for _, s := range c.subs {
		term := s.name
		if u := s.usage(); u != "" {
			term += " " + u
		}
		cmds = append(cmds, row{term, s.desc})
	}
	if len(c.subs) > 0 {
		cmds = append(cmds, row{"help [command]", "display help for command"})
	}
	width := 0
	for _, x := range append(append([]row{}, opts...), cmds...) {
		width = max(width, len(x.term))
	}
	var b strings.Builder
	b.WriteString("Usage: " + usage + "\n")
	if c.desc != "" {
		b.WriteString("\n" + c.desc + "\n")
	}
	if len(c.args) > 0 {
		b.WriteString("\nArguments:\n")
		for _, a := range c.args {
			b.WriteString("  " + a.name + "\n")
		}
	}
	b.WriteString("\nOptions:\n")
	for _, x := range opts {
		b.WriteString("  " + PadEnd(x.term, width) + "  " + x.desc + "\n")
	}
	if len(cmds) > 0 {
		b.WriteString("\nCommands:\n")
		for _, x := range cmds {
			b.WriteString("  " + PadEnd(x.term, width) + "  " + x.desc + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}
