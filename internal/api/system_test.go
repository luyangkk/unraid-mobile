package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	domain "github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

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
