// Command devinstall installs this working copy as the wk on your PATH, for using wk while developing it.
//
//	go run ./scripts/devinstall
//
// It builds wk into the installer's location (Windows: %LOCALAPPDATA%\Programs\wk, else ~/.local/bin)
// and copies skills/ into .claude/skills so this repo's agent uses the skills being worked on.
// The git hooks in .githooks run it after each commit, merge, checkout and rebase.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func main() {
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

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "devinstall:", err)
		os.Exit(1)
	}
}
