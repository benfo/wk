package app

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Frontmatter values are what js-yaml gives wk after normalising: nil (null), string, float64,
// bool or []string. Dates come back as YYYY-MM-DD strings. A key that's absent is JS undefined.

// yamlValue converts a parsed YAML node to plain values: *OMap, []any, string, float64, bool or nil.
// Dates come back as time.Time, as js-yaml returns Date objects.
func yamlValue(n *yaml.Node) any {
	switch n.Kind {
	case yaml.DocumentNode:
		if len(n.Content) == 0 {
			return nil
		}
		return yamlValue(n.Content[0])
	case yaml.AliasNode:
		return yamlValue(n.Alias)
	case yaml.MappingNode:
		m := NewOMap()
		for i := 0; i+1 < len(n.Content); i += 2 {
			m.Set(n.Content[i].Value, yamlValue(n.Content[i+1]))
		}
		return m
	case yaml.SequenceNode:
		out := []any{}
		for _, c := range n.Content {
			out = append(out, yamlValue(c))
		}
		return out
	}
	switch n.ShortTag() {
	case "!!null":
		return nil
	case "!!bool":
		var b bool
		if n.Decode(&b) == nil {
			return b
		}
	case "!!int":
		var i int64
		if n.Decode(&i) == nil {
			return float64(i)
		}
		var f float64
		if n.Decode(&f) == nil {
			return f
		}
	case "!!float":
		var f float64
		if n.Decode(&f) == nil {
			return f
		}
	case "!!timestamp":
		var t time.Time
		if n.Decode(&t) == nil {
			return t
		}
	}
	return n.Value
}

// parseYAML reads a YAML document into plain values.
func parseYAML(text string) (any, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(text), &doc); err != nil {
		return nil, err
	}
	if doc.Kind == 0 {
		return nil, nil
	}
	return yamlValue(&doc), nil
}

// jsString is String(v) for a parsed YAML value.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case float64:
		return JSNum(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case time.Time:
		return x.UTC().Format("2006-01-02T15:04:05.000Z")
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e == nil {
				parts[i] = ""
			} else {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	case *OMap:
		return "[object Object]"
	}
	return ""
}

func normalise(raw any) any {
	switch x := raw.(type) {
	case time.Time:
		return x.UTC().Format("2006-01-02")
	case []any:
		out := make([]string, len(x))
		for i, e := range x {
			out[i] = jsString(e)
		}
		return out
	case nil, string, float64, bool:
		return x
	}
	return jsString(raw)
}

// parseFrontmatter splits a markdown file with YAML frontmatter, following gray-matter's steps.
func parseFrontmatter(text string) (*OMap, string) {
	data := NewOMap()
	content := text
	if strings.HasPrefix(text, "---") && !(len(text) > 3 && text[3] == '-') {
		str := text[3:]
		// A language name may follow the opening dashes; wk only writes YAML.
		if nl := strings.Index(str, "\n"); nl > 0 {
			lang := strings.TrimSuffix(str[:nl], "\r")
			str = str[len(lang):]
		}
		closeIndex := strings.Index(str, "\n---")
		var matter string
		if closeIndex < 0 {
			matter = str
			content = ""
		} else {
			matter = str[:closeIndex]
			content = str[closeIndex+4:]
			content = strings.TrimPrefix(content, "\r")
			content = strings.TrimPrefix(content, "\n")
		}
		if Trim(commentLine.ReplaceAllString(matter, "")) != "" {
			v, err := parseYAML(matter)
			if err != nil {
				panic(err)
			}
			if m, ok := v.(*OMap); ok {
				for _, k := range m.Keys() {
					val, _ := m.Get(k)
					data.Set(k, normalise(val))
				}
			}
		}
	}
	return data, TrimEnd(strings.TrimLeft(content, "\n"))
}

var commentLine = regexp.MustCompile(`(?m)^\s*#[^\n]+`)

var (
	dateRe  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	riskyRe = regexp.MustCompile(`(?i)^[\s\-?:,\[\]{}#&*!|>'"%@` + "`" + `]|\s$|: | #|^(true|false|null|yes|no|on|off|~)$|^[+-]?[\d.]`)
)

func fmScalar(v string) string {
	if v == "" {
		return `""`
	}
	if dateRe.MatchString(v) {
		return v
	}
	if riskyRe.MatchString(v) || strings.Contains(v, "\n") {
		return jsonQuote(v)
	}
	return v
}

// stringifyFrontmatter writes frontmatter in a fixed key order with minimal quoting, so files stay
// readable and diffs stay small. Absent keys are dropped, nil prints empty.
func stringifyFrontmatter(data *OMap, body string, order []string) string {
	keys := []string{}
	for _, k := range order {
		if data.Has(k) {
			keys = append(keys, k)
		}
	}
	for _, k := range data.Keys() {
		if !contains(order, k) {
			keys = append(keys, k)
		}
	}
	out := []string{"---"}
	for _, key := range keys {
		v, _ := data.Get(key)
		switch x := v.(type) {
		case nil:
			out = append(out, key+":")
		case []string:
			parts := make([]string, len(x))
			for i, s := range x {
				parts[i] = fmScalar(s)
			}
			out = append(out, key+": ["+strings.Join(parts, ", ")+"]")
		case string:
			out = append(out, key+": "+fmScalar(x))
		case float64:
			out = append(out, key+": "+JSNum(x))
		case bool:
			out = append(out, key+": "+jsString(x))
		default:
			out = append(out, key+": "+jsString(x))
		}
	}
	out = append(out, "---")
	trimmed := Trim(body)
	tail := ""
	if trimmed != "" {
		tail = trimmed + "\n"
	}
	return strings.Join(out, "\n") + "\n" + tail
}

// --- js-yaml dump, for config.yml -------------------------------------------------------------

func isPrintable(c rune) bool {
	return (0x20 <= c && c <= 0x7e) || ((0xa1 <= c && c <= 0xd7ff) && c != 0x2028 && c != 0x2029) ||
		((0xe000 <= c && c <= 0xfffd) && c != 0xfeff) || (0x10000 <= c && c <= 0x10ffff) || c == 0x85 || c == 0xa0
}

func isWhite(c rune) bool { return c == ' ' || c == '\t' }

func isNsCharOrWhitespace(c rune) bool {
	return isPrintable(c) && c != 0xfeff && c != '\r' && c != '\n'
}

func isPlainSafe(c, prev rune, hasPrev bool) bool {
	cNsOrWs := isNsCharOrWhitespace(c)
	cNs := cNsOrWs && !isWhite(c)
	return (cNsOrWs && c != '#' && !(hasPrev && prev == ':' && !cNs)) ||
		(hasPrev && isNsCharOrWhitespace(prev) && !isWhite(prev) && c == '#') ||
		(hasPrev && prev == ':' && cNs)
}

func isPlainSafeFirst(c rune) bool {
	return isPrintable(c) && c != 0xfeff && !isWhite(c) && !strings.ContainsRune("-?:,[]{}#&*!|=>'\"%@`", c)
}

func isPlainSafeLast(c rune) bool { return !isWhite(c) && c != ':' }

var (
	yamlNullRe  = regexp.MustCompile(`^(?:~|null|Null|NULL)?$`)
	yamlBoolRe  = regexp.MustCompile(`^(?:true|True|TRUE|false|False|FALSE)$`)
	yamlIntRe   = regexp.MustCompile(`^[-+]?(?:0b[01_]+|0x[0-9a-fA-F_]+|0o?[0-7_]+|[0-9][0-9_]*|0)$`)
	yamlFloatRe = regexp.MustCompile(`^(?:[-+]?(?:[0-9][0-9_]*)(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$`)
	yamlDateRe  = regexp.MustCompile(`^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$`)
	deprecated  = map[string]bool{"y": true, "Y": true, "yes": true, "Yes": true, "YES": true, "on": true, "On": true, "ON": true, "n": true, "N": true, "no": true, "No": true, "NO": true, "off": true, "Off": true, "OFF": true}
)

// ambiguous is true when a plain scalar would read back as something other than a string.
func ambiguous(s string) bool {
	if yamlNullRe.MatchString(s) || yamlBoolRe.MatchString(s) || s == "<<" || yamlDateRe.MatchString(s) {
		return true
	}
	if yamlIntRe.MatchString(s) && s != "_" && !strings.HasSuffix(s, "_") {
		return true
	}
	return yamlFloatRe.MatchString(s) && s != "." && !strings.HasSuffix(s, "_")
}

// yamlScalar writes a string the way js-yaml's dump does for a single-line value.
func yamlScalar(s string) string {
	if s == "" {
		return "''"
	}
	if deprecated[s] {
		return "'" + s + "'"
	}
	runes := []rune(s)
	plain := isPlainSafeFirst(runes[0]) && isPlainSafeLast(runes[len(runes)-1])
	double := false
	for i, c := range runes {
		if !isPrintable(c) {
			double = true
			break
		}
		var prev rune
		if i > 0 {
			prev = runes[i-1]
		}
		plain = plain && isPlainSafe(c, prev, i > 0)
	}
	if double {
		return yamlDouble(s)
	}
	if plain && !ambiguous(s) {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func yamlDouble(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	esc := map[rune]string{0: `\0`, 7: `\a`, 8: `\b`, 9: `\t`, 10: `\n`, 11: `\v`, 12: `\f`, 13: `\r`, 27: `\e`, '"': `\"`, '\\': `\\`, 0x85: `\N`, 0xa0: `\_`, 0x2028: `\L`, 0x2029: `\P`}
	for _, c := range s {
		if e, ok := esc[c]; ok {
			b.WriteString(e)
		} else if isPrintable(c) {
			b.WriteRune(c)
		} else if c <= 0xff {
			b.WriteString(`\x` + strings.ToUpper(pad2(strconv.FormatInt(int64(c), 16))))
		} else if c <= 0xffff {
			b.WriteString(`\u` + strings.ToUpper(pad4(strconv.FormatInt(int64(c), 16))))
		} else {
			b.WriteString(`\U` + strings.ToUpper(strings.Repeat("0", 8-len(strconv.FormatInt(int64(c), 16)))+strconv.FormatInt(int64(c), 16)))
		}
	}
	b.WriteByte('"')
	return b.String()
}

func pad2(s string) string { return strings.Repeat("0", 2-len(s)) + s }
func pad4(s string) string { return strings.Repeat("0", 4-len(s)) + s }

// yamlDump writes an OMap as js-yaml's block style, two-space indent.
func yamlDump(m *OMap, indent string) string {
	var b strings.Builder
	for _, k := range m.Keys() {
		v, _ := m.Get(k)
		key := yamlScalar(k)
		switch x := v.(type) {
		case *OMap:
			if x.Len() == 0 {
				b.WriteString(indent + key + ": {}\n")
			} else {
				b.WriteString(indent + key + ":\n" + yamlDump(x, indent+"  "))
			}
		case []string:
			if len(x) == 0 {
				b.WriteString(indent + key + ": []\n")
			} else {
				b.WriteString(indent + key + ":\n")
				for _, s := range x {
					b.WriteString(indent + "  - " + yamlScalar(s) + "\n")
				}
			}
		default:
			b.WriteString(indent + key + ": " + yamlPlainValue(x) + "\n")
		}
	}
	return b.String()
}

func yamlPlainValue(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return yamlScalar(x)
	case float64:
		if math.IsInf(x, 1) {
			return ".inf"
		}
		return JSNum(x)
	case int:
		return itoa(x)
	case bool:
		return jsString(x)
	}
	return "null"
}
