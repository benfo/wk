package app

import "strings"

var settableKeys = []string{"git.branch", "git.commit", "commit_style", "checks.quick", "checks.full", "tracker", "preset", "tags"}

var configAliases = map[string]string{
	"workflow.git.branch":   "git.branch",
	"workflow.git.commit":   "git.commit",
	"workflow.commit_style": "commit_style",
	"workflow.checks.quick": "checks.quick",
	"workflow.checks.full":  "checks.full",
	"workflow.tracker":      "tracker",
}

func oneOf(allowed []string, key string, v string, set bool) string {
	if !set {
		return ""
	}
	if !contains(allowed, v) {
		fail(key + " must be one of: " + strings.Join(allowed, ", "))
	}
	return v
}

func dash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

func configure(ctx *Ctx, action, rawKey, value string, hasValue bool) Result {
	c := ctx.Config
	if action == "" {
		preset := ""
		if c.Preset != "" {
			preset = " · preset: " + c.Preset
		}
		notChosen := func(s string) string {
			if s == "" {
				return "(not chosen)"
			}
			return s
		}
		reviewed := c.Reviewed
		if reviewed == "" {
			reviewed = "never"
		}
		lines := []string{
			"store: " + c.Store + preset,
			"git.branch: " + notChosen(c.Workflow.Branch) + " · git.commit: " + notChosen(c.Workflow.Commit),
			"commit_style: " + dash(c.Workflow.CommitStyle),
			"checks.quick: " + dash(c.Workflow.Quick) + " · checks.full: " + dash(c.Workflow.Full),
			"tracker: " + dash(c.Workflow.Tracker) + " · tags: " + dash(strings.Join(c.Tags, ", ")),
			"reviewed: " + reviewed,
		}
		return resultData(lines, configData(c))
	}
	if action != "set" || rawKey == "" {
		fail("Use: wk config, or wk config set <key> <value>. Keys: " + strings.Join(settableKeys, ", "))
	}
	key := rawKey
	if a, ok := configAliases[rawKey]; ok {
		key = a
	}
	if !contains(settableKeys, key) {
		fail(`Unknown setting "` + rawKey + `". Settable: ` + strings.Join(settableKeys, ", "))
	}
	set := !(!hasValue || Trim(value) == "" || (value == "none" && !strings.HasPrefix(key, "git.")))
	v := ""
	if set {
		v = Trim(value)
	}
	switch key {
	case "git.branch":
		c.Workflow.Branch = oneOf(BranchModes, "git.branch", v, set)
	case "git.commit":
		c.Workflow.Commit = oneOf(CommitModes, "git.commit", v, set)
	case "commit_style":
		c.Workflow.CommitStyle = v
	case "checks.quick":
		c.Workflow.Quick = v
	case "checks.full":
		c.Workflow.Full = v
	case "tracker":
		c.Workflow.Tracker = v
	case "preset":
		c.Preset = oneOf(Presets, "preset", v, set)
	case "tags":
		c.Tags = []string{}
		for _, t := range strings.Split(v, ",") {
			if t = strings.ToLower(Trim(t)); t != "" {
				c.Tags = append(c.Tags, t)
			}
		}
	}
	writeConfig(ctx.Root, c)
	shown := v
	if !set {
		shown = "(cleared)"
	}
	lines := []string{key + ": " + shown}
	if wf := workflowLine(ctx); wf != "" {
		lines = append(lines, wf)
	}
	return resultData(lines, Obj("key", key, "value", nullable(v)))
}

func workflowData(wf Workflow) *OMap {
	return Obj(
		"git", Obj("branch", nullable(wf.Branch), "commit", nullable(wf.Commit)),
		"commit_style", nullable(wf.CommitStyle),
		"checks", Obj("quick", nullable(wf.Quick), "full", nullable(wf.Full)),
		"tracker", nullable(wf.Tracker),
	)
}

func configData(c *Config) *OMap {
	var setup any
	if c.Setup != nil {
		setup = c.Setup
	}
	return Obj("version", c.Version, "store", c.Store, "preset", nullable(c.Preset), "workflow", workflowData(c.Workflow),
		"tags", c.Tags, "reviewed", nullable(c.Reviewed), "setup", setup)
}
