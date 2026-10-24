package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/unraid-mobile/unraid-mobile/internal/spike"
)

func main() {
	report := spike.Inspect(func(path string) error {
		_, err := os.Stat(path)
		return err
	})
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		fmt.Fprintf(os.Stderr, "encode Host Spike report: %v\n", err)
		os.Exit(1)
	}
	if !report.AllAvailable {
		os.Exit(2)
	}
}
