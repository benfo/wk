package app

import "strings"

func lineCount(text string) int {
	t := Trim(text)
	if t == "" {
		return 0
	}
	return len(strings.Split(t, "\n"))
}

const (
	limitTitle             = 70
	limitTaskBody          = 6
	limitNote              = 2 // jots, learnings
	limitDecisionWhy       = 2
	limitDecisionRejected  = 1
	limitPrincipleBecause  = 2
	limitAreaDescription   = 3
	limitPrinciplesPerArea = 15
	limitHandoff           = 5
	limitSummary           = 8
)

// Refusals name the item and say how far over it is, so the agent knows how much to cut.
func checkTitle(title, what string) string {
	t := Trim(title)
	if t == "" {
		fail(what + " is empty.")
	}
	if strings.Contains(t, "\n") {
		fail(what + " must be one line.")
	}
	if n := Len16(t); n > limitTitle {
		fail(what + " is " + itoa(n) + " characters, limit is " + itoa(limitTitle) + " (" + itoa(n-limitTitle) + " over). Shorten it.")
	}
	return t
}

func checkLines(text string, max int, what string) string {
	if n := lineCount(text); n > max {
		fail(what + " is " + itoa(n) + " lines, limit is " + itoa(max) + " (" + itoa(n-max) + " over). Shorten it.")
	}
	return Trim(text)
}
