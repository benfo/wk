// Package wk holds the files the wk binary ships: the agent skills and the guides.
package wk

import "embed"

// Assets holds skills/<name>/SKILL.md and guides/<topic>.md, embedded at build time.
//
//go:embed skills guides
var Assets embed.FS
