package app

import (
	"math"
	"regexp"
	"strings"
)

const LineLimit = 10

// Result is what every command returns: Lines is the plain-text view, Data the --json view.
type Result struct {
	Lines []string
	Data  any
	// Full skips the line cap (wk show prints one item in full).
	Full bool
}

// WkError is a refusal or mistake the user can fix; it prints as-is, without a stack.
type WkError struct{ Msg string }

func (e *WkError) Error() string { return e.Msg }

func fail(msg string) { panic(&WkError{msg}) }

func result(lines []string) Result { return Result{Lines: lines, Data: Obj("lines", lines)} }

func resultData(lines []string, data any) Result { return Result{Lines: lines, Data: data} }

func render(res Result, json, all bool) string {
	if json {
		return JSONStringify(res.Data)
	}
	lines := res.Lines
	if all || res.Full || len(lines) <= LineLimit {
		return strings.Join(lines, "\n")
	}
	keep := append([]string(nil), lines[:LineLimit-1]...)
	keep = append(keep, "… "+itoa(len(lines)-len(keep))+" more lines (--all)")
	return strings.Join(keep, "\n")
}

func progressBar(done, total int) string {
	const width = 10
	filled := 0
	if total != 0 {
		filled = int(jsRound(float64(done) / float64(total) * width))
	}
	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
}

// jsRound is Math.round: halves round up.
func jsRound(f float64) float64 { return math.Floor(f + 0.5) }

var escapedNewline = regexp.MustCompile(`\\n`)

// unescapeText lets callers pass multi-line text as a literal "\n" (handy in PowerShell).
func unescapeText(text string) string {
	return Trim(crlf(escapedNewline.ReplaceAllString(text, "\n")))
}
