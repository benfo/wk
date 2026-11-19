package app

import (
	"crypto/sha1"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	ConfigFile = "config.yml"
	Version    = 2
	WorkDir    = ".work"
)

var Stores = []string{"repo", "ignore", "local", "home"}
var BranchModes = []string{"none", "task", "project"}
var CommitModes = []string{"ask", "task", "check"}
var Presets = []string{"software", "general"}

func todayString() string { return time.Now().Format("2006-01-02") }

// nowISO is the current time as ISO. WK_NOW pins it, so implementations can be compared byte for byte.
func nowISO() string {
	if v := os.Getenv("WK_NOW"); v != "" {
		return v
	}
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

// envPick is a random source for ids from the environment, for repeatable runs: WK_PICKS="3,4,5"
// returns those alphabet indexes in turn (then repeats the last); WK_SEED=<n> runs xorshift32 from n.
func envPick() Pick {
	if picks := os.Getenv("WK_PICKS"); picks != "" {
		list := []int{}
		for _, p := range strings.Split(picks, ",") {
			n, _ := strconv.Atoi(Trim(p))
			list = append(list, n)
		}
		i := 0
		return func(int) int {
			v := list[min(i, len(list)-1)]
			i++
			return v
		}
	}
	seed, _ := strconv.ParseFloat(os.Getenv("WK_SEED"), 64)
	if seed == 0 {
		return nil
	}
	x := uint32(int64(seed))
	return func(n int) int {
		x ^= x << 13
		x ^= x >> 17
		x ^= x << 5
		return int(x % uint32(n))
	}
}

// wkHome is where home-stored plans and per-machine state live. WK_HOME overrides ~/.wk.
func wkHome(override string) string {
	if override != "" {
		return override
	}
	if v := os.Getenv("WK_HOME"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".wk")
}

// projectBase is the folder wk init should use: the repo top level, or the current folder outside git.
func projectBase(cwd string) (string, bool) {
	if top := repoTop(cwd); top != "" {
		return resolvePath(cwd, top), true
	}
	return resolvePath(cwd, "."), false
}

var nonClean = regexp.MustCompile(`[^a-z0-9]+`)

func cleanName(text string) string {
	return strings.Trim(nonClean.ReplaceAllString(strings.ToLower(text), "-"), "-")
}

var (
	scpRemote = regexp.MustCompile(`^[^/@:]+@[^:]+:(.+)$`)
	urlRemote = regexp.MustCompile(`(?i)^[a-z+]+://[^/]+/(.+)$`)
	gitSuffix = regexp.MustCompile(`\.git$`)
	trailing  = regexp.MustCompile(`/+$`)
)

// remotePath: "git@github.com:acme/app.git" and "https://github.com/acme/app" both give "acme/app".
func remotePath(url string) string {
	noSuffix := trailing.ReplaceAllString(gitSuffix.ReplaceAllString(Trim(url), ""), "")
	if m := scpRemote.FindStringSubmatch(noSuffix); m != nil {
		return m[1]
	}
	if m := urlRemote.FindStringSubmatch(noSuffix); m != nil {
		return m[1]
	}
	return noSuffix
}

func sha1Hex(s string) string {
	h := sha1.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}

// pathKey is a short hash of a folder, for per-machine files keyed by plan.
func pathKey(p string, n int) string {
	return sha1Hex(strings.ToLower(resolvePath(p, ".")))[:n]
}

// projectSlug is the folder under ~/.wk/projects/: from the git remote, so every clone shares one
// plan; else name plus path hash.
func projectSlug(base string) string {
	if repoTop(base) != "" {
		if remote := remoteURL(base); remote != "" {
			if c := cleanName(remotePath(remote)); c != "" {
				return c
			}
			return "project"
		}
	}
	name := cleanName(filepath.Base(base))
	if name == "" {
		name = "project"
	}
	return name + "-" + pathKey(base, 8)
}

func homeRoot(base, home string) string {
	return filepath.Join(wkHome(home), "projects", projectSlug(base))
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// findRoot is the nearest .work/config.yml walking up from cwd, else a home-stored plan for this
// repo or folder.
func findRoot(cwd, home string) (root, base string, ok bool) {
	start := resolvePath(cwd, ".")
	ancestors := []string{}
	for dir := start; ; dir = filepath.Dir(dir) {
		ancestors = append(ancestors, dir)
		candidate := filepath.Join(dir, WorkDir)
		if exists(filepath.Join(candidate, ConfigFile)) {
			return candidate, dir, true
		}
		if filepath.Dir(dir) == dir {
			break
		}
	}
	bases := ancestors
	if top := repoTop(start); top != "" {
		bases = []string{resolvePath(start, top)}
	}
	for _, b := range bases {
		r := homeRoot(b, home)
		if exists(filepath.Join(r, ConfigFile)) {
			return r, b, true
		}
	}
	return "", "", false
}

type Workflow struct {
	Branch      string // "" until the user chooses
	Commit      string
	CommitStyle string
	Quick       string
	Full        string
	Tracker     string
}

type Config struct {
	Version  float64
	Store    string
	Preset   string
	Workflow Workflow
	Tags     []string
	Reviewed string
	// Setup holds the fingerprints of the agent instruction files read at setup; nil when not recorded.
	Setup *OMap
}

type Ctx struct {
	Cwd    string
	Base   string
	Root   string
	Config *Config
	Today  string
	Git    bool
	Home   string
	Pick   Pick
}

func pickOne(v any, allowed []string) string {
	if s, ok := v.(string); ok && contains(allowed, s) {
		return s
	}
	return ""
}

func textOf(v any) string {
	if s, ok := v.(string); ok {
		return Trim(s)
	}
	return ""
}

func defaultConfig(store, preset string) *Config {
	return &Config{Version: Version, Store: store, Preset: preset, Tags: []string{}}
}

func sub(m *OMap, key string) *OMap {
	if m == nil {
		return NewOMap()
	}
	if v, ok := m.Get(key); ok {
		if o, ok := v.(*OMap); ok {
			return o
		}
	}
	return NewOMap()
}

func getV(m *OMap, key string) any {
	v, _ := m.Get(key)
	return v
}

func parseConfig(raw *OMap) *Config {
	wf := sub(raw, "workflow")
	git := sub(wf, "git")
	checks := sub(wf, "checks")
	c := &Config{Version: 1, Store: "repo", Tags: []string{}}
	if v, ok := getV(raw, "version").(float64); ok {
		c.Version = v
	}
	if s := pickOne(getV(raw, "store"), Stores); s != "" {
		c.Store = s
	}
	c.Preset = pickOne(getV(raw, "preset"), Presets)
	c.Workflow = Workflow{
		Branch:      pickOne(getV(git, "branch"), BranchModes),
		Commit:      pickOne(getV(git, "commit"), CommitModes),
		CommitStyle: textOf(getV(wf, "commit_style")),
		Quick:       textOf(getV(checks, "quick")),
		Full:        textOf(getV(checks, "full")),
		Tracker:     textOf(getV(wf, "tracker")),
	}
	if list, ok := getV(raw, "tags").([]any); ok {
		for _, t := range list {
			c.Tags = append(c.Tags, jsString(t))
		}
	}
	switch r := getV(raw, "reviewed").(type) {
	case string:
		c.Reviewed = r
	case time.Time:
		c.Reviewed = r.UTC().Format("2006-01-02")
	}
	if s, ok := getV(raw, "setup").(*OMap); ok {
		c.Setup = NewOMap()
		for _, k := range s.Keys() {
			v, _ := s.Get(k)
			if str, ok := v.(string); ok {
				c.Setup.Set(k, str)
			} else {
				c.Setup.Set(k, jsString(v))
			}
		}
	}
	return c
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

const configHeader = "# wk plan settings. Change them with: wk config set <key> <value>\n" +
	"# workflow.git: branch none|task|project, commit ask|task|check; empty means not chosen yet."

func configText(c *Config) string {
	dump := func(m *OMap) string {
		lines := strings.Split(yamlDump(m, ""), "\n")
		for i, l := range lines {
			lines[i] = strings.TrimSuffix(l, ": null")
			if lines[i] != l {
				lines[i] += ":"
			}
		}
		return strings.Join(lines, "\n")
	}
	workflow := Obj(
		"git", Obj("branch", nullable(c.Workflow.Branch), "commit", nullable(c.Workflow.Commit)),
		"commit_style", nullable(c.Workflow.CommitStyle),
		"checks", Obj("quick", nullable(c.Workflow.Quick), "full", nullable(c.Workflow.Full)),
		"tracker", nullable(c.Workflow.Tracker),
	)
	head := dump(Obj("version", c.Version, "store", c.Store, "preset", nullable(c.Preset), "workflow", workflow))
	tags := "tags: [" + strings.Join(c.Tags, ", ") + "]\n"
	tailMap := Obj("reviewed", nullable(c.Reviewed))
	if c.Setup != nil {
		tailMap.Set("setup", c.Setup)
	}
	return configHeader + "\n" + head + tags + dump(tailMap)
}

func readConfig(root string) *Config {
	file := filepath.Join(root, ConfigFile)
	text, err := os.ReadFile(file)
	if err != nil {
		fail("Cannot read " + file + ": " + err.Error())
	}
	v, err := parseYAML(string(text))
	if err != nil {
		fail("Cannot read " + file + ": " + err.Error())
	}
	m, _ := v.(*OMap)
	if m == nil {
		m = NewOMap()
	}
	return parseConfig(m)
}

func writeConfig(root string, c *Config) {
	writeFile(filepath.Join(root, ConfigFile), configText(c))
}

const v1Plan = "This is a v1 plan, which this version can't read. Convert it with wk migrate."

func loadContext(cwd, today, home string, pick Pick) *Ctx {
	root, base, ok := findRoot(cwd, home)
	if !ok {
		fail("No wk plan found for this project. Run: wk init --store <repo|ignore|local|home>")
	}
	config := readConfig(root)
	if config.Version < Version {
		fail(v1Plan)
	}
	return &Ctx{Cwd: cwd, Root: root, Base: base, Config: config, Today: today, Git: repoTop(base) != "", Home: wkHome(home), Pick: pick}
}

// --- small fs helpers ---

func writeFile(p, text string) {
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		panic(err)
	}
}

func readFile(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func mkdirAll(p string) {
	if err := os.MkdirAll(p, 0o755); err != nil {
		panic(err)
	}
}

// readDir lists names in a folder; empty when it doesn't exist.
func readDir(p string) []os.DirEntry {
	entries, err := os.ReadDir(p)
	if err != nil {
		return nil
	}
	return entries
}
