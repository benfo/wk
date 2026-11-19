package app

import (
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type gitResult struct {
	ok  bool
	out string
	err string
}

func gitRun(cwd string, args []string, raw bool) gitResult {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	hideWindow(cmd)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		if _, isExit := err.(*exec.ExitError); !isExit {
			return gitResult{ok: false, err: err.Error()}
		}
	}
	out := stdout.String()
	if !raw {
		out = Trim(out)
	}
	return gitResult{ok: err == nil, out: out, err: Trim(stderr.String())}
}

// repoTop is the absolute path of the repo top level, or "" outside a git repo (or without git).
func repoTop(cwd string) string {
	r := gitRun(cwd, []string{"rev-parse", "--show-toplevel"}, false)
	if r.ok && r.out != "" {
		return r.out
	}
	return ""
}

func currentBranch(cwd string) string {
	// symbolic-ref also works before the first commit, where rev-parse fails.
	r := gitRun(cwd, []string{"symbolic-ref", "--short", "-q", "HEAD"}, false)
	if r.ok && r.out != "" {
		return r.out
	}
	d := gitRun(cwd, []string{"rev-parse", "--abbrev-ref", "HEAD"}, false)
	if d.ok {
		return d.out
	}
	return ""
}

func createBranch(cwd, name string) (bool, string) {
	r := gitRun(cwd, []string{"checkout", "-b", name}, false)
	if r.ok {
		return true, name
	}
	if r.err != "" {
		return false, r.err
	}
	return false, "git checkout failed"
}

func checkoutBranch(cwd, name string) (bool, string) {
	r := gitRun(cwd, []string{"checkout", name}, false)
	if r.ok {
		return true, name
	}
	if r.err != "" {
		return false, r.err
	}
	return false, "git checkout failed"
}

func branchExists(cwd, name string) bool {
	return gitRun(cwd, []string{"rev-parse", "--verify", "--quiet", "refs/heads/" + name}, false).ok
}

type diffSum struct {
	files     []string
	shortstat string
}

// diffSummary lists changed files (tracked and untracked, excluding .work/) and a line count summary.
func diffSummary(cwd string) *diffSum {
	// Raw output: porcelain lines start with a status column that may be a space.
	status := gitRun(cwd, []string{"status", "--porcelain", "--untracked-files=all"}, true)
	if !status.ok {
		return nil
	}
	files := []string{}
	for _, l := range strings.Split(status.out, "\n") {
		if l == "" {
			continue
		}
		f := ""
		if len(l) > 3 {
			f = l[3:]
		}
		f = strings.TrimSuffix(strings.TrimPrefix(f, `"`), `"`)
		if i := strings.Index(f, " -> "); i >= 0 {
			f = strings.Split(f, " -> ")[1]
		}
		if strings.HasPrefix(f, ".work/") {
			continue
		}
		files = append(files, f)
	}
	stat := gitRun(cwd, []string{"diff", "--shortstat", "HEAD", "--", ".", ":(exclude).work"}, false)
	s := ""
	if stat.ok {
		s = stat.out
	}
	return &diffSum{files: files, shortstat: s}
}

// remoteURL is the origin remote URL (or the first remote's), or "".
func remoteURL(cwd string) string {
	origin := gitRun(cwd, []string{"remote", "get-url", "origin"}, false)
	if origin.ok && origin.out != "" {
		return origin.out
	}
	first := strings.Split(gitRun(cwd, []string{"remote"}, false).out, "\n")[0]
	if first == "" {
		return ""
	}
	r := gitRun(cwd, []string{"remote", "get-url", first}, false)
	if r.ok {
		return r.out
	}
	return ""
}

// excludeFile is the repo's personal ignore file (.git/info/exclude), worktree-aware.
func excludeFile(cwd string) string {
	r := gitRun(cwd, []string{"rev-parse", "--git-path", "info/exclude"}, false)
	if !r.ok || r.out == "" {
		return ""
	}
	return resolvePath(cwd, r.out)
}

// todoCount is the number of TODO and FIXME markers in tracked text files, or -1 outside git.
func todoCount(cwd string) int {
	// -w matches whole words, so "todos" and "TODOS" don't count.
	r := gitRun(cwd, []string{"grep", "-I", "-c", "-w", "-E", "TODO|FIXME", "--", ".", ":(exclude).work"}, false)
	if !r.ok {
		// git grep exits 1 when nothing matches.
		if r.err != "" {
			return -1
		}
		return 0
	}
	sum := 0
	for _, line := range strings.Split(r.out, "\n") {
		if line == "" {
			continue
		}
		n, _ := strconv.Atoi(line[strings.LastIndex(line, ":")+1:])
		sum += n
	}
	return sum
}

// gitDirOfHead is the folder holding git's HEAD file, worktree-aware; "" outside git.
func gitDirOfHead(base string) string {
	r := gitRun(base, []string{"rev-parse", "--git-path", "HEAD"}, false)
	if r.ok && r.out != "" {
		return filepath.Dir(resolvePath(base, r.out))
	}
	return ""
}

// resolvePath is path.resolve(base, p).
func resolvePath(base, p string) string {
	p = filepath.FromSlash(p)
	if !filepath.IsAbs(p) {
		p = filepath.Join(base, p)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	return abs
}
