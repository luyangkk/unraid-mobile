package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/unraid-mobile/unraid-mobile/internal/spike"
)

// main wires signal cancellation and explicit Spike-only environment flags.
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := execute(ctx, os.Stdout, spike.ConfigFromEnvironment(os.Getenv))
	stop()
	if code == 1 {
		fmt.Fprintln(os.Stderr, "Host Spike internal or report output failure")
	}
	os.Exit(code)
}

// execute emits a sanitized report and preserves its capability exit status.
func execute(ctx context.Context, out io.Writer, config spike.Config) int {
	return spike.WriteReport(out, spike.Run(ctx, config))
}
