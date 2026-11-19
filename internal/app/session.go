package app

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Session is what wk knows about the current agent session. Kept per machine in ~/.wk/sessions/,
// never in the plan, so a committed .work/ doesn't churn.
type Session struct {
	Started string
	Done    []string
	// LastHome is the home of the last task started this session; "" when none yet.
	LastHome string
	// FreshFor is the task whose check recommended a fresh session.
	FreshFor string
	// Asked lists areas already asked about missing principles this session.
	Asked []string
}

// FreshAfterTasks is how many tasks finish in one session before wk done recommends a fresh one.
const FreshAfterTasks = 3

func sessionFile(ctx *Ctx) string {
	return filepath.Join(ctx.Home, "sessions", "v2-"+pathKey(ctx.Root, 12)+".json")
}

func blankSession() Session {
	return Session{Started: nowISO(), Done: []string{}, Asked: []string{}}
}

func readSession(ctx *Ctx) Session {
	b, err := os.ReadFile(sessionFile(ctx))
	if err != nil {
		return blankSession()
	}
	var raw map[string]any
	if json.Unmarshal(b, &raw) != nil {
		return blankSession()
	}
	strs := func(v any) []string {
		out := []string{}
		if list, ok := v.([]any); ok {
			for _, e := range list {
				out = append(out, jsonString(e))
			}
		}
		return out
	}
	s := Session{Done: strs(raw["done"]), Asked: strs(raw["asked"])}
	if v, ok := raw["started"].(string); ok {
		s.Started = v
	} else {
		s.Started = nowISO()
	}
	s.LastHome, _ = raw["lastHome"].(string)
	s.FreshFor, _ = raw["freshFor"].(string)
	return s
}

// jsonString is String(v) for a value from JSON.parse.
func jsonString(v any) string {
	switch x := v.(type) {
	case float64:
		return JSNum(x)
	case nil:
		return "null"
	}
	return jsString(v)
}

// writeSession is best effort: session state only shapes advice, so a failure never fails a command.
func writeSession(ctx *Ctx, s Session) {
	defer func() { _ = recover() }()
	file := sessionFile(ctx)
	if os.MkdirAll(filepath.Dir(file), 0o755) != nil {
		return
	}
	data := Obj("started", s.Started, "done", s.Done, "lastHome", nullable(s.LastHome), "freshFor", nullable(s.FreshFor), "asked", s.Asked)
	_ = os.WriteFile(file, []byte(JSONStringify(data)+"\n"), 0o644)
}

// startSession: wk brief is the first call of a session, so it starts a new count.
func startSession(ctx *Ctx) { writeSession(ctx, blankSession()) }
