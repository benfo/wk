// Command wk tracks work in plain text for agent sessions.
package main

import (
	"fmt"
	"os"

	"github.com/benfo/wk/internal/app"
)

func main() {
	out := app.Run(os.Args[1:], app.RunOptions{})
	if out.Stdout != "" {
		fmt.Fprintln(os.Stdout, out.Stdout)
	}
	if out.Stderr != "" {
		fmt.Fprintln(os.Stderr, out.Stderr)
	}
	os.Exit(out.Code)
}
