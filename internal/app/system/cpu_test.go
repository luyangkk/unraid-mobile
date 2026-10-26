package system

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"
)

type cpuSnapshotView struct {
	CPUInfo *struct {
		Model               *string  `json:"model"`
		ReportedFrequencyHz *float64 `json:"reportedFrequencyHz"`
		LogicalCPUCount     *int     `json:"logicalCPUCount"`
	} `json:"cpuInfo"`
	CPULogicalProcessors []struct {
		ID     int      `json:"id"`
		Usage  *float64 `json:"usage"`
		Reason string   `json:"reason"`
	} `json:"cpuLogicalProcessors"`
}

// cpuSample constructs literal reader input without requiring absent types in RED tests.
func cpuSample(t *testing.T, rows string) Raw {
	t.Helper()
	var raw Raw
	data := `{"CPUTotal":100,"CPUIdle":50,"MemoryTotal":8192,"MemoryAvailable":2048,"CPUInfo":{"model":"Synthetic CPU","reportedFrequencyHz":2500000000},"CPULogicalProcessors":` + rows + `}`
	if err := json.Unmarshal([]byte(data), &raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

// cpuView decodes observable snapshot fields for literal contract assertions.
func cpuView(t *testing.T, snapshot Snapshot) cpuSnapshotView {
	t.Helper()
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var got cpuSnapshotView
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.CPULogicalProcessors == nil {
		t.Fatalf("cpuLogicalProcessors must always be an array: %s", data)
	}
	return got
}

// assertCPUUsage checks complete one-CPU values against hand-calculated expectations.
func assertCPUUsage(t *testing.T, snapshot Snapshot, id int, usage *float64) {
	t.Helper()
	got := cpuView(t, snapshot)
	for _, row := range got.CPULogicalProcessors {
		if row.ID != id {
			continue
		}
		if (row.Usage == nil) != (usage == nil) || usage != nil && *row.Usage != *usage {
			t.Fatalf("CPU %d usage = %v, want %v", id, row.Usage, usage)
		}
		if usage == nil && row.Reason == "" {
			t.Fatalf("unknown CPU %d lacks a nearby reason", id)
		}
		return
	}
	t.Fatalf("CPU %d missing: %+v", id, got)
}

// cpuLiteral returns an optional literal independent of the calculation under test.
func cpuLiteral(value float64) *float64 { return &value }

// TestServiceCPUAdjacentDeltas checks first samples, percentages and invalid increments.
func TestServiceCPUAdjacentDeltas(t *testing.T) {
	for _, tc := range []struct {
		name        string
		total, idle uint64
		want        *float64
	}{
		{"zero percent", 200, 150, cpuLiteral(0)},
		{"hundred percent", 200, 50, cpuLiteral(100)},
		{"fractional percent", 180, 80, cpuLiteral(62.5)},
		{"total rollback", 90, 50, nil},
		{"idle rollback", 200, 40, nil},
		{"idle delta exceeds total", 110, 80, nil},
		{"unchanged counters", 100, 50, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
			reader := &fakeReader{raw: cpuSample(t, `[{"id":2,"available":true,"total":100,"idle":50}]`)}
			svc := NewService(reader, func() time.Time { return now })
			first := svc.Collect(context.Background())
			assertCPUUsage(t, first, 2, nil)
			now = now.Add(time.Second)
			reader.raw = cpuSample(t, fmt.Sprintf(`[{"id":2,"available":true,"total":%d,"idle":%d}]`, tc.total, tc.idle))
			reader.raw.CPUTotal, reader.raw.CPUIdle = tc.total, tc.idle
			got := svc.Collect(context.Background())
			assertCPUUsage(t, got, 2, tc.want)
			if (got.CPUUsage == nil) != (tc.want == nil) || tc.want != nil && *got.CPUUsage != *tc.want {
				t.Fatalf("aggregate usage = %v, want %v", got.CPUUsage, tc.want)
			}
			now = now.Add(time.Second)
			reader.raw = cpuSample(t, fmt.Sprintf(`[{"id":2,"available":true,"total":%d,"idle":%d}]`, tc.total+100, tc.idle+50))
			reader.raw.CPUTotal, reader.raw.CPUIdle = tc.total+100, tc.idle+50
			assertCPUUsage(t, svc.Collect(context.Background()), 2, cpuLiteral(50))
		})
	}
}

// TestServiceCPUIndependentResets checks local failures, recovery and current stat membership.
func TestServiceCPUIndependentResets(t *testing.T) {
	for _, scenario := range []string{"local failure", "removal", "rollback", "reader failure", "missing rows"} {
		t.Run(scenario, func(t *testing.T) {
			now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
			reader := &fakeReader{raw: cpuSample(t, `[{"id":10,"available":true,"total":100,"idle":50},{"id":2,"available":true,"total":100,"idle":50}]`)}
			svc := NewService(reader, func() time.Time { return now })
			svc.Collect(context.Background())
			now = now.Add(time.Second)
			rows := `[{"id":10,"available":true,"total":200,"idle":100},{"id":2,"available":true,"total":200,"idle":100},{"id":0,"available":true,"total":20,"idle":10}]`
			switch scenario {
			case "local failure":
				rows = `[{"id":10,"available":true,"total":200,"idle":100},{"id":2,"reason":"invalid counters"},{"id":0,"available":true,"total":20,"idle":10}]`
			case "removal":
				rows = `[{"id":10,"available":true,"total":200,"idle":100},{"id":0,"available":true,"total":20,"idle":10}]`
			case "rollback":
				rows = `[{"id":10,"available":true,"total":200,"idle":100},{"id":2,"available":true,"total":10,"idle":5},{"id":0,"available":true,"total":20,"idle":10}]`
			case "reader failure":
				reader.err = errors.New("host unavailable")
			case "missing rows":
				rows = `[]`
			}
			reader.raw = cpuSample(t, rows)
			reader.raw.CPUTotal, reader.raw.CPUIdle = 200, 100
			got := svc.Collect(context.Background())
			global := scenario == "reader failure" || scenario == "missing rows"
			if !global {
				assertCPUUsage(t, got, 10, cpuLiteral(50))
				assertCPUUsage(t, got, 0, nil)
				if scenario != "removal" {
					assertCPUUsage(t, got, 2, nil)
				}
				view := cpuView(t, got)
				if view.CPULogicalProcessors[0].ID != 0 || view.CPUInfo == nil || view.CPUInfo.LogicalCPUCount == nil ||
					*view.CPUInfo.LogicalCPUCount != len(view.CPULogicalProcessors) {
					t.Fatalf("current numeric membership/count mismatch: %+v", view)
				}
				if scenario == "removal" && len(view.CPULogicalProcessors) != 2 {
					t.Fatal("removed CPU remained in snapshot")
				}
				if scenario == "local failure" && view.CPULogicalProcessors[1].Reason != "invalid counters" {
					t.Fatal("local failure lost its reason")
				}
			} else if len(cpuView(t, got).CPULogicalProcessors) != 0 {
				t.Fatal("unavailable rows reused old metrics")
			}
			if scenario == "missing rows" && (got.CPUUsage == nil || *got.CPUUsage != 50 || !got.Available) {
				t.Fatal("optional logical failure affected aggregate CPU")
			}
			if scenario == "reader failure" && (got.Available || got.CPUUsage != nil || cpuView(t, got).CPUInfo != nil) {
				t.Fatal("unavailable System exposed old CPU data")
			}
			now = now.Add(time.Second)
			reader.err = nil
			reader.raw = cpuSample(t, `[{"id":10,"available":true,"total":300,"idle":150},{"id":2,"available":true,"total":300,"idle":150}]`)
			recovered := svc.Collect(context.Background())
			if scenario == "rollback" {
				assertCPUUsage(t, recovered, 2, cpuLiteral(50))
			} else {
				assertCPUUsage(t, recovered, 2, nil)
			}
			if !global {
				assertCPUUsage(t, recovered, 10, cpuLiteral(50))
			} else {
				assertCPUUsage(t, recovered, 10, nil)
			}
			now = now.Add(time.Second)
			reader.raw = cpuSample(t, `[{"id":10,"available":true,"total":400,"idle":200},{"id":2,"available":true,"total":400,"idle":200}]`)
			assertCPUUsage(t, svc.Collect(context.Background()), 2, cpuLiteral(50))
		})
	}
}

// TestServiceCPUTimeReversal discards unordered samples instead of calculating across them.
func TestServiceCPUTimeReversal(t *testing.T) {
	for _, shift := range []time.Duration{0, -time.Second} {
		t.Run(shift.String(), func(t *testing.T) {
			now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
			reader := &fakeReader{raw: cpuSample(t, `[{"id":2,"available":true,"total":100,"idle":50}]`)}
			svc := NewService(reader, func() time.Time { return now })
			svc.Collect(context.Background())
			now = now.Add(shift)
			reader.raw = cpuSample(t, `[{"id":2,"available":true,"total":200,"idle":100}]`)
			reader.raw.CPUTotal, reader.raw.CPUIdle = 200, 100
			got := svc.Collect(context.Background())
			assertCPUUsage(t, got, 2, nil)
			if got.CPUUsage != nil {
				t.Fatal("unordered aggregate sample must be null")
			}
			now = now.Add(2 * time.Second)
			reader.raw = cpuSample(t, `[{"id":2,"available":true,"total":300,"idle":150}]`)
			reader.raw.CPUTotal, reader.raw.CPUIdle = 300, 150
			got = svc.Collect(context.Background())
			assertCPUUsage(t, got, 2, nil)
			if got.CPUUsage != nil {
				t.Fatal("discarded unordered sample must not seed aggregate baseline")
			}
			now = now.Add(time.Second)
			reader.raw = cpuSample(t, `[{"id":2,"available":true,"total":400,"idle":200}]`)
			assertCPUUsage(t, svc.Collect(context.Background()), 2, cpuLiteral(50))
		})
	}
}

// TestSnapshotCPUEmptyContract covers zero, waiting and failed snapshots for all consumers.
func TestSnapshotCPUEmptyContract(t *testing.T) {
	svc := NewService(&fakeReader{err: errors.New("unavailable")}, time.Now)
	events, cancel := svc.Subscribe()
	defer cancel()
	for _, snapshot := range []Snapshot{{}, svc.Latest(), <-events, svc.Collect(context.Background())} {
		view := cpuView(t, snapshot)
		if view.CPUInfo != nil || len(view.CPULogicalProcessors) != 0 {
			t.Fatalf("empty CPU contract = %+v", view)
		}
	}
}

// mutateCPUInfo changes nested values and then the object to detect both shallow-copy bugs.
func mutateCPUInfo(t *testing.T, value any) {
	t.Helper()
	info := reflect.ValueOf(value).Elem().FieldByName("CPUInfo")
	if !info.IsValid() || info.IsNil() {
		t.Fatal("CPUInfo missing")
	}
	object := info.Elem()
	object.FieldByName("Model").Elem().SetString("mutated")
	object.FieldByName("ReportedFrequencyHz").Elem().SetFloat(-1)
	count := object.FieldByName("LogicalCPUCount")
	if !count.IsNil() {
		count.Elem().SetInt(999)
	}
	object.FieldByName("Model").Set(reflect.ValueOf(cpuStringLiteral("replaced")))
}

// cpuStringLiteral gives ownership tests an independently allocated replacement.
func cpuStringLiteral(value string) *string { return &value }

// mutateCPUOutput changes the logical slice and its optional usage independently.
func mutateCPUOutput(t *testing.T, snapshot *Snapshot) {
	t.Helper()
	mutateCPUInfo(t, snapshot)
	rows := reflect.ValueOf(snapshot).Elem().FieldByName("CPULogicalProcessors")
	rows.Index(0).FieldByName("Usage").Elem().SetFloat(-1)
	rows.Index(0).FieldByName("ID").SetInt(999)
}

// assertCPUOwnership checks immutable cached metadata and the complete logical measurement.
func assertCPUOwnership(t *testing.T, snapshot Snapshot) {
	t.Helper()
	view := cpuView(t, snapshot)
	if view.CPUInfo == nil || view.CPUInfo.Model == nil || *view.CPUInfo.Model != "Synthetic CPU" ||
		view.CPUInfo.ReportedFrequencyHz == nil || *view.CPUInfo.ReportedFrequencyHz != 2500000000 ||
		view.CPUInfo.LogicalCPUCount == nil || *view.CPUInfo.LogicalCPUCount != 1 {
		t.Fatalf("CPU metadata alias escaped: %+v", view)
	}
	assertCPUUsage(t, snapshot, 2, cpuLiteral(50))
}

// TestServiceCPUOwnership protects reader input, cache, collection and SSE subscriber ownership.
func TestServiceCPUOwnership(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	reader := &fakeReader{raw: cpuSample(t, `[{"id":2,"available":true,"total":100,"idle":50}]`)}
	svc := NewService(reader, func() time.Time { return now })
	svc.Collect(context.Background())
	now = now.Add(time.Second)
	reader.raw = cpuSample(t, `[{"id":2,"available":true,"total":200,"idle":100}]`)
	got := svc.Collect(context.Background())
	assertCPUOwnership(t, got)
	a, cancelA := svc.Subscribe()
	defer cancelA()
	b, cancelB := svc.Subscribe()
	defer cancelB()
	mutateCPUInfo(t, &reader.raw)
	reflect.ValueOf(&reader.raw).Elem().FieldByName("CPULogicalProcessors").Index(0).FieldByName("Total").SetUint(9999)
	assertCPUOwnership(t, svc.Latest())
	for _, snapshot := range []Snapshot{got, svc.Latest(), <-a} {
		mutateCPUOutput(t, &snapshot)
		assertCPUOwnership(t, svc.Latest())
	}
	assertCPUOwnership(t, <-b)
	now = now.Add(time.Second)
	reader.raw = cpuSample(t, `[{"id":2,"available":true,"total":300,"idle":150}]`)
	assertCPUOwnership(t, svc.Collect(context.Background()))
	updatedA, updatedB := <-a, <-b
	mutateCPUOutput(t, &updatedA)
	assertCPUOwnership(t, updatedB)
	assertCPUOwnership(t, svc.Latest())
}
