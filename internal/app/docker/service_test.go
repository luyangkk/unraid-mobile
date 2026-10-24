package docker

import (
	"context"
	"errors"
	"testing"
	"time"
)

type testReader struct {
	raw Raw
	err error
}

// Read supplies controlled Engine samples without host dependencies.
func (r *testReader) Read(context.Context) (Raw, error) { return r.raw, r.err }

// number creates an independently owned optional counter.
func number(v uint64) *uint64 { return &v }

// sample supplies two network interfaces and working-set memory.
func sample(at time.Time, cpu, system, rx uint64) Raw {
	start := at.Add(-time.Hour)
	return Raw{Containers: []RawContainer{{
		ID: "full-id", Name: "Plex", State: "running", StartedAt: &start,
		Stats: &Stats{
			Read: at, CPUUsage: number(cpu), SystemUsage: number(system), OnlineCPUs: 4,
			MemoryUsage: number(1000), MemoryLimit: number(2000),
			MemoryStats: map[string]uint64{"inactive_file": 200, "cache": 300},
			Networks:    map[string]Network{"eth0": {RXBytes: rx, TXBytes: rx * 2}, "eth1": {RXBytes: 50, TXBytes: 100}},
		},
	}}}
}

// TestServiceDeltas uses Engine time rather than the wall-clock collection gap.
func TestServiceDeltas(t *testing.T) {
	at := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	reader := &testReader{raw: sample(at, 100, 1000, 100)}
	service := NewService(reader, func() time.Time { return at.Add(20 * time.Second) })
	first := service.Collect(context.Background())
	c := first.Containers[0]
	if !first.Available || c.CPUUsage != nil || c.NetworkRXRate != nil || c.NetworkTXRate != nil {
		t.Fatalf("first sample: %+v", c)
	}
	if *c.MemoryUsedBytes != 800 || *c.MemoryLimitBytes != 2000 || *c.UptimeSeconds != 3620 {
		t.Fatalf("memory/uptime: %+v", c)
	}
	reader.raw = sample(at.Add(2*time.Second), 150, 2000, 300)
	reader.raw.Containers[0].StartedAt = firstStart(at)
	second := service.Collect(context.Background())
	c = second.Containers[0]
	if c.CPUUsage == nil || *c.CPUUsage != 20 || c.NetworkRXRate == nil || *c.NetworkRXRate != 100 || *c.NetworkTXRate != 200 {
		t.Fatalf("second deltas: %+v", c)
	}
	*c.CPUUsage = 999
	c.Diagnostics = append(c.Diagnostics, "mutated")
	second.Containers[0].Name = "changed"
	cached := service.Latest()
	if *cached.Containers[0].CPUUsage != 20 || cached.Containers[0].Name != "Plex" || len(cached.Containers[0].Diagnostics) != 0 {
		t.Fatal("Collect exposed cache aliases")
	}
	*cached.Containers[0].MemoryUsedBytes = 9
	if *service.Latest().Containers[0].MemoryUsedBytes != 800 {
		t.Fatal("Latest exposed pointer aliases")
	}
}

// firstStart keeps identity stable while Engine sample time changes.
func firstStart(at time.Time) *time.Time { start := at.Add(-time.Hour); return &start }

// TestServiceResets prevents false rates after restarts, gaps, or regressions.
func TestServiceResets(t *testing.T) {
	at := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	for _, kind := range []string{"restart", "stats failure", "inspect failure", "read failure", "cpu reset", "network reset", "network identity", "invalid time", "stopped"} {
		t.Run(kind, func(t *testing.T) {
			reader := &testReader{raw: sample(at, 100, 1000, 100)}
			service := NewService(reader, func() time.Time { return at.Add(time.Hour) })
			service.Collect(context.Background())
			reader.raw = sample(at.Add(2*time.Second), 150, 2000, 300)
			reader.raw.Containers[0].StartedAt = firstStart(at)
			switch kind {
			case "restart":
				start := at.Add(time.Second)
				reader.raw.Containers[0].StartedAt = &start
			case "stats failure":
				reader.raw.Containers[0].Stats = nil
			case "inspect failure":
				reader.raw.Containers[0].StartedAt = nil
			case "read failure":
				reader.err = errors.New("socket unavailable")
			case "cpu reset":
				reader.raw.Containers[0].Stats.CPUUsage = number(1)
			case "network reset":
				reader.raw.Containers[0].Stats.Networks["eth0"] = Network{RXBytes: 1, TXBytes: 2}
			case "network identity":
				delete(reader.raw.Containers[0].Stats.Networks, "eth1")
			case "invalid time":
				reader.raw.Containers[0].Stats.Read = at
			case "stopped":
				reader.raw.Containers[0].State = "exited"
			}
			got := service.Collect(context.Background())
			if kind == "read failure" {
				if got.Available || got.Reason == "" {
					t.Fatal("missing unavailable state")
				}
			} else {
				c := got.Containers[0]
				if kind != "network reset" && kind != "network identity" && c.CPUUsage != nil {
					t.Fatalf("unexpected CPU: %v", *c.CPUUsage)
				}
				if kind != "cpu reset" && c.NetworkRXRate != nil {
					t.Fatalf("unexpected RX: %v", *c.NetworkRXRate)
				}
			}
			reader.err = nil
			reader.raw = sample(at.Add(4*time.Second), 200, 3000, 500)
			reader.raw.Containers[0].StartedAt = firstStart(at)
			recovery := service.Collect(context.Background()).Containers[0]
			if kind == "read failure" || kind == "stats failure" || kind == "inspect failure" || kind == "stopped" || kind == "restart" || kind == "invalid time" {
				if recovery.CPUUsage != nil || recovery.NetworkRXRate != nil {
					t.Fatalf("recovery fabricated deltas: %+v", recovery)
				}
			}
		})
	}
}

// TestServiceUnavailableReason retains actionable, adapter-sanitized failures.
func TestServiceUnavailableReason(t *testing.T) {
	reader := &testReader{err: errors.New("Docker Engine API version unsupported")}
	snapshot := NewService(reader, time.Now).Collect(context.Background())
	if snapshot.Available || snapshot.Reason != "Docker Engine API version unsupported" {
		t.Fatalf("failure reason = %q", snapshot.Reason)
	}
}

// TestServiceMemoryAndSummary verifies cache fallbacks and non-running metrics.
func TestServiceMemoryAndSummary(t *testing.T) {
	at := time.Now()
	reader := &testReader{raw: sample(at, 10, 100, 20)}
	delete(reader.raw.Containers[0].Stats.MemoryStats, "inactive_file")
	reader.raw.Containers = append(reader.raw.Containers, RawContainer{ID: "stop", State: "created"}, RawContainer{ID: "other", State: "paused"})
	service := NewService(reader, func() time.Time { return at })
	got := service.Collect(context.Background())
	if *got.Containers[0].MemoryUsedBytes != 700 || got.Summary != (Summary{Running: 1, Stopped: 1, Other: 1}) {
		t.Fatalf("snapshot: %+v", got)
	}
	reader.raw.Containers[0].Stats.MemoryStats["cache"] = 2000
	if *service.Collect(context.Background()).Containers[0].MemoryUsedBytes != 1000 {
		t.Fatal("memory subtraction underflow")
	}
	reader.raw = Raw{}
	got = service.Collect(context.Background())
	if !got.Available || got.Containers == nil || got.Diagnostics == nil || len(got.Containers) != 0 {
		t.Fatalf("empty configuration: %+v", got)
	}
}

type blockingReader struct{ entered, release chan struct{} }

// Read simulates a stalled socket until the caller releases it.
func (r blockingReader) Read(ctx context.Context) (Raw, error) {
	close(r.entered)
	select {
	case <-r.release:
		return Raw{}, nil
	case <-ctx.Done():
		return Raw{}, ctx.Err()
	}
}

// TestLatestDoesNotWaitForEngine prevents network I/O from holding the cache lock.
func TestLatestDoesNotWaitForEngine(t *testing.T) {
	r := blockingReader{entered: make(chan struct{}), release: make(chan struct{})}
	s := NewService(r, time.Now)
	done := make(chan struct{})
	go func() { s.Collect(context.Background()); close(done) }()
	<-r.entered
	latest := make(chan Snapshot, 1)
	go func() { latest <- s.Latest() }()
	select {
	case <-latest:
	case <-time.After(time.Second):
		t.Error("Latest blocked on Engine")
	}
	close(r.release)
	<-done
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.Run(ctx)
}
