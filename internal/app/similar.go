package app

import (
	"regexp"
	"strings"
)

var stopWords = map[string]bool{}

func init() {
	for _, w := range strings.Fields("a an the and or of to in on for with at by from is be it as into add make new use") {
		stopWords[w] = true
	}
}

func stem(word string) string {
	n := Len16(word)
	if n > 5 && strings.HasSuffix(word, "ing") {
		return word[:len(word)-3]
	}
	if n > 4 && strings.HasSuffix(word, "ed") {
		return word[:len(word)-2]
	}
	if n > 3 && strings.HasSuffix(word, "s") && !strings.HasSuffix(word, "ss") {
		return word[:len(word)-1]
	}
	return word
}

var notWord = regexp.MustCompile(`[^\p{L}\p{N}\s]+`)

func tokens(text string) map[string]bool {
	words := strings.FieldsFunc(notWord.ReplaceAllString(strings.ToLower(text), " "), isJSSpace)
	meaningful := []string{}
	for _, w := range words {
		if !stopWords[w] {
			meaningful = append(meaningful, w)
		}
	}
	if len(meaningful) == 0 {
		meaningful = words
	}
	set := map[string]bool{}
	for _, w := range meaningful {
		set[stem(w)] = true
	}
	return set
}

// similarity is the Dice coefficient over stemmed, stop-word-free tokens. 1 means the same words.
func similarity(a, b string) float64 {
	ta, tb := tokens(a), tokens(b)
	if len(ta) == 0 || len(tb) == 0 {
		return 0
	}
	shared := 0
	for t := range ta {
		if tb[t] {
			shared++
		}
	}
	return float64(2*shared) / float64(len(ta)+len(tb))
}

func isSimilar(a, b string) bool { return similarity(a, b) >= 0.6 }
