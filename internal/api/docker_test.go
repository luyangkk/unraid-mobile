package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
)

type dockerReader struct {
	calls atomic.Int32
	fail  bool
}

// Read provides a whitelisted container and private internal telemetry.
func (r *dockerReader) Read(context.Context) (docker.Raw, error) {
	r.calls.Add(1)
	if r.fail {
		return docker.Raw{}, errors.New("Docker unavailable")
	}
	at := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	start := at.Add(-time.Hour)
	return docker.Raw{Containers: []docker.RawContainer{{ID: "plex", Name: "Plex", State: "running", StartedAt: &start, Stats: &docker.Stats{Read: at}}}}, nil
}

// TestDockerEndpoint serves only cached public fields and dynamic read capabilities.
func TestDockerEndpoint(t *testing.T) {
	for _, ready := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing adapter", true: "cached snapshot"}[ready], func(t *testing.T) {
			r := &dockerReader{}
			config := Config{Capabilities: capability.Set{Docker: true}}
			if ready {
				config.Docker = docker.NewService(r, time.Now)
				config.Docker.Collect(context.Background())
			}
			handler := NewServer(config)
			for i := 0; i < 2; i++ {
				rr := httptest.NewRecorder()
				handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/docker", nil))
				var got docker.Snapshot
				if rr.Code != 200 || json.Unmarshal(rr.Body.Bytes(), &got) != nil || got.Available != ready || got.Timestamp.IsZero() {
					t.Fatalf("response: %d %s", rr.Code, rr.Body.String())
				}
				if !ready && (got.Reason == "" || got.Containers == nil || got.Diagnostics == nil) {
					t.Fatal("missing unavailable contract")
				}
				if ready {
					var fields map[string]json.RawMessage
					if err := json.Unmarshal(rr.Body.Bytes(), &fields); err != nil {
						t.Fatal(err)
					}
					if len(fields) != 6 {
						t.Fatalf("snapshot contract: %v", fields)
					}
					var rows []map[string]json.RawMessage
					json.Unmarshal(fields["containers"], &rows)
					if len(rows) != 1 || len(rows[0]) != 10 {
						t.Fatalf("container whitelist: %v", rows)
					}
					for _, key := range []string{"id", "name", "state", "cpuUsage", "memoryUsedBytes", "memoryLimitBytes", "uptimeSeconds", "networkRXRate", "networkTXRate", "diagnostics"} {
						if _, ok := rows[0][key]; !ok {
							t.Fatalf("missing container field %s", key)
						}
					}
					for _, secret := range []string{"StartedAt", "cpu_stats", "Stats", "Read"} {
						if strings.Contains(rr.Body.String(), secret) {
							t.Fatalf("internal metadata %s leaked", secret)
						}
					}
				}
				capsResponse := httptest.NewRecorder()
				handler.ServeHTTP(capsResponse, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
				var caps capability.Set
				json.Unmarshal(capsResponse.Body.Bytes(), &caps)
				if caps.Docker != ready || caps.Allows("docker", "restart") {
					t.Fatalf("caps: %+v", caps)
				}
			}
			if ready && r.calls.Load() != 1 {
				t.Fatal("HTTP requests triggered collection")
			}
			if ready {
				r.fail = true
				config.Docker.Collect(context.Background())
				rr := httptest.NewRecorder()
				handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
				var caps capability.Set
				json.Unmarshal(rr.Body.Bytes(), &caps)
				if caps.Docker {
					t.Fatal("read capability did not follow failure")
				}
			}
		})
	}
}

// TestDockerReadNeverEnablesActions rejects production writes after successful reads.
func TestDockerReadNeverEnablesActions(t *testing.T) {
	s := docker.NewService(&dockerReader{}, time.Now)
	s.Collect(context.Background())
	handler := NewServer(Config{Docker: s, Capabilities: capability.Set{Docker: true}, Operations: operation.NewStore(time.Now), ContainerExists: func(string) bool { return true }})
	for _, action := range []string{"start", "stop", "restart"} {
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/v1/docker/plex/"+action, nil))
		if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "CAPABILITY_UNAVAILABLE") {
			t.Fatalf("%s: %d %s", action, rr.Code, rr.Body.String())
		}
	}
}

type stalledDocker struct{ entered, release chan struct{} }

// Read stalls the Engine without tying up HTTP handlers.
func (r stalledDocker) Read(context.Context) (docker.Raw, error) {
	close(r.entered)
	<-r.release
	return docker.Raw{}, nil
}

// TestDockerCollectionDoesNotBlockHTTP checks health, cache and capabilities during I/O.
func TestDockerCollectionDoesNotBlockHTTP(t *testing.T) {
	r := stalledDocker{make(chan struct{}), make(chan struct{})}
	s := docker.NewService(r, time.Now)
	done := make(chan struct{})
	go func() { s.Collect(context.Background()); close(done) }()
	<-r.entered
	handler := NewServer(Config{Docker: s})
	requestsDone := make(chan struct{})
	go func() {
		defer close(requestsDone)
		for _, path := range []string{"/healthz", "/api/v1/docker", "/api/v1/capabilities"} {
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
			want := 200
			if path == "/healthz" {
				want = 204
			}
			if rr.Code != want {
				t.Errorf("%s status=%d", path, rr.Code)
			}
		}
	}()
	select {
	case <-requestsDone:
	case <-time.After(time.Second):
		t.Error("HTTP blocked on Engine")
	}
	close(r.release)
	<-done
	<-requestsDone
}
