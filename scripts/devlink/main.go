// Command devlink links this working copy's skills into your user skill folders, so every
// project's agent uses the skills being worked on instead of its own installed copy.
//
//	go run ./scripts/devlink            link skills/<name> into ~/.claude/skills and ~/.agents/skills
//	go run ./scripts/devlink --remove   remove those links; projects use their own copies again
//
// Links are live: an edit under skills/ applies at the next agent session, no build needed.
// Only links that point into this repo are removed; a real folder in the way is left alone.
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
	remove := len(os.Args) > 1 && os.Args[1] == "--remove"
	if len(os.Args) > 1 && !remove {
		fail("Usage: go run ./scripts/devlink [--remove]")
	}

	src, err := filepath.Abs("skills")
	check(err)
	entries, err := os.ReadDir(src)
	check(err)
	home, err := os.UserHomeDir()
	check(err)

	for _, dir := range []string{filepath.Join(home, ".claude", "skills"), filepath.Join(home, ".agents", "skills")} {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			target, link := filepath.Join(src, e.Name()), filepath.Join(dir, e.Name())
			if remove {
				unlink(link, src)
			} else {
				makeLink(link, target)
			}
		}
	}
}

func makeLink(link, target string) {
	if dest, err := os.Readlink(link); err == nil {
		if samePath(dest, target) {
			fmt.Println("already linked:", link)
			return
		}
		check(os.Remove(link)) // a link to somewhere else, like an older checkout
	} else if _, err := os.Lstat(link); err == nil {
		fmt.Println("skipped, a real folder is in the way:", link)
		return
	}
	check(os.MkdirAll(filepath.Dir(link), 0o755))
	if runtime.GOOS == "windows" {
		// A junction needs no admin rights or developer mode, unlike a symlink.
		out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput()
		if err != nil {
			fail(strings.TrimSpace(string(out)))
		}
	} else {
		check(os.Symlink(target, link))
	}
	fmt.Println("linked:", link, "->", target)
}

func unlink(link, src string) {
	dest, err := os.Readlink(link)
	if err != nil {
		return // not there, or not a link
	}
	if !samePath(filepath.Dir(dest), src) {
		fmt.Println("skipped, links elsewhere:", link)
		return
	}
	check(os.Remove(link)) // removes the link only, never the files it points at
	fmt.Println("removed:", link)
}

func samePath(a, b string) bool {
	a, b = filepath.Clean(strings.TrimPrefix(a, `\??\`)), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func check(err error) {
	if err != nil {
		fail(err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "devlink:", msg)
	os.Exit(1)
}
