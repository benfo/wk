package app

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
)

// Helpers that reproduce JavaScript semantics wk's output depends on: insertion-ordered objects,
// JSON.stringify, number formatting, UTF-16 string lengths, trim and localeCompare.

// OMap is an object that keeps insertion order, like a JS object with string keys.
type OMap struct {
	keys []string
	vals map[string]any
}

func NewOMap() *OMap { return &OMap{vals: map[string]any{}} }

// Obj builds an OMap from key, value pairs.
func Obj(kv ...any) *OMap {
	m := NewOMap()
	for i := 0; i+1 < len(kv); i += 2 {
		m.Set(kv[i].(string), kv[i+1])
	}
	return m
}

func (m *OMap) Get(k string) (any, bool) {
	v, ok := m.vals[k]
	return v, ok
}

func (m *OMap) Has(k string) bool {
	_, ok := m.vals[k]
	return ok
}

// Set keeps an existing key's position and appends a new one, like assigning to a JS object.
func (m *OMap) Set(k string, v any) {
	if _, ok := m.vals[k]; !ok {
		m.keys = append(m.keys, k)
	}
	m.vals[k] = v
}

func (m *OMap) Delete(k string) {
	if _, ok := m.vals[k]; !ok {
		return
	}
	delete(m.vals, k)
	for i, key := range m.keys {
		if key == k {
			m.keys = append(m.keys[:i:i], m.keys[i+1:]...)
			break
		}
	}
}

func (m *OMap) Keys() []string { return append([]string(nil), m.keys...) }

func (m *OMap) Len() int { return len(m.keys) }

func (m *OMap) Clone() *OMap {
	c := NewOMap()
	for _, k := range m.keys {
		c.Set(k, m.vals[k])
	}
	return c
}

// Spread copies every key of src into m, like {...m, ...src}.
func (m *OMap) Spread(src *OMap) *OMap {
	if src != nil {
		for _, k := range src.keys {
			m.Set(k, src.vals[k])
		}
	}
	return m
}

// JSONStringify matches JSON.stringify(v, null, 2).
func JSONStringify(v any) string {
	var b strings.Builder
	writeJSON(&b, v, "")
	return b.String()
}

func writeJSON(b *strings.Builder, v any, indent string) {
	inner := indent + "  "
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		b.WriteString(jsonQuote(x))
	case int:
		b.WriteString(strconv.Itoa(x))
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			b.WriteString("null")
		} else {
			b.WriteString(JSNum(x))
		}
	case []string:
		if len(x) == 0 {
			b.WriteString("[]")
			return
		}
		b.WriteString("[\n")
		for i, s := range x {
			b.WriteString(inner)
			b.WriteString(jsonQuote(s))
			if i < len(x)-1 {
				b.WriteString(",")
			}
			b.WriteString("\n")
		}
		b.WriteString(indent + "]")
	case []any:
		if len(x) == 0 {
			b.WriteString("[]")
			return
		}
		b.WriteString("[\n")
		for i, e := range x {
			b.WriteString(inner)
			writeJSON(b, e, inner)
			if i < len(x)-1 {
				b.WriteString(",")
			}
			b.WriteString("\n")
		}
		b.WriteString(indent + "]")
	case *OMap:
		if x == nil {
			b.WriteString("null")
			return
		}
		if x.Len() == 0 {
			b.WriteString("{}")
			return
		}
		b.WriteString("{\n")
		for i, k := range x.keys {
			b.WriteString(inner)
			b.WriteString(jsonQuote(k))
			b.WriteString(": ")
			writeJSON(b, x.vals[k], inner)
			if i < len(x.keys)-1 {
				b.WriteString(",")
			}
			b.WriteString("\n")
		}
		b.WriteString(indent + "}")
	default:
		b.WriteString("null")
	}
}

// jsonQuote escapes like JSON.stringify: quotes, backslashes and control characters only.
func jsonQuote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteString(strconv.FormatInt(int64(r)>>4, 16))
				b.WriteString(strconv.FormatInt(int64(r)&0xf, 16))
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// JSNum formats a number like String(n) in JavaScript.
func JSNum(f float64) string {
	if math.IsNaN(f) {
		return "NaN"
	}
	if math.IsInf(f, 1) {
		return "Infinity"
	}
	if math.IsInf(f, -1) {
		return "-Infinity"
	}
	if f == 0 {
		return "0"
	}
	abs := math.Abs(f)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		// Go writes 1e+21 and 1e-07; JS writes 1e+21 and 1e-7.
		mant, exp, _ := strings.Cut(s, "e")
		sign := exp[0]
		digits := strings.TrimLeft(exp[1:], "0")
		return mant + "e" + string(sign) + digits
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// Len16 is a string's length in UTF-16 code units, like JS .length.
func Len16(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// Slice16 is s.slice(0, n) in UTF-16 code units.
func Slice16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if n >= len(u) {
		return s
	}
	if n < 0 {
		n = 0
	}
	return string(utf16.Decode(u[:n]))
}

// PadEnd is s.padEnd(n) with spaces.
func PadEnd(s string, n int) string {
	if l := Len16(s); l < n {
		return s + strings.Repeat(" ", n-l)
	}
	return s
}

func isJSSpace(r rune) bool {
	return unicode.IsSpace(r) || r == 0xFEFF
}

// Trim is JS String.prototype.trim.
func Trim(s string) string { return strings.TrimFunc(s, isJSSpace) }

func TrimEnd(s string) string { return strings.TrimRightFunc(s, isJSSpace) }

func TrimStart(s string) string { return strings.TrimLeftFunc(s, isJSSpace) }

// LocaleCompare approximates a.localeCompare(b) under the default ICU collation for the text wk
// sorts (ids, tags, dates): letters compare case-insensitively first, and lowercase sorts first.
func LocaleCompare(a, b string) int {
	la, lb := strings.ToLower(a), strings.ToLower(b)
	if la != lb {
		if la < lb {
			return -1
		}
		return 1
	}
	ra, rb := []rune(a), []rune(b)
	for i := 0; i < len(ra) && i < len(rb); i++ {
		if ra[i] != rb[i] {
			if unicode.IsLower(ra[i]) {
				return -1
			}
			return 1
		}
	}
	return 0
}

func cmpStr(a, b string) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

// SortStable sorts like Array.prototype.sort with a comparator (stable).
func SortStable[T any](list []T, cmp func(a, b T) int) {
	sort.SliceStable(list, func(i, j int) bool { return cmp(list[i], list[j]) < 0 })
}

func filter[T any](list []T, keep func(T) bool) []T {
	out := []T{}
	for _, v := range list {
		if keep(v) {
			out = append(out, v)
		}
	}
	return out
}

func mapList[T, U any](list []T, fn func(T) U) []U {
	out := make([]U, 0, len(list))
	for _, v := range list {
		out = append(out, fn(v))
	}
	return out
}

func some[T any](list []T, test func(T) bool) bool {
	for _, v := range list {
		if test(v) {
			return true
		}
	}
	return false
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func indexOf[T comparable](list []T, v T) int {
	for i, x := range list {
		if x == v {
			return i
		}
	}
	return -1
}

// uniq keeps the first of each value, in order, like [...new Set(list)].
func uniq(list []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range list {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func head[T any](list []T, n int) []T {
	if len(list) <= n {
		return list
	}
	return list[:n]
}

func plural(n int, word string) string {
	return pluralMany(n, word, word+"s")
}

func pluralMany(n int, word, many string) string {
	if n == 1 {
		return strconv.Itoa(n) + " " + word
	}
	return strconv.Itoa(n) + " " + many
}

func itoa(n int) string { return strconv.Itoa(n) }

// splitLines splits on \n like text.split("\n").
func splitLines(s string) []string { return strings.Split(s, "\n") }

func crlf(s string) string { return strings.ReplaceAll(s, "\r\n", "\n") }
