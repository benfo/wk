package app

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// The board file follows the plan without a server: wk rewrites it after every command, and next to
// it a feed script carrying the fresh board. The page reloads the feed every few seconds (a page
// opened from disk may load scripts but not fetch) and swaps in the new board when its stamp changes.

// boardFeed is how a board page finds its feed: the script's file name and the stamp it was drawn at.
type boardFeed struct{ src, stamp string }

const feedPrefix = "// wk board feed "

func feedPath(boardFile string) string {
	return strings.TrimSuffix(boardFile, filepath.Ext(boardFile)) + ".js"
}

// boardStamp changes whenever the board could: the plan's files, the git branch, or the day. It hashes
// contents, not file times, so the same plan always gives the same stamp.
func boardStamp(ctx *Ctx) string {
	h := sha1.New()
	io.WriteString(h, ctx.Today+"\n")
	_ = filepath.WalkDir(ctx.Root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(ctx.Root, p)
		if data, err := os.ReadFile(p); err == nil {
			fmt.Fprintf(h, "%s|%d\n", filepath.ToSlash(rel), len(data))
			h.Write(data)
		}
		return nil
	})
	if ctx.Git {
		if head := gitDirOfHead(ctx.Base); head != "" {
			if data, err := os.ReadFile(filepath.Join(head, "HEAD")); err == nil {
				h.Write(data)
			}
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// writeBoardFile writes the board page and its feed, drawn at stamp.
func writeBoardFile(ctx *Ctx, s *Store, file, stamp string) {
	feed := feedPath(file)
	html := boardHTML(ctx, s, true, &boardFeed{src: filepath.Base(feed), stamp: stamp})
	mkdirAll(filepath.Dir(file))
	writeAtomic(file, html)
	data, _ := json.Marshal(html) // escapes <, > and & so the board can't end the script early
	writeAtomic(feed, feedPrefix+stamp+"\nwkBoard("+JSONStringify(stamp)+", "+string(data)+");\n")
}

// refreshBoard brings this plan's board file up to date after a command; only once the user has
// made one with wk board, and only when something changed. Never fails the command.
func refreshBoard(ctx *Ctx) {
	defer func() { _ = recover() }()
	file := boardPath(ctx)
	if !exists(file) {
		return
	}
	fresh := *ctx
	fresh.Config = readConfig(ctx.Root)
	stamp := boardStamp(&fresh)
	if feedStamp(feedPath(file)) == stamp {
		return
	}
	writeBoardFile(&fresh, NewStore(&fresh), file, stamp)
}

// feedStamp reads the stamp from a feed's first line; "" when there's no feed.
func feedStamp(feed string) string {
	b, err := os.ReadFile(feed)
	if err != nil {
		return ""
	}
	line, _, _ := strings.Cut(string(b), "\n")
	return strings.TrimPrefix(line, feedPrefix)
}

// writeAtomic swaps the file in whole, so an open page never reads half a board.
func writeAtomic(p, text string) {
	tmp := p + ".tmp"
	writeFile(tmp, text)
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		writeFile(p, text)
	}
}
