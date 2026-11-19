package app

import (
	"crypto/rand"
	"math/big"
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// IDAlphabet has no 0, 1, i, l or o: ids are read aloud and typed by hand.
const IDAlphabet = "23456789abcdefghjkmnpqrstuvwxyz"
const IDLength = 4
const SlugMax = 40

var (
	itemFileRe = regexp.MustCompile(`^([` + IDAlphabet + `]{4})-[a-z0-9-]*\.md$`)
	idDirRe    = regexp.MustCompile(`^([` + IDAlphabet + `]{4})-[a-z0-9-]*$`)
	idPrefixRe = regexp.MustCompile(`^[` + IDAlphabet + `]{1,4}$`)
)

func isIDPrefix(raw string) bool { return idPrefixRe.MatchString(raw) }

// Pick returns a random index below n; tests and golden runs swap it for a repeatable source.
type Pick func(n int) int

func randomPick(n int) int {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic(err)
	}
	return int(v.Int64())
}

func newID(taken map[string]bool, pick Pick) string {
	if pick == nil {
		pick = randomPick
	}
	for attempt := 0; attempt < 1000; attempt++ {
		var b strings.Builder
		for i := 0; i < IDLength; i++ {
			b.WriteByte(IDAlphabet[pick(len(IDAlphabet))])
		}
		if id := b.String(); !taken[id] {
			return id
		}
	}
	panic("Could not find a free id after 1000 tries.")
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// slugify: lowercase ASCII words joined by dashes, cut at a word boundary to SlugMax characters.
func slugify(title string) string {
	var b strings.Builder
	for _, r := range norm.NFKD.String(title) {
		// Drop the accents NFKD split off: é becomes e.
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(r)
	}
	words := strings.Fields(Trim(nonSlug.ReplaceAllString(strings.ToLower(b.String()), " ")))
	slug := ""
	for _, w := range words {
		next := w
		if slug != "" {
			next = slug + "-" + w
		}
		if len(next) > SlugMax {
			break
		}
		slug = next
	}
	if slug != "" {
		return slug
	}
	if len(words) > 0 {
		return Slice16(words[0], SlugMax)
	}
	return "item"
}
