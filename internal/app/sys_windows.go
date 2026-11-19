package app

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps a console window from flashing up for child processes.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
