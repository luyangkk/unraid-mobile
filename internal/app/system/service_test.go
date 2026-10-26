package system

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// networkRaw creates independent synthetic counters with an optional observed identity.
func networkRaw(name string, rx, tx uint64, identity *uint64) NetworkInterfaceRaw {
	return NetworkInterfaceRaw{Name: name, Available: true, RX: rx, TX: tx, Identity: identity}
}

// assertNetworkRates checks literal independently calculated rates in a complete snapshot.
func assertNetworkRates(t *testing.T, got Snapshot, name string, rx, tx *float64) {
	t.Helper()
	for _, item := range got.NetworkInterfaces {
		if item.Name != name {
			continue
		}
		if (item.RXBytesPerSecond == nil) != (rx == nil) || (item.TXBytesPerSecond == nil) != (tx == nil) ||
			(rx != nil && *item.RXBytesPerSecond != *rx) || (tx != nil && *item.TXBytesPerSecond != *tx) {
			t.Fatalf("%s rates = %+v, want RX=%v TX=%v", name, item, rx, tx)
		}
		return
	}
	t.Fatalf("interface %s missing: %+v", name, got)
}

// TestServiceNetworkIndependentBaselines checks per-interface deltas and Auto projection.
func TestServiceNetworkIndependentBaselines(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	reader := &fakeReader{raw: Raw{NetworkInterface: "br0", NetworkAvailable: true, NetworkRX: 999999,
		NetworkInterfaces: []NetworkInterfaceRaw{networkRaw("eth0", 1000, 2000, nil), networkRaw("br0", 100, 200, nil)}}}
	svc := NewService(reader, func() time.Time { return now })
	first := svc.Collect(context.Background())
	assertNetworkRates(t, first, "br0", nil, nil)
	assertNetworkRates(t, first, "eth0", nil, nil)
	if first.NetworkInterfaces[0].Name != "br0" {
		t.Fatalf("unstable ordering: %+v", first.NetworkInterfaces)
	}
	now = now.Add(2 * time.Second)
	reader.raw.NetworkInterface = "eth0"
	reader.raw.NetworkInterfaces = []NetworkInterfaceRaw{networkRaw("eth0", 3000, 6000, nil), networkRaw("br0", 100, 200, nil), networkRaw("lo", 10, 10, nil)}
	got := svc.Collect(context.Background())
	rx, tx, zero := 1000.0, 2000.0, 0.0
	assertNetworkRates(t, got, "eth0", &rx, &tx)
	assertNetworkRates(t, got, "br0", &zero, &zero)
	assertNetworkRates(t, got, "lo", nil, nil)
	if got.NetworkRXRate == nil || *got.NetworkRXRate != rx || got.NetworkTXRate == nil || *got.NetworkTXRate != tx {
		t.Fatalf("Auto must use eth0's tracked baseline, not legacy counters: %+v", got)
	}
	now = now.Add(2 * time.Second)
	reader.raw.NetworkInterface, reader.raw.NetworkAvailable = "", false
	reader.raw.NetworkInterfaces[0].RX, reader.raw.NetworkInterfaces[0].TX = 5000, 10000
	got = svc.Collect(context.Background())
	assertNetworkRates(t, got, "eth0", &rx, &tx)
	if !got.Available || got.NetworkRXRate != nil || got.NetworkTXRate != nil {
		t.Fatalf("Auto failure must not discard manual rates: %+v", got)
	}
	reader.raw.NetworkInterface, reader.raw.NetworkAvailable = "eth0", true
	reader.raw.NetworkInterfaces = []NetworkInterfaceRaw{}
	now = now.Add(time.Second)
	got = svc.Collect(context.Background())
	if len(got.NetworkInterfaces) != 0 || got.NetworkRXRate != nil || got.NetworkTXRate != nil {
		t.Fatalf("explicit empty array must not fall back to old Raw counters: %+v", got)
	}
}

// TestServiceNetworkResetsAreIsolated checks failures without disturbing healthy interfaces.
func TestServiceNetworkResetsAreIsolated(t *testing.T) {
	for _, scenario := range []string{"rx rollback", "tx rollback", "local failure", "removal", "identity change", "identity loss", "identity recovery", "reader failure", "network failure", "same timestamp", "older timestamp"} {
		t.Run(scenario, func(t *testing.T) {
			now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
			id, newID := uint64(2), uint64(3)
			reader := &fakeReader{raw: Raw{CPUTotal: 100, CPUIdle: 50, NetworkInterface: "br0", NetworkAvailable: true,
				NetworkInterfaces: []NetworkInterfaceRaw{networkRaw("br0", 100, 200, &id), networkRaw("eth0", 1000, 2000, nil)}}}
			if scenario == "identity recovery" {
				reader.raw.NetworkInterfaces[0].Identity = nil
			}
			svc := NewService(reader, func() time.Time { return now })
			svc.Collect(context.Background())
			now = now.Add(2 * time.Second)
			reader.raw.CPUTotal, reader.raw.CPUIdle = 200, 70
			reader.raw.NetworkInterfaces[0].RX, reader.raw.NetworkInterfaces[0].TX = 300, 600
			reader.raw.NetworkInterfaces[1].RX, reader.raw.NetworkInterfaces[1].TX = 1200, 2400
			switch scenario {
			case "rx rollback":
				reader.raw.NetworkInterfaces[0].RX = 10
			case "tx rollback":
				reader.raw.NetworkInterfaces[0].TX = 10
			case "local failure":
				reader.raw.NetworkInterfaces[0].Available = false
				reader.raw.NetworkInterfaces[0].Reason = "invalid counters"
			case "removal":
				reader.raw.NetworkInterfaces = reader.raw.NetworkInterfaces[1:]
			case "identity change":
				reader.raw.NetworkInterfaces[0].Identity = &newID
			case "identity loss":
				reader.raw.NetworkInterfaces[0].Identity = nil
			case "identity recovery":
				reader.raw.NetworkInterfaces[0].Identity = &newID
			case "reader failure":
				reader.err = errors.New("host read failed")
			case "network failure":
				reader.raw.NetworkInterfaces = []NetworkInterfaceRaw{}
				reader.raw.NetworkAvailable = false
			case "same timestamp":
				now = now.Add(-2 * time.Second)
			case "older timestamp":
				now = now.Add(-3 * time.Second)
			}
			got := svc.Collect(context.Background())
			globalReset := scenario == "reader failure" || scenario == "network failure" || scenario == "same timestamp" || scenario == "older timestamp"
			if scenario != "removal" && !globalReset {
				assertNetworkRates(t, got, "br0", nil, nil)
			}
			if !globalReset {
				rx, tx := 100.0, 200.0
				assertNetworkRates(t, got, "eth0", &rx, &tx)
			}
			if got.NetworkRXRate != nil || got.NetworkTXRate != nil {
				t.Fatalf("both Auto directions must reset: %+v", got)
			}
			if scenario == "local failure" && (got.NetworkInterfaces[0].Available || got.NetworkInterfaces[0].Reason != "invalid counters") {
				t.Fatalf("unavailable interface lost reason: %+v", got)
			}
			if scenario == "network failure" && (!got.Available || got.CPUUsage == nil || *got.CPUUsage != 80) {
				t.Fatalf("network failure affected System: %+v", got)
			}
			now = now.Add(2 * time.Second)
			reader.err = nil
			reader.raw.NetworkAvailable = true
			reader.raw.NetworkInterfaces = []NetworkInterfaceRaw{networkRaw("br0", 500, 1000, &id), networkRaw("eth0", 1400, 2800, nil)}
			if scenario == "identity change" || scenario == "identity recovery" {
				reader.raw.NetworkInterfaces[0].Identity = &newID
			} else if scenario == "identity loss" {
				reader.raw.NetworkInterfaces[0].Identity = nil
			}
			recovery := svc.Collect(context.Background())
			var wantRX, wantTX *float64
			switch scenario {
			case "identity change", "identity loss", "identity recovery":
				rx, tx := 100.0, 200.0
				wantRX, wantTX = &rx, &tx
			case "rx rollback":
				rx, tx := 245.0, 200.0
				wantRX, wantTX = &rx, &tx
			case "tx rollback":
				rx, tx := 100.0, 495.0
				wantRX, wantTX = &rx, &tx
			}
			assertNetworkRates(t, recovery, "br0", wantRX, wantTX)
			if (recovery.NetworkRXRate == nil) != (wantRX == nil) || (recovery.NetworkTXRate == nil) != (wantTX == nil) ||
				(wantRX != nil && *recovery.NetworkRXRate != *wantRX) || (wantTX != nil && *recovery.NetworkTXRate != *wantTX) {
				t.Fatalf("Auto recovery rates = %+v, want RX=%v TX=%v", recovery, wantRX, wantTX)
			}
			now = now.Add(2 * time.Second)
			reader.raw.NetworkInterfaces[0].RX, reader.raw.NetworkInterfaces[0].TX = 700, 1400
			reader.raw.NetworkInterfaces[1].RX, reader.raw.NetworkInterfaces[1].TX = 1600, 3200
			rx, tx := 100.0, 200.0
			final := svc.Collect(context.Background())
			assertNetworkRates(t, final, "br0", &rx, &tx)
			assertNetworkRates(t, final, "eth0", &rx, &tx)
		})
	}
}

// TestServiceNetworkRollbackPreservesZeroInterval checks real zero rates after either counter resets.
func TestServiceNetworkRollbackPreservesZeroInterval(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		rx, tx uint64
	}{
		{name: "rx rollback", rx: 10, tx: 600},
		{name: "tx rollback", rx: 300, tx: 10},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
			id := uint64(2)
			reader := &fakeReader{raw: Raw{NetworkInterface: "br0", NetworkAvailable: true,
				NetworkInterfaces: []NetworkInterfaceRaw{networkRaw("br0", 100, 200, &id)}}}
			svc := NewService(reader, func() time.Time { return now })
			assertNetworkRates(t, svc.Collect(context.Background()), "br0", nil, nil)
			now = now.Add(2 * time.Second)
			reader.raw.NetworkInterfaces[0].RX, reader.raw.NetworkInterfaces[0].TX = scenario.rx, scenario.tx
			rollback := svc.Collect(context.Background())
			assertNetworkRates(t, rollback, "br0", nil, nil)
			if rollback.NetworkRXRate != nil || rollback.NetworkTXRate != nil {
				t.Fatalf("rollback Auto rates must be null: %+v", rollback)
			}
			now = now.Add(2 * time.Second)
			next := svc.Collect(context.Background())
			zero := 0.0
			assertNetworkRates(t, next, "br0", &zero, &zero)
			if next.NetworkRXRate == nil || *next.NetworkRXRate != 0 || next.NetworkTXRate == nil || *next.NetworkTXRate != 0 {
				t.Fatalf("unchanged interval after rollback must project real zero Auto rates: %+v", next)
			}
		})
	}
}

// TestServiceNetworkOwnership prevents callers and subscribers from changing cached samples.
func TestServiceNetworkOwnership(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	id := uint64(7)
	items := []NetworkInterfaceRaw{networkRaw("br0", 100, 200, &id)}
	reader := &fakeReader{raw: Raw{NetworkInterface: "br0", NetworkAvailable: true, NetworkInterfaces: items}}
	svc := NewService(reader, func() time.Time { return now })
	svc.Collect(context.Background())
	now = now.Add(2 * time.Second)
	items[0].RX, items[0].TX = 2100, 4200
	got := svc.Collect(context.Background())
	rx, tx := 1000.0, 2000.0
	assertNetworkRates(t, got, "br0", &rx, &tx)
	a, cancelA := svc.Subscribe()
	defer cancelA()
	b, cancelB := svc.Subscribe()
	defer cancelB()
	for _, snapshot := range []Snapshot{got, svc.Latest(), <-a} {
		*snapshot.NetworkInterfaces[0].RXBytesPerSecond = -1
		*snapshot.NetworkInterfaces[0].TXBytesPerSecond = -1
		snapshot.NetworkInterfaces[0].Name = "mutated"
		assertNetworkRates(t, svc.Latest(), "br0", &rx, &tx)
	}
	assertNetworkRates(t, <-b, "br0", &rx, &tx)
	now = now.Add(2 * time.Second)
	items[0].RX, items[0].TX = 4100, 8200
	svc.Collect(context.Background())
	updatedA, updatedB := <-a, <-b
	*updatedA.NetworkInterfaces[0].RXBytesPerSecond = -1
	updatedA.NetworkInterfaces[0].Name = "mutated"
	assertNetworkRates(t, updatedB, "br0", &rx, &tx)
	assertNetworkRates(t, svc.Latest(), "br0", &rx, &tx)
	id = 8
	now = now.Add(2 * time.Second)
	items[0].RX, items[0].TX = 6100, 12200
	assertNetworkRates(t, svc.Collect(context.Background()), "br0", nil, nil)
}

// TestSnapshotEmptyNetworkArray checks every snapshot including unavailable service values.
func TestSnapshotEmptyNetworkArray(t *testing.T) {
	svc := NewService(&fakeReader{err: errors.New("unavailable")}, time.Now)
	events, cancel := svc.Subscribe()
	defer cancel()
	for _, snapshot := range []Snapshot{{}, svc.Latest(), <-events, svc.Collect(context.Background())} {
		data, err := json.Marshal(snapshot)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(data, &fields); err != nil {
			t.Fatal(err)
		}
		if string(fields["networkInterfaces"]) != "[]" {
			t.Fatalf("empty array contract: %s", data)
		}
	}
}

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

// TestServiceOptionalMetricsAreIsolated checks existing pointer ownership at cache boundaries.
func TestServiceOptionalMetricsAreIsolated(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	uptime, temperature := 123.0, 42.0
	reader := &fakeReader{raw: Raw{UptimeSeconds: &uptime, CPUTemperature: &temperature, CPUTotal: 100, CPUIdle: 60,
		NetworkInterface: "br0", NetworkAvailable: true, NetworkRX: 100, NetworkTX: 200, Diagnostics: map[string]string{"sensor": "fixture"}}}
	svc := NewService(reader, func() time.Time { return now })
	svc.Collect(context.Background())
	now = now.Add(time.Second)
	reader.raw.CPUTotal, reader.raw.CPUIdle = 200, 80
	reader.raw.NetworkRX, reader.raw.NetworkTX = 1100, 2200
	got := svc.Collect(context.Background())
	events, cancel := svc.Subscribe()
	defer cancel()
	uptime, temperature = 999, 999
	reader.raw.Diagnostics["sensor"] = "mutated"
	if latest := svc.Latest(); *latest.UptimeSeconds != 123 || *latest.CPUTemperature != 42 || latest.Diagnostics["sensor"] != "fixture" {
		t.Fatalf("reader pointers escaped into cache: %+v", latest)
	}
	for _, snapshot := range []Snapshot{got, svc.Latest(), <-events} {
		*snapshot.UptimeSeconds, *snapshot.CPUTemperature = -1, -1
		*snapshot.CPUUsage, *snapshot.NetworkRXRate, *snapshot.NetworkTXRate = -1, -1, -1
		snapshot.Diagnostics["sensor"] = "mutated"
		latest := svc.Latest()
		if *latest.UptimeSeconds != 123 || *latest.CPUTemperature != 42 || *latest.CPUUsage != 80 ||
			*latest.NetworkRXRate != 1000 || *latest.NetworkTXRate != 2000 || latest.Diagnostics["sensor"] != "fixture" {
			t.Fatalf("snapshot mutation escaped into cache: %+v", latest)
		}
	}
}
