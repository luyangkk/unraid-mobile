package storage

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeProvider struct {
	snapshot Snapshot
	err      error
}

func (p *fakeProvider) Read(context.Context) (Snapshot, error) { return p.snapshot, p.err }
func TestServiceCollect(t *testing.T) {
	now := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	p := &fakeProvider{snapshot: Snapshot{Disks: []Disk{{Name: "disk1", Device: "sdb", Counters: &Counters{ReadBytes: 100, WriteBytes: 200}}}}}
	svc := NewService(p, func() time.Time { return now })
	first := svc.Collect(context.Background())
	if !first.Available || first.Disks[0].ReadBytesPerSecond != nil {
		t.Fatalf("first = %+v", first)
	}
	p.snapshot.Disks[0].Counters = &Counters{ReadBytes: 2148, WriteBytes: 4296}
	now = now.Add(2 * time.Second)
	got := svc.Collect(context.Background())
	if got.Disks[0].ReadBytesPerSecond == nil || *got.Disks[0].ReadBytesPerSecond != 1024 || *got.Disks[0].WriteBytesPerSecond != 2048 {
		t.Fatalf("rates = %+v", got.Disks[0])
	}
	p.err = errors.New("metadata missing")
	if got := svc.Collect(context.Background()); got.Available || got.Reason == "" || len(got.Disks) != 0 {
		t.Fatalf("failure = %+v", got)
	}
	p.err = nil
	now = now.Add(time.Second)
	if got := svc.Collect(context.Background()); got.Disks[0].ReadBytesPerSecond != nil {
		t.Fatal("recovery must reset baseline")
	}
	p.snapshot.Disks[0].Device = "sdc"
	now = now.Add(time.Second)
	if got := svc.Collect(context.Background()); got.Disks[0].ReadBytesPerSecond != nil {
		t.Fatal("replacement disk must reset baseline")
	}
}

func TestServiceLatest(t *testing.T) {
	now := time.Now()
	p := &fakeProvider{snapshot: Snapshot{Array: Array{Capacity: &Capacity{TotalBytes: 100}}, Disks: []Disk{{Name: "disk1", Device: "sdb", Counters: &Counters{ReadBytes: 1000, WriteBytes: 1000}}}}}
	svc := NewService(p, func() time.Time { return now })
	svc.Collect(context.Background())
	copy := svc.Latest()
	copy.Array.Capacity.TotalBytes = 999
	copy.Disks[0].Counters.ReadBytes = 999
	if svc.Latest().Array.Capacity.TotalBytes != 100 {
		t.Fatal("snapshot mutation leaked into service")
	}
	now = now.Add(time.Second)
	p.snapshot.Disks[0].Counters = &Counters{ReadBytes: 1, WriteBytes: 1}
	if got := svc.Collect(context.Background()); got.Disks[0].ReadBytesPerSecond != nil {
		t.Fatal("reset counters must not produce underflow rates")
	}
}
