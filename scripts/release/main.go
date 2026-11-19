// Command release publishes a version of wk as a GitHub release with a binary for each platform.
//
//	go run ./scripts/release v0.2.0             test, build, tag, push and publish
//	go run ./scripts/release v0.2.0 --dry-run   test and build only; tags, pushes and publishes nothing
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// targets are the platforms each release ships a binary for.
var targets = [][2]string{
	{"windows", "amd64"}, {"windows", "arm64"},
	{"darwin", "amd64"}, {"darwin", "arm64"},
	{"linux", "amd64"}, {"linux", "arm64"},
}

func main() {
	args := os.Args[1:]
	dryRun := false
	version := ""
	for _, a := range args {
		if a == "--dry-run" {
			dryRun = true
		} else {
			version = a
		}
	}
	if !regexp.MustCompile(`^v\d+\.\d+\.\d+$`).MatchString(version) {
		fail("Give the version to release, like: go run ./scripts/release v0.2.0 [--dry-run]")
	}

	if out("git", "status", "--porcelain") != "" {
		fail("Working tree has uncommitted changes. Commit or stash them first.")
	}
	if !dryRun {
		if out("git", "remote") == "" {
			fail("No git remote. Create the GitHub repo and add it as origin first.")
		}
		if exec.Command("gh", "release", "view", version).Run() == nil {
			fail("Release " + version + " already exists. Pick the next version.")
		}
	}
	tagged := contains(strings.Fields(out("git", "tag", "--points-at", "HEAD")), version)
	if !tagged && out("git", "tag", "--list", version) != "" {
		fail("Tag " + version + " exists but not on this commit. Pick the next version.")
	}

	step(nil, "go", "vet", "./...")
	step(nil, "go", "test", "./...")

	dist, err := os.MkdirTemp("", "wk-release-")
	check(err)
	assets := []string{}
	for _, t := range targets {
		name := "wk-" + t[0] + "-" + t[1]
		if t[0] == "windows" {
			name += ".exe"
		}
		file := filepath.Join(dist, name)
		env := []string{"GOOS=" + t[0], "GOARCH=" + t[1], "CGO_ENABLED=0"}
		step(env, "go", "build", "-trimpath", "-ldflags", "-s -w", "-o", file, "./cmd/wk")
		assets = append(assets, file)
	}

	if dryRun {
		fmt.Println("Dry run: built " + itoa(len(assets)) + " binaries in " + dist + ". Nothing tagged, pushed or released.")
		return
	}

	if !tagged {
		step(nil, "git", "tag", version)
	}
	step(nil, "git", "push", "origin", "HEAD")
	step(nil, "git", "push", "origin", version)

	repo := out("gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner")
	notes := strings.Join([]string{
		"Install or upgrade (no Node needed):",
		"",
		"macOS and Linux:",
		"```sh",
		"curl -fsSL https://raw.githubusercontent.com/" + repo + "/main/install.sh | sh",
		"```",
		"",
		"Windows (PowerShell):",
		"```powershell",
		"irm https://raw.githubusercontent.com/" + repo + "/main/install.ps1 | iex",
		"```",
		"",
		"Then run `wk init` in each project to refresh its skills.",
	}, "\n")
	notesFile := filepath.Join(dist, "notes.md")
	check(os.WriteFile(notesFile, []byte(notes), 0o644))
	step(nil, "gh", append([]string{"release", "create", version, "--title", version, "--notes-file", notesFile}, assets...)...)
	fmt.Println("Released " + version + ": https://github.com/" + repo + "/releases/tag/" + version)
}

func out(name string, args ...string) string {
	b, err := exec.Command(name, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func step(env []string, name string, args ...string) {
	fmt.Println("> " + name + " " + strings.Join(args, " "))
	cmd := exec.Command(name, args...)
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		fail(name + " failed: " + err.Error())
	}
}

func check(err error) {
	if err != nil {
		fail(err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func itoa(n int) string { return fmt.Sprint(n) }
