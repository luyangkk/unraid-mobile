package system

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeReader struct {
	raw Raw
	err error
}

func (r *fakeReader) Read(context.Context) (Raw, error) { return r.raw, r.err }

func TestServiceCollect(t *testing.T) {
	t.Run("first sample leaves rates unknown then computes deltas", func(t *testing.T) {
		now := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
		reader := &fakeReader{raw: Raw{Hostname: "Tower", CPUTotal: 100, CPUIdle: 60, MemoryTotal: 8192, MemoryAvailable: 2048, NetworkInterface: "br0", NetworkRX: 100, NetworkTX: 200, NetworkAvailable: true}}
		svc := NewService(reader, func() time.Time { return now })
		first := svc.Collect(context.Background())
		if !first.Available || first.CPUUsage != nil || first.NetworkRXRate != nil || first.MemoryUsedBytes != 6144 {
			t.Fatalf("first = %+v", first)
		}
		now = now.Add(2 * time.Second)
		reader.raw.CPUTotal, reader.raw.CPUIdle = 200, 80
		reader.raw.NetworkRX, reader.raw.NetworkTX = 2100, 4200
		second := svc.Collect(context.Background())
		if second.CPUUsage == nil || *second.CPUUsage != 80 {
			t.Fatalf("CPU = %v", second.CPUUsage)
		}
		if second.NetworkRXRate == nil || *second.NetworkRXRate != 1000 || *second.NetworkTXRate != 2000 {
			t.Fatalf("network = %+v", second)
		}
		if second.Timestamp.Location() != time.UTC {
			t.Fatal("timestamp must be UTC")
		}
	})
	t.Run("resets baselines after read failures or interface changes", func(t *testing.T) {
		now := time.Now()
		r := &fakeReader{raw: Raw{CPUTotal: 100, CPUIdle: 50, NetworkInterface: "br0", NetworkAvailable: true, NetworkRX: 1000}}
		svc := NewService(r, func() time.Time { return now })
		svc.Collect(context.Background())
		now = now.Add(time.Second)
		r.raw.NetworkInterface = "eth0"
		r.raw.NetworkRX = 5000
		r.raw.CPUTotal = 200
		if got := svc.Collect(context.Background()); got.NetworkRXRate != nil {
			t.Fatal("interface switch must reset rate")
		}
		r.err = errors.New("host mounts missing")
		if got := svc.Collect(context.Background()); got.Available || got.CPUUsage != nil || got.Reason == "" {
			t.Fatalf("failure = %+v", got)
		}
		r.err = nil
		now = now.Add(time.Second)
		if got := svc.Collect(context.Background()); got.CPUUsage != nil {
			t.Fatal("recovery needs fresh baseline")
		}
	})
	t.Run("counter resets never underflow", func(t *testing.T) {
		now := time.Now()
		r := &fakeReader{raw: Raw{CPUTotal: 100, CPUIdle: 80, NetworkInterface: "br0", NetworkAvailable: true, NetworkRX: 1000}}
		svc := NewService(r, func() time.Time { return now })
		svc.Collect(context.Background())
		now = now.Add(time.Second)
		r.raw.CPUTotal, r.raw.CPUIdle, r.raw.NetworkRX = 50, 40, 10
		got := svc.Collect(context.Background())
		if got.CPUUsage != nil || got.NetworkRXRate != nil {
			t.Fatalf("reset = %+v", got)
		}
	})
}

func TestServiceSubscribe(t *testing.T) {
	svc := NewService(&fakeReader{raw: Raw{Hostname: "Tower"}}, time.Now)
	svc.Collect(context.Background())
	events, cancel := svc.Subscribe()
	defer cancel()
	if got := <-events; got.Hostname != "Tower" {
		t.Fatalf("bootstrap = %+v", got)
	}
	for i := 0; i < 100; i++ {
		svc.Collect(context.Background())
	}
	select {
	case <-events:
	case <-time.After(time.Second):
		t.Fatal("slow subscriber blocks sampler")
	}
	cancel()
	cancel()
}
