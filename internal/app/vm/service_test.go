package vm

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type reader struct {
	snapshot Snapshot
	err      error
	calls    int
}

func (r *reader) Read(context.Context) (Snapshot, error) { r.calls++; return r.snapshot, r.err }

func TestSnapshotsAndRecovery(t *testing.T) {
	at := time.Date(2026, 10, 24, 0, 0, 0, 0, time.FixedZone("local", 28800))
	cpu, ram := uint32(8), uint64(16<<30)
	r := &reader{snapshot: Snapshot{Domains: []Domain{
		{ID: "one", Name: "Windows", State: "running", VCPUs: &cpu, MemoryBytes: &ram},
		{ID: "two", State: "shutoff"}, {ID: "three", State: "paused"},
	}}}
	s := NewService(r, func() time.Time { return at })
	if s.Latest().Available || s.Latest().Domains == nil {
		t.Fatal("initial snapshot must be unavailable with arrays")
	}
	got := s.Collect(context.Background())
	if !got.Available || got.Summary != (Summary{Running: 1, Stopped: 1, Other: 1}) || got.Timestamp.Location() != time.UTC {
		t.Fatalf("snapshot: %+v", got)
	}
	*got.Domains[0].VCPUs = 99
	got.Domains[0].Diagnostics = append(got.Domains[0].Diagnostics, "changed")
	if *s.Latest().Domains[0].VCPUs != 8 || cpu != 8 {
		t.Fatal("snapshot aliases mutable reader or caller data")
	}
	latest := s.Latest()
	*latest.Domains[0].MemoryBytes = 1
	if *s.Latest().Domains[0].MemoryBytes != 16<<30 || r.calls != 1 {
		t.Fatal("Latest modified cache or sampled")
	}
	r.err = errors.New("libvirt unavailable")
	got = s.Collect(context.Background())
	if got.Available || got.Reason != r.err.Error() || len(got.Domains) != 0 {
		t.Fatalf("failure: %+v", got)
	}
	r.err = nil
	if !s.Collect(context.Background()).Available {
		t.Fatal("did not recover")
	}
}

func TestMissingReaderAndConcurrentCacheAccess(t *testing.T) {
	s := NewService(nil, time.Now)
	if s.Latest().Reason != "VM preview disabled" {
		t.Fatal("disabled service appears to be sampling")
	}
	if got := s.Collect(context.Background()); got.Available || got.Reason == "" {
		t.Fatal("missing reader is available")
	}
	s = NewService(&reader{}, time.Now)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				s.Collect(context.Background())
				s.Latest()
			}
		}()
	}
	wg.Wait()
}
