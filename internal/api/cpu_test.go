package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	adapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/system"
	domain "github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

type countedCPUReader struct {
	domain.Reader
	calls int
}

// Read counts sampler calls while exercising the real mounted CPU parser.
func (r *countedCPUReader) Read(ctx context.Context) (domain.Raw, error) {
	r.calls++
	return r.Reader.Read(ctx)
}

// TestSystemCPURESTAndSSE checks whitelist fields and cache parity for initial and live events.
func TestSystemCPURESTAndSSE(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	files := fstest.MapFS{
		"proc/stat":    {Data: []byte("cpu 10 0 10 70 10 0 0 0\ncpu10 10 0 10 70 10 0 0 0\ncpu2 10 0 10 70 10 0 0 0\n")},
		"proc/cpuinfo": {Data: []byte("model name: Synthetic API CPU\ncpu MHz: 2000\ncpu MHz: 3000\nserial: SECRET\n")},
		"proc/meminfo": {Data: []byte("MemTotal: 8192 kB\nMemAvailable: 2048 kB\n")},
	}
	reader := &countedCPUReader{Reader: adapter.NewReader(files)}
	svc := domain.NewService(reader, func() time.Time { return now })
	svc.Collect(context.Background())
	server := httptest.NewServer(NewServer(Config{System: svc}))
	defer server.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get(server.URL + "/api/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	scanner := bufio.NewScanner(res.Body)
	// readCPUEvent decodes a complete System event from the existing shared transport.
	readCPUEvent := func() map[string]any {
		t.Helper()
		for scanner.Scan() {
			if scanner.Text() != "event: system.metrics" {
				continue
			}
			if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "data: ") {
				t.Fatal("System event data missing")
			}
			var event map[string]any
			if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &event); err != nil {
				t.Fatal(err)
			}
			return event
		}
		t.Fatalf("System event missing: %v", scanner.Err())
		return nil
	}
	// assertCPUParity checks literal CPU payloads and repeated REST reads of the same revision.
	assertCPUParity := func(event map[string]any, wantUsage any) {
		t.Helper()
		info, ok := event["cpuInfo"].(map[string]any)
		if !ok || !reflect.DeepEqual(info, map[string]any{"model": "Synthetic API CPU", "reportedFrequencyHz": float64(2500000000), "logicalCPUCount": float64(2)}) {
			t.Fatalf("CPU info contract = %v", event["cpuInfo"])
		}
		rows, ok := event["cpuLogicalProcessors"].([]any)
		if !ok || len(rows) != 2 {
			t.Fatalf("logical CPU array = %v", event)
		}
		for i, id := range []float64{2, 10} {
			row := rows[i].(map[string]any)
			if row["id"] != id || row["usage"] != wantUsage {
				t.Fatalf("logical CPU row = %v, want id=%v usage=%v", row, id, wantUsage)
			}
			for key := range row {
				if key != "id" && key != "usage" && key != "reason" {
					t.Fatalf("raw CPU counters leaked: %v", row)
				}
			}
		}
		if event["cpuUsage"] != wantUsage {
			t.Fatalf("aggregate CPU changed: %v", event["cpuUsage"])
		}
		for i := 0; i < 3; i++ {
			rr := httptest.NewRecorder()
			server.Config.Handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/system", nil))
			var rest map[string]any
			if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &rest) != nil || !reflect.DeepEqual(rest, event) {
				t.Fatalf("REST/SSE CPU parity: REST=%s, SSE=%v", rr.Body.String(), event)
			}
		}
	}
	assertCPUParity(readCPUEvent(), nil)
	if reader.calls != 1 {
		t.Fatalf("requests sampled CPU: %d calls", reader.calls)
	}
	now = now.Add(time.Second)
	files["proc/stat"].Data = []byte("cpu 50 0 50 80 20 0 0 0 9999 9999\ncpu10 50 0 50 80 20 0 0 0\ncpu2 50 0 50 80 20 0 0 0\n")
	svc.Collect(context.Background())
	assertCPUParity(readCPUEvent(), float64(80))
	if reader.calls != 2 {
		t.Fatalf("live requests sampled CPU: %d calls", reader.calls)
	}
}

// TestSystemCPUUnavailableContract checks missing service payloads in both REST and SSE.
func TestSystemCPUUnavailableContract(t *testing.T) {
	server := httptest.NewServer(NewServer(Config{}))
	defer server.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	for _, endpoint := range []string{"/api/v1/system", "/api/v1/events"} {
		res, err := client.Get(server.URL + endpoint)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if endpoint == "/api/v1/events" {
			scanner := bufio.NewScanner(res.Body)
			if !scanner.Scan() || scanner.Text() != "event: system.metrics" || !scanner.Scan() {
				t.Fatal("unavailable System event missing")
			}
			err = json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &fields)
		} else {
			err = json.NewDecoder(res.Body).Decode(&fields)
		}
		res.Body.Close()
		if err != nil || string(fields["cpuInfo"]) != "null" || string(fields["cpuLogicalProcessors"]) != "[]" {
			t.Fatalf("%s unavailable CPU contract = %v, %v", endpoint, fields, err)
		}
	}
}
