package main

import (
	"context"
	"encoding/json"
	"fmt"
	systemadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/system"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
	"os"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/spike"
)

func main() {
	report := spike.Inspect(func(path string) error {
		_, err := os.Stat(path)
		return err
	})
	reader := systemadapter.NewReader(os.DirFS("/host"))
	reader.Hostname = os.Getenv("SERVER_NAME")
	metrics := system.NewService(reader, time.Now)
	metrics.Collect(context.Background())
	timer := time.NewTimer(time.Second)
	<-timer.C
	snapshot := metrics.Collect(context.Background())
	result := struct {
		spike.Report
		System system.Snapshot `json:"system"`
	}{Report: report, System: snapshot}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintf(os.Stderr, "encode Host Spike report: %v\n", err)
		os.Exit(1)
	}
	if !report.AllAvailable || !snapshot.Available {
		os.Exit(2)
	}
}
