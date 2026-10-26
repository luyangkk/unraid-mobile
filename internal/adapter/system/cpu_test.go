package system

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"testing/fstest"
	"time"

	domain "github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

type cpuRawView struct {
	CPUInfo *struct {
		Model               *string
		ReportedFrequencyHz *float64
		LogicalCPUCount     *int
	}
	CPULogicalProcessors []struct {
		ID          int
		Total, Idle uint64
		Available   bool
		Reason      string
	}
}

// decodeCPURaw observes the reader contract without requiring extension types for RED.
func decodeCPURaw(t *testing.T, raw domain.Raw) cpuRawView {
	t.Helper()
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var view cpuRawView
	if err := json.Unmarshal(data, &view); err != nil {
		t.Fatal(err)
	}
	return view
}

// TestReaderCPUExtension checks mounted provenance, whitelist fields and numeric ordering.
func TestReaderCPUExtension(t *testing.T) {
	files := fixture()
	files["proc/stat"].Data = []byte("cpu 10 1 2 70 10 3 4 5 900 800\ncpu10 10 0 10 70 10 0 0 0 500 600\ncpu2 5 0 5 30 10 0 0 0\ncpu0 1 0 1 8\ncpufoo 1 2 3 4\nintr 123\n")
	files["proc/cpuinfo"] = &fstest.MapFile{Data: []byte("processor: 99\nmodel name : Synthetic Test CPU\ncpu MHz : 2000.25\nserial : SECRET\n\nprocessor: 100\nmodel name: Synthetic Test CPU\ncpu MHz: 3000.75\n")}
	counted := &countingFS{FS: files, opens: map[string]int{}}
	raw, err := NewReader(counted).Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	got := decodeCPURaw(t, raw)
	if got.CPUInfo == nil || got.CPUInfo.Model == nil || *got.CPUInfo.Model != "Synthetic Test CPU" ||
		got.CPUInfo.ReportedFrequencyHz == nil || *got.CPUInfo.ReportedFrequencyHz != 2500500000 ||
		got.CPUInfo.LogicalCPUCount == nil || *got.CPUInfo.LogicalCPUCount != 3 {
		t.Fatalf("CPU info = %+v, want mounted model, mean 2500500000 Hz and stat count 3", got.CPUInfo)
	}
	ids := []int{}
	for _, item := range got.CPULogicalProcessors {
		ids = append(ids, item.ID)
		if !item.Available {
			t.Fatalf("readable CPU unavailable: %+v", item)
		}
	}
	if !reflect.DeepEqual(ids, []int{0, 2, 10}) || got.CPULogicalProcessors[2].Total != 100 || got.CPULogicalProcessors[2].Idle != 80 ||
		raw.CPUTotal != 105 || raw.CPUIdle != 80 {
		t.Fatalf("guest-excluded counters and numeric IDs = %+v, aggregate=%+v", got, raw)
	}
	if counted.opens["proc/stat"] != 1 || counted.opens["proc/cpuinfo"] != 1 {
		t.Fatalf("CPU sources must be read once: %v", counted.opens)
	}
}

// TestReaderCPUOptionalSources checks incomplete metadata cannot discard System counters.
func TestReaderCPUOptionalSources(t *testing.T) {
	for _, tc := range []struct {
		name, info string
		model      bool
		frequency  *float64
	}{
		{name: "missing"},
		{name: "empty", info: "serial: SECRET\n"},
		{name: "model only", info: "model name: Synthetic CPU\n", model: true},
		{name: "frequency only", info: "cpu MHz: 1250.5\n", frequency: cpuTestFloat(1250500000)},
		{name: "invalid frequencies", info: "model name:\ncpu MHz: NaN\ncpu MHz: +Inf\ncpu MHz: -1\ncpu MHz: 0\ncpu MHz: bad\ncpu MHz: 1e308\n"},
		{name: "mixed frequencies", info: "model name: Synthetic CPU\ncpu MHz: 2000\ncpu MHz: NaN\ncpu MHz: 3000\n", model: true, frequency: cpuTestFloat(2500000000)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := fixture()
			files["proc/stat"].Data = []byte("cpu 10 0 10 70 10 0 0 0\ncpu2 10 0 10 70 10 0 0 0\n")
			if tc.name != "missing" {
				files["proc/cpuinfo"] = &fstest.MapFile{Data: []byte(tc.info)}
			}
			raw, err := NewReader(files).Read(context.Background())
			if err != nil || raw.CPUTotal != 100 || raw.MemoryTotal == 0 || raw.CPUTemperature == nil {
				t.Fatalf("optional CPU failure discarded System: %+v, %v", raw, err)
			}
			got := decodeCPURaw(t, raw)
			if got.CPUInfo == nil || got.CPUInfo.LogicalCPUCount == nil || *got.CPUInfo.LogicalCPUCount != 1 {
				t.Fatalf("stat count must survive missing cpuinfo: %+v", got)
			}
			if (got.CPUInfo.Model != nil) != tc.model || (got.CPUInfo.ReportedFrequencyHz == nil) != (tc.frequency == nil) ||
				(tc.frequency != nil && *got.CPUInfo.ReportedFrequencyHz != *tc.frequency) {
				t.Fatalf("optional fields = %+v", got.CPUInfo)
			}
			if !tc.model && raw.Diagnostics["cpuModel"] == "" || tc.frequency == nil && raw.Diagnostics["cpuFrequency"] == "" {
				t.Fatalf("missing optional field diagnostics: %v", raw.Diagnostics)
			}
		})
	}
}

// cpuTestFloat supplies a literal optional expectation without invoking production helpers.
func cpuTestFloat(value float64) *float64 { return &value }

// TestReaderCPUInvalidRows checks bounded counters and IDs while isolating bad logical rows.
func TestReaderCPUInvalidRows(t *testing.T) {
	for _, row := range []string{
		"cpu2 1 2", "cpu2 1 bad 3 4", "cpu2 -1 0 0 4",
		"cpu2 18446744073709551616 0 0 4",
		"cpu2 18446744073709551615 1 0 0",
	} {
		t.Run(row, func(t *testing.T) {
			files := fixture()
			files["proc/stat"].Data = []byte("cpu 10 0 10 70 10 0 0 0\n" + row + "\ncpu10 10 0 10 70 10 0 0 0\n")
			raw, err := NewReader(files).Read(context.Background())
			if err != nil {
				t.Fatalf("logical failure became global: %v", err)
			}
			got := decodeCPURaw(t, raw)
			if len(got.CPULogicalProcessors) != 2 || got.CPULogicalProcessors[0].ID != 2 ||
				got.CPULogicalProcessors[0].Available || got.CPULogicalProcessors[0].Reason == "" ||
				!got.CPULogicalProcessors[1].Available || raw.Diagnostics["cpuLogicalProcessors"] == "" {
				t.Fatalf("invalid logical row not isolated: %+v, diagnostics=%v", got, raw.Diagnostics)
			}
		})
	}
	t.Run("unrepresentable numeric IDs are rejected", func(t *testing.T) {
		files := fixture()
		files["proc/stat"].Data = []byte("cpu 10 0 10 70\ncpu18446744073709551616 1 0 1 8\ncpu10 1 0 1 8\n")
		raw, err := NewReader(files).Read(context.Background())
		got := decodeCPURaw(t, raw)
		if err != nil || len(got.CPULogicalProcessors) != 1 || got.CPULogicalProcessors[0].ID != 10 || raw.Diagnostics["cpuLogicalProcessors"] == "" {
			t.Fatalf("unbounded ID accepted: %+v, %v", got, err)
		}
	})
	for _, stat := range []string{
		"cpu 18446744073709551616 0 0 0\n",
		"cpu 18446744073709551615 1 0 0\n",
	} {
		t.Run(stat, func(t *testing.T) {
			files := fixture()
			files["proc/stat"].Data = []byte(stat)
			if _, err := NewReader(files).Read(context.Background()); err == nil {
				t.Fatal("overflowing aggregate CPU must be unavailable")
			}
		})
	}
	t.Run("no extended source returns null info and empty array", func(t *testing.T) {
		files := fixture()
		files["proc/stat"].Data = []byte("cpu 10 0 10 70 10\n")
		raw, err := NewReader(files).Read(context.Background())
		got := decodeCPURaw(t, raw)
		if err != nil || got.CPUInfo != nil || got.CPULogicalProcessors == nil || len(got.CPULogicalProcessors) != 0 || raw.Diagnostics["cpuLogicalProcessors"] == "" {
			t.Fatalf("absent extension contract = %+v, %v", got, err)
		}
	})
}

// TestReaderSyntheticCPUFixtures checks repository fixtures through the real sampler.
func TestReaderSyntheticCPUFixtures(t *testing.T) {
	reader := NewReader(os.DirFS("../../../testdata/host"))
	raw, err := reader.Read(context.Background())
	got := decodeCPURaw(t, raw)
	if err != nil || got.CPUInfo == nil || got.CPUInfo.Model == nil || *got.CPUInfo.Model != "Synthetic Fixture CPU" ||
		got.CPUInfo.ReportedFrequencyHz == nil || *got.CPUInfo.ReportedFrequencyHz != 2500000000 ||
		got.CPUInfo.LogicalCPUCount == nil || *got.CPUInfo.LogicalCPUCount != 2 {
		t.Fatalf("synthetic fixture CPU = %+v, %v", got, err)
	}
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	service := domain.NewService(reader, func() time.Time { return now })
	first := service.Collect(context.Background())
	now = now.Add(time.Second)
	second := service.Collect(context.Background())
	for i, snapshot := range []domain.Snapshot{first, second} {
		data, _ := json.Marshal(snapshot)
		var fields map[string]any
		_ = json.Unmarshal(data, &fields)
		rows, ok := fields["cpuLogicalProcessors"].([]any)
		if !ok || len(rows) != 2 {
			t.Fatalf("synthetic snapshot rows missing: %s", data)
		}
		for _, row := range rows {
			item := row.(map[string]any)
			if item["usage"] != nil {
				t.Fatalf("first or unchanged CPU counters must remain unknown (sample %d): %v", i, item)
			}
		}
	}
}
