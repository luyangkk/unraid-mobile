package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	domain "github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

type countedNetworkReader struct {
	calls atomic.Int32
}

// Read returns a synthetic complete network sample and counts only sampler reads.
func (r *countedNetworkReader) Read(context.Context) (domain.Raw, error) {
	step := uint64(r.calls.Add(1))
	id := uint64(42)
	return domain.Raw{Hostname: "Tower", NetworkInterface: "br0", NetworkAvailable: true,
		NetworkInterfaces: []domain.NetworkInterfaceRaw{
			{Name: "eth0", Available: true, RX: step * 100, TX: step * 200},
			{Name: "br0", Available: true, RX: step * 1000, TX: step * 2000, Identity: &id},
			{Name: "broken0", Reason: "invalid byte counters"},
		}}, nil
}

// TestSystemNetworkRESTAndSSEUseCache checks complete payloads without request-time sampling.
func TestSystemNetworkRESTAndSSEUseCache(t *testing.T) {
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	reader := &countedNetworkReader{}
	svc := domain.NewService(reader, func() time.Time { return now })
	svc.Collect(context.Background())
	now = now.Add(2 * time.Second)
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
	// readSample waits for a complete System event and decodes its JSON fields.
	readSample := func() map[string]any {
		t.Helper()
		for scanner.Scan() {
			if scanner.Text() != "event: system.metrics" {
				continue
			}
			if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "data: ") {
				t.Fatal("System event data missing")
			}
			var fields map[string]any
			if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &fields); err != nil {
				t.Fatal(err)
			}
			return fields
		}
		t.Fatalf("System event missing: %v", scanner.Err())
		return nil
	}
	// assertREST checks repeated reads against the event from the same cache revision.
	assertREST := func(event map[string]any, wantRX, wantTX float64) {
		t.Helper()
		for i := 0; i < 3; i++ {
			rr := httptest.NewRecorder()
			server.Config.Handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/system", nil))
			var fields map[string]any
			if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &fields) != nil {
				t.Fatalf("REST = %d %s", rr.Code, rr.Body.String())
			}
			if !reflect.DeepEqual(fields, event) {
				t.Fatalf("REST and SSE differ: REST=%v SSE=%v", fields, event)
			}
		}
		items, ok := event["networkInterfaces"].([]any)
		if !ok || len(items) != 3 {
			t.Fatalf("complete network array missing: %v", event)
		}
		auto := items[0].(map[string]any)
		if auto["name"] != "br0" || auto["available"] != true || auto["rxBytesPerSecond"] != wantRX || auto["txBytesPerSecond"] != wantTX ||
			event["networkRXRate"] != auto["rxBytesPerSecond"] || event["networkTXRate"] != auto["txBytesPerSecond"] {
			t.Fatalf("Auto projection mismatch: %v", event)
		}
		broken := items[1].(map[string]any)
		if broken["name"] != "broken0" || broken["available"] != false || broken["reason"] != "invalid byte counters" ||
			broken["rxBytesPerSecond"] != nil || broken["txBytesPerSecond"] != nil {
			t.Fatalf("unavailable row contract: %v", broken)
		}
		for _, item := range items {
			for key := range item.(map[string]any) {
				if key != "name" && key != "available" && key != "reason" && key != "rxBytesPerSecond" && key != "txBytesPerSecond" {
					t.Fatalf("unexpected metadata exported: %s", key)
				}
			}
		}
	}
	assertREST(readSample(), 500, 1000)
	if reader.calls.Load() != 2 {
		t.Fatalf("requests/subscription sampled reader: %d calls", reader.calls.Load())
	}
	now = now.Add(time.Second)
	svc.Collect(context.Background())
	assertREST(readSample(), 1000, 2000)
	if reader.calls.Load() != 3 {
		t.Fatalf("live event/REST sampled reader: %d calls", reader.calls.Load())
	}
}

type systemReader struct{}

func (systemReader) Read(context.Context) (domain.Raw, error) {
	return domain.Raw{Hostname: "Tower", MemoryTotal: 1024, MemoryAvailable: 512}, nil
}
func TestSystemEndpoint(t *testing.T) {
	for _, ready := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing host mounts", true: "host sample"}[ready], func(t *testing.T) {
			config := Config{}
			if ready {
				config.System = domain.NewService(systemReader{}, time.Now)
				config.System.Collect(context.Background())
			}
			rr := httptest.NewRecorder()
			NewServer(config).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/system", nil))
			var got domain.Snapshot
			if rr.Code != 200 || json.Unmarshal(rr.Body.Bytes(), &got) != nil {
				t.Fatalf("response = %d %s", rr.Code, rr.Body.String())
			}
			if got.Available != ready || (!ready && got.Reason == "") {
				t.Fatalf("snapshot = %+v", got)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(rr.Body.Bytes(), &fields); err != nil {
				t.Fatal(err)
			}
			if string(fields["networkInterfaces"]) != "[]" {
				t.Fatalf("empty networkInterfaces = %s, want []", fields["networkInterfaces"])
			}
			health := httptest.NewRecorder()
			NewServer(config).ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/healthz", nil))
			if health.Code != 204 {
				t.Fatal("health depends on mounts")
			}
		})
	}
}
func TestSystemEvents(t *testing.T) {
	svc := domain.NewService(systemReader{}, time.Now)
	svc.Collect(context.Background())
	server := httptest.NewServer(NewServer(Config{System: svc}))
	defer server.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get(server.URL + "/api/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("headers = %v", res.Header)
	}
	scanner := bufio.NewScanner(res.Body)
	if !scanner.Scan() || scanner.Text() != "event: system.metrics" {
		t.Fatalf("first event = %q", scanner.Text())
	}
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "data: ") {
		t.Fatalf("data = %q", scanner.Text())
	}
	var got domain.Snapshot
	if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &got); err != nil || got.Hostname != "Tower" {
		t.Fatalf("payload = %+v, %v", got, err)
	}
	svc.Collect(context.Background())
	found := false
	for scanner.Scan() {
		if scanner.Text() == "event: system.metrics" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("live event missing: %v", scanner.Err())
	}
}
