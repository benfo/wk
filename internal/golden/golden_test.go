// Package golden replays scripted wk sessions and compares everything they print and write with
// recorded transcripts. The transcripts were recorded from the TypeScript wk, so they pin the Go
// port to it byte for byte; regenerate with -update once a behaviour change is intended.
//
// A scenario in testdata/*.txt is a list of steps, one per line:
//
//	$ wk <args>        run wk (arguments quoted like a shell: "..." or '...')
//	$ git <args>       run git in the project folder
//	write <path> <text>   write a file under the project folder (\n for newlines)
//	stdin <text>       stdin for the next wk step (\n for newlines)
//	now <iso>          pin the clock for later steps (WK_NOW)
//	today <date>       pin today for later steps (WK_TODAY)
//	tree               dump the plan folder and wk's per-machine files
//	# ...              a comment
//
// WK_BIN=<path> runs another wk build (a .js path runs through node) instead of building this one.
package golden

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

var update = flag.Bool("update", false, "rewrite the .golden transcripts")

func wkCommand(t *testing.T) []string {
	if bin := os.Getenv("WK_BIN"); bin != "" {
		if strings.HasSuffix(bin, ".js") {
			return []string{"node", bin}
		}
		return []string{bin}
	}
	exe := filepath.Join(t.TempDir(), "wk")
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	build := exec.Command("go", "build", "-o", exe, "github.com/benfo/wk/cmd/wk")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return []string{exe}
}

// workRoot is a long-form path outside any repo, so paths print the same from every implementation.
func workRoot(t *testing.T) string {
	base, err := os.UserCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(base, "wk-golden")
}

func TestGolden(t *testing.T) {
	scenarios, _ := filepath.Glob(filepath.Join("testdata", "*.txt"))
	if len(scenarios) == 0 {
		t.Fatal("no scenarios")
	}
	wk := wkCommand(t)
	for _, file := range scenarios {
		name := strings.TrimSuffix(filepath.Base(file), ".txt")
		t.Run(name, func(t *testing.T) {
			got := runScenario(t, wk, file, filepath.Join(workRoot(t), name))
			goldenFile := strings.TrimSuffix(file, ".txt") + ".golden"
			if *update {
				if err := os.WriteFile(goldenFile, []byte(got), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(goldenFile)
			if err != nil {
				t.Fatalf("no golden transcript (run with -update): %v", err)
			}
			if w := strings.ReplaceAll(string(want), "\r\n", "\n"); w != got {
				t.Errorf("transcript differs from %s:\n%s", goldenFile, firstDiff(w, got))
			}
		})
	}
}

// firstDiff shows the first differing line with a little context.
func firstDiff(want, got string) string {
	w, g := strings.Split(want, "\n"), strings.Split(got, "\n")
	for i := 0; i < len(w) || i < len(g); i++ {
		var wl, gl string
		if i < len(w) {
			wl = w[i]
		}
		if i < len(g) {
			gl = g[i]
		}
		if wl != gl {
			from := max(0, i-3)
			ctx := strings.Join(w[from:i], "\n")
			return fmt.Sprintf("line %d\n%s\n- want: %q\n+ got:  %q", i+1, ctx, wl, gl)
		}
	}
	return ""
}

type env struct {
	dir, home, today, now, stdin string
}

func runScenario(t *testing.T, wk []string, file, root string) string {
	_ = os.RemoveAll(root)
	e := env{dir: filepath.Join(root, "project"), home: filepath.Join(root, "home"), today: "2026-11-10", now: "2026-11-10T09:00:00.000Z"}
	for _, d := range []string{e.dir, e.home} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	script, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	for _, line := range strings.Split(strings.ReplaceAll(string(script), "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "" || strings.HasPrefix(line, "#"):
			continue
		case strings.HasPrefix(line, "$ wk"):
			args := shellSplit(t, strings.TrimSpace(strings.TrimPrefix(line, "$ wk")))
			out.WriteString(line + "\n" + runWk(t, wk, e, args))
			e.stdin = ""
		case strings.HasPrefix(line, "$ git "):
			cmd := exec.Command("git", shellSplit(t, strings.TrimPrefix(line, "$ git "))...)
			cmd.Dir = e.dir
			if b, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("%s: %v\n%s", line, err, b)
			}
		case strings.HasPrefix(line, "write "):
			rel, text, _ := strings.Cut(strings.TrimPrefix(line, "write "), " ")
			p := filepath.Join(e.dir, filepath.FromSlash(rel))
			_ = os.MkdirAll(filepath.Dir(p), 0o755)
			if err := os.WriteFile(p, []byte(unescape(text)), 0o644); err != nil {
				t.Fatal(err)
			}
		case strings.HasPrefix(line, "stdin "):
			e.stdin = unescape(strings.TrimPrefix(line, "stdin "))
		case strings.HasPrefix(line, "now "):
			e.now = strings.TrimPrefix(line, "now ")
		case strings.HasPrefix(line, "today "):
			e.today = strings.TrimPrefix(line, "today ")
		case line == "tree":
			out.WriteString("== tree\n" + dumpTree(e) + "\n")
		default:
			t.Fatalf("unknown step: %s", line)
		}
	}
	out.WriteString("== final tree\n" + dumpTree(e))
	return normalise(out.String(), e)
}

func unescape(s string) string { return strings.ReplaceAll(s, `\n`, "\n") }

func runWk(t *testing.T, wk []string, e env, args []string) string {
	cmd := exec.Command(wk[0], append(append([]string{}, wk[1:]...), args...)...)
	cmd.Dir = e.dir
	cmd.Env = append(filterEnv(os.Environ()), "WK_HOME="+e.home, "WK_TODAY="+e.today, "WK_NOW="+e.now, "WK_SEED=7")
	cmd.Stdin = strings.NewReader(e.stdin)
	var stdout, stderr strings.Builder
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		if x, ok := err.(*exec.ExitError); ok {
			code = x.ExitCode()
		} else {
			t.Fatalf("running wk: %v", err)
		}
	}
	var b strings.Builder
	b.WriteString(stdout.String())
	if s := stderr.String(); s != "" {
		for _, l := range strings.Split(strings.TrimRight(s, "\n"), "\n") {
			b.WriteString("! " + l + "\n")
		}
	}
	if code != 0 {
		fmt.Fprintf(&b, "[exit %d]\n", code)
	}
	return b.String()
}

func filterEnv(env []string) []string {
	out := []string{}
	for _, kv := range env {
		if !strings.HasPrefix(kv, "WK_") {
			out = append(out, kv)
		}
	}
	return out
}

// dumpTree lists every file in the project (git internals aside) and wk's per-machine files, with
// their contents.
func dumpTree(e env) string {
	var b strings.Builder
	dump := func(label, root string, skip func(rel string) bool) {
		files := []string{}
		_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			rel = filepath.ToSlash(rel)
			if info.IsDir() {
				if rel == ".git" {
					return filepath.SkipDir
				}
				return nil
			}
			if !skip(rel) {
				files = append(files, rel)
			}
			return nil
		})
		sort.Strings(files)
		for _, f := range files {
			if strings.HasPrefix(f, ".claude/skills/") {
				// Copied verbatim from the package (line endings follow the checkout): presence is enough.
				fmt.Fprintf(&b, "--- %s/%s (packaged skill)\n", label, f)
				continue
			}
			data, _ := os.ReadFile(filepath.Join(root, filepath.FromSlash(f)))
			if strings.HasPrefix(f, "boards/") && strings.HasSuffix(f, ".js") {
				// A board's feed repeats the board page beside it: its stamp line is enough.
				line, _, _ := strings.Cut(string(data), "\n")
				fmt.Fprintf(&b, "--- %s/%s (board feed)\n%s\n", label, f, line)
				continue
			}
			fmt.Fprintf(&b, "--- %s/%s\n%s", label, f, string(data))
			if len(data) > 0 && data[len(data)-1] != '\n' {
				b.WriteString("\n[no newline]\n")
			}
		}
	}
	// The skills are copied verbatim from the package; their presence is enough.
	dump("project", e.dir, func(string) bool { return false })
	dump("home", e.home, func(string) bool { return false })
	return b.String()
}

var (
	hashInName = regexp.MustCompile(`([-/])[0-9a-f]{12}(\.(?:jsonl|json|html))`)
	slugHash   = regexp.MustCompile(`(<HOME>/projects/[a-z0-9-]+)-[0-9a-f]{8}\b`)
	pathTail   = regexp.MustCompile(`(<DIR>|<HOME>)[^\s"'<>)]*`)
)

// normalise swaps machine-specific parts (folders, path hashes, separators, file times) for placeholders.
func normalise(s string, e env) string {
	for _, p := range []struct{ path, label string }{{e.dir, "<DIR>"}, {e.home, "<HOME>"}} {
		json := strings.ReplaceAll(p.path, `\`, `\\`)
		s = strings.ReplaceAll(s, json, p.label)
		s = strings.ReplaceAll(s, p.path, p.label)
		s = strings.ReplaceAll(s, filepath.ToSlash(p.path), p.label)
	}
	s = pathTail.ReplaceAllStringFunc(s, func(m string) string {
		return strings.ReplaceAll(strings.ReplaceAll(m, `\\`, "/"), `\`, "/")
	})
	s = slugHash.ReplaceAllString(s, "$1-<hash>")
	s = hashInName.ReplaceAllString(s, "$1<hash>$2")
	// The handoff's date is its file time, which is the real today.
	s = strings.ReplaceAll(s, time.Now().Format("2006-01-02"), "<FILE-DATE>")
	return s
}

// shellSplit splits arguments like a shell: whitespace separates, quotes group.
func shellSplit(t *testing.T, s string) []string {
	args := []string{}
	var cur strings.Builder
	inArg := false
	var quote rune
	for _, r := range s {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
			inArg = true
		case r == ' ' || r == '\t':
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteRune(r)
			inArg = true
		}
	}
	if quote != 0 {
		t.Fatalf("unclosed quote in: %s", s)
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args
}
