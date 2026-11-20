package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const DefaultPort = 4123

const (
	pollEvery   = 150 * time.Millisecond
	heartbeat   = 25 * time.Second
	portRetries = 9
)

// LiveBoard is a running live board server.
type LiveBoard struct {
	URL   string
	Close func()
}

// planStamp fingerprints the plan folder (names, sizes, times) and git's HEAD, so a poll sees any change.
func planStamp(root, head string) string {
	var b strings.Builder
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if info, err := d.Info(); err == nil {
			fmt.Fprintf(&b, "%s|%d|%d\n", p, info.Size(), info.ModTime().UnixNano())
		}
		return nil
	})
	if head != "" {
		if data, err := os.ReadFile(filepath.Join(head, "HEAD")); err == nil {
			b.Write(data)
		}
	}
	return b.String()
}

// serveBoard serves the board on localhost and pushes a reload to every open page when anything in
// the plan folder (or the git branch) changes, so the page follows the agent's work.
func serveBoard(ctx *Ctx, port int, host string) (*LiveBoard, error) {
	if host == "" {
		host = "127.0.0.1"
	}
	var mu sync.Mutex
	clients := map[chan string]bool{}
	broadcast := func(msg string) {
		mu.Lock()
		defer mu.Unlock()
		for c := range clients {
			select {
			case c <- msg:
			default:
			}
		}
	}

	// Every request reads the plan fresh: config and items may have changed since the last one.
	render := func() (html string, err error) {
		defer func() {
			if r := recover(); r != nil {
				if e, ok := r.(*WkError); ok {
					err = e
				} else {
					err = fmt.Errorf("%v", r)
				}
			}
		}()
		fresh := *ctx
		fresh.Config = readConfig(ctx.Root)
		return boardHTML(&fresh, NewStore(&fresh), true, nil), nil
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/events" {
			flusher, ok := w.(http.Flusher)
			if !ok {
				http.Error(w, "streaming unsupported", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Connection", "keep-alive")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, ": connected\n\n")
			flusher.Flush()
			ch := make(chan string, 4)
			mu.Lock()
			clients[ch] = true
			mu.Unlock()
			defer func() {
				mu.Lock()
				delete(clients, ch)
				mu.Unlock()
			}()
			for {
				select {
				case msg, open := <-ch:
					if !open {
						return
					}
					if _, err := fmt.Fprint(w, msg); err != nil {
						return
					}
					flusher.Flush()
				case <-r.Context().Done():
					return
				}
			}
		}
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, "Not found")
			return
		}
		html, err := render()
		if err != nil {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprint(w, "Could not read the plan: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		fmt.Fprint(w, html)
	})

	// Try the port asked for, then the next few, so a second board in another repo still starts.
	var ln net.Listener
	var err error
	for p, left := port, portRetries; ; p, left = p+1, left-1 {
		ln, err = net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(p)))
		if err == nil || left == 0 || p == 0 || !errors.Is(err, syscall.EADDRINUSE) && !isAddrInUse(err) {
			break
		}
	}
	if err != nil {
		return nil, err
	}
	server := &http.Server{Handler: mux}
	go func() { _ = server.Serve(ln) }()

	// Switching branches doesn't touch the plan, but the board shows the branch: watch git's HEAD too.
	head := ""
	if ctx.Git {
		head = gitDirOfHead(ctx.Base)
	}
	stop := make(chan struct{})
	go func() {
		last := planStamp(ctx.Root, head)
		poll := time.NewTicker(pollEvery)
		beat := time.NewTicker(heartbeat)
		defer poll.Stop()
		defer beat.Stop()
		for {
			select {
			case <-stop:
				return
			case <-beat.C:
				broadcast(": ping\n\n")
			case <-poll.C:
				// Many files change at once (wk done also writes the handoff): a changed stamp waits
				// one more tick to settle before pushing.
				if now := planStamp(ctx.Root, head); now != last {
					time.Sleep(pollEvery)
					last = planStamp(ctx.Root, head)
					broadcast("data: reload\n\n")
				}
			}
		}
	}()

	var once sync.Once
	closeFn := func() {
		once.Do(func() {
			close(stop)
			mu.Lock()
			for c := range clients {
				close(c)
				delete(clients, c)
			}
			mu.Unlock()
			shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = server.Shutdown(shutdown)
		})
	}
	actual := ln.Addr().(*net.TCPAddr).Port
	return &LiveBoard{URL: "http://localhost:" + strconv.Itoa(actual) + "/", Close: closeFn}, nil
}

func isAddrInUse(err error) bool {
	return strings.Contains(err.Error(), "address already in use") || strings.Contains(err.Error(), "Only one usage of each socket address")
}

// serveCommand is wk board --serve: it starts the server and keeps running until Ctrl+C.
func serveCommand(ctx *Ctx, o *Opts, stdout, stderr func(string)) int {
	port := DefaultPort
	if p, ok := o.Str("port"); ok {
		n, err := strconv.Atoi(Trim(p))
		if err != nil {
			stderr("Could not start the live board: invalid port " + p)
			return 1
		}
		port = n
	}
	live, err := serveBoard(ctx, port, "")
	if err != nil {
		stderr("Could not start the live board: " + err.Error())
		return 1
	}
	stdout("Live board: " + live.URL + "\nIt refreshes whenever the plan changes. Ctrl+C to stop.")
	if o.Flag("open") {
		openURL(live.URL)
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	live.Close()
	return 0
}
