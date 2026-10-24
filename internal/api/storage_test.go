package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/storage"
)

type storageProvider struct{}

func (storageProvider) Read(context.Context) (storage.Snapshot, error) {
	return storage.Snapshot{Array: storage.Array{State: "started", DiskCount: 1, Capacity: &storage.Capacity{TotalBytes: 10240, UsedBytes: 6144, FreeBytes: 4096}}, Parity: storage.Parity{State: "idle"}, Disks: []storage.Disk{{Name: "disk1", PowerState: "active", Identity: "private-serial", Temperature: floatPtr(35), Counters: &storage.Counters{ReadBytes: 10}}}}, nil
}
func floatPtr(v float64) *float64 { return &v }
func TestStorageEndpoint(t *testing.T) {
	for _, ready := range []bool{false, true} {
		t.Run(map[bool]string{false: "provider unavailable", true: "read-only snapshot"}[ready], func(t *testing.T) {
			config := Config{}
			if ready {
				config.Storage = storage.NewService(storageProvider{}, time.Now)
				config.Storage.Collect(context.Background())
			}
			handler := NewServer(config)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/storage", nil))
			var got storage.Snapshot
			if rr.Code != 200 || json.Unmarshal(rr.Body.Bytes(), &got) != nil || got.Available != ready {
				t.Fatalf("response=%d %s", rr.Code, rr.Body.String())
			}
			if !ready && got.Reason == "" {
				t.Fatal("missing unavailable reason")
			}
			if strings.Contains(rr.Body.String(), "private-serial") || strings.Contains(rr.Body.String(), "Counters") {
				t.Fatal("private internal metadata leaked")
			}
			if ready && !strings.Contains(rr.Body.String(), `"powerState":"active"`) {
				t.Fatalf("power state missing: %s", rr.Body.String())
			}
			capResponse := httptest.NewRecorder()
			handler.ServeHTTP(capResponse, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
			var caps map[string]json.RawMessage
			if err := json.Unmarshal(capResponse.Body.Bytes(), &caps); err != nil {
				t.Fatal(err)
			}
			var array map[string]bool
			_ = json.Unmarshal(caps["array"], &array)
			if array["read"] != ready || array["start"] || array["stop"] {
				t.Fatalf("array capabilities=%v", array)
			}
		})
	}
}
