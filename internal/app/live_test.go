package app

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testPlan(t *testing.T) *Ctx {
	t.Helper()
	dir, home := t.TempDir(), t.TempDir()
	if out := Run([]string{"init", "--store", "repo", "--preset", "general"}, RunOptions{Cwd: dir, Home: home, Today: "2026-11-10"}); out.Code != 0 {
		t.Fatalf("init: %s", out.Stderr)
	}
	return loadContext(dir, "2026-11-10", home, nil)
}

func TestLiveBoardServesAndPushesReloads(t *testing.T) {
	ctx := testPlan(t)
	live, err := serveBoard(ctx, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()

	res, err := http.Get(live.URL)
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(page), `<span id="live"`) || !strings.Contains(string(page), "new EventSource") {
		t.Fatal("live page lacks the live script")
	}
	if missing, _ := http.Get(live.URL + "nope"); missing.StatusCode != 404 {
		t.Fatalf("want 404 for an unknown path, got %d", missing.StatusCode)
	}

	events, err := http.Get(live.URL + "events")
	if err != nil {
		t.Fatal(err)
	}
	defer events.Body.Close()
	lines := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(events.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()
	expect := func(want string) {
		t.Helper()
		deadline := time.After(3 * time.Second)
		for {
			select {
			case l := <-lines:
				if l == want {
					return
				}
			case <-deadline:
				t.Fatalf("no %q from /events", want)
			}
		}
	}
	expect(": connected")
	if out := Run([]string{"add", "Water the plants"}, RunOptions{Cwd: ctx.Cwd, Home: ctx.Home, Today: ctx.Today}); out.Code != 0 {
		t.Fatalf("add: %s", out.Stderr)
	}
	expect("data: reload")

	res, _ = http.Get(live.URL)
	page, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(page), "Water the plants") {
		t.Fatal("the page doesn't show the new task")
	}
}

func TestLiveBoardMovesToTheNextFreePort(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	port := taken.Addr().(*net.TCPAddr).Port
	live, err := serveBoard(testPlan(t), port, "")
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()
	if live.URL == "http://localhost:"+strconv.Itoa(port)+"/" {
		t.Fatal("used the taken port")
	}
}

func TestStaticBoardHasNoScripts(t *testing.T) {
	ctx := testPlan(t)
	out := filepath.Join(t.TempDir(), "b.html")
	if r := Run([]string{"board", "--out", out}, RunOptions{Cwd: ctx.Cwd, Home: ctx.Home}); r.Code != 0 {
		t.Fatal(r.Stderr)
	}
	b, _ := os.ReadFile(out)
	if strings.Contains(string(b), "<script") {
		t.Fatal("static board has a script")
	}
}
