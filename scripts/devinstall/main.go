// Command devinstall installs this working copy as the wk on your PATH, for using wk while developing it.
//
//	go run ./scripts/devinstall
//
// It builds wk into the installer's location (Windows: %LOCALAPPDATA%\Programs\wk, else ~/.local/bin)
// and copies skills/ into .claude/skills so this repo's agent uses the skills being worked on.
// The git hooks in .githooks run it after each commit, merge, checkout and rebase.
//
//	go run ./scripts/devinstall --stage
//
// The pre-commit hook runs this instead: it copies the staged skill files into .claude/skills and
// stages them, so the tracked copy lands in the same commit rather than leaving a change behind.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--stage" {
		stageSkills("skills", ".claude/skills")
		return
	}
	dest := installPath()
	check(os.MkdirAll(filepath.Dir(dest), 0o755))

	// Build beside the target, then swap it in: Windows won't overwrite a running exe
	// (a `wk board --serve`), but it will rename one.
	tmp := dest + ".new"
	build := exec.Command("go", "build", "-o", tmp, "./cmd/wk")
	build.Stdout, build.Stderr = os.Stdout, os.Stderr
	check(build.Run())
	old := dest + ".old"
	os.Remove(old)
	if _, err := os.Stat(dest); err == nil {
		check(os.Rename(dest, old))
	}
	check(os.Rename(tmp, dest))
	os.Remove(old) // fails while the old binary is still running; it's cleared next time

	synced := syncSkills("skills", filepath.Join(".claude", "skills"))
	fmt.Printf("wk installed to %s", dest)
	if synced > 0 {
		fmt.Printf("; %d skill file(s) updated in .claude/skills", synced)
	}
	fmt.Println(". Restart any running `wk board --serve`.")
}

func installPath() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "wk", "wk.exe")
	}
	home, err := os.UserHomeDir()
	check(err)
	return filepath.Join(home, ".local", "bin", "wk")
}

// syncSkills copies every file under src to the same path under dst when it differs, and returns how many it wrote.
func syncSkills(src, dst string) int {
	n := 0
	check(filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		want, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if have, err := os.ReadFile(target); err == nil && string(have) == string(want) {
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		n++
		return os.WriteFile(target, want, 0o644)
	}))
	return n
}

// stageSkills copies each staged file under src (git paths, forward slashes) to the same path under
// dst, from the index rather than the working tree, and stages the copy.
func stageSkills(src, dst string) {
	out, err := exec.Command("git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", src).Output()
	check(err)
	for path := range strings.FieldsSeq(string(out)) {
		want, err := exec.Command("git", "show", ":"+path).Output()
		check(err)
		target := dst + strings.TrimPrefix(path, src)
		check(os.MkdirAll(filepath.Dir(target), 0o755))
		check(os.WriteFile(target, want, 0o644))
		check(exec.Command("git", "add", "--", target).Run())
		// Rewrite the copy from the index with the checkout's line endings, as the source has them,
		// or the post-commit sync sees it differ and leaves it modified. Removed first: checkout-index
		// skips a file whose stat matches the index, even with -f.
		check(os.Remove(target))
		check(exec.Command("git", "checkout-index", "--", target).Run())
		check(exec.Command("git", "add", "--", target).Run()) // refresh the index's stat for the new file
	}
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "devinstall:", err)
		os.Exit(1)
	}
}
