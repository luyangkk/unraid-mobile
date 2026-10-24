package spike

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	dockeradapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/docker"
)

// dockerProtocol serves a local synthetic Unix Engine without touching the fixed host socket.
func dockerProtocol(t *testing.T, handler http.Handler) string {
	t.Helper()
	// macOS Unix socket paths have a small length limit; use its short /tmp alias.
	dir, err := os.MkdirTemp("/tmp", "spike-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = server.Serve(listener)
	}()
	t.Cleanup(func() {
		_ = server.Close()
		<-done
	})
	return socket
}

// TestDockerProductionProtocolReadsOnlyFixedGETs verifies real adapter/service partial telemetry projection.
func TestDockerProductionProtocolReadsOnlyFixedGETs(t *testing.T) {
	id := strings.Repeat("a", 64)
	var mu sync.Mutex
	requests := map[string]int{}
	socket := dockerProtocol(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests[r.Method+" "+r.URL.RequestURI()]++
		mu.Unlock()
		switch r.Method + " " + r.URL.RequestURI() {
		case "GET /version":
			_ = json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.44", "MinAPIVersion": "1.24"})
		case "GET /v1.44/containers/json?all=1":
			_ = json.NewEncoder(w).Encode([]map[string]string{{"Id": id, "State": "running"}})
		case "GET /v1.44/containers/" + id + "/json":
			_, _ = w.Write([]byte(`{"State":{"StartedAt":"2020-01-01T00:00:00Z","Status":"running"}}`))
		case "GET /v1.44/containers/" + id + "/stats?stream=false&one-shot=true":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("SECRET container environment body"))
		default:
			t.Errorf("unapproved request %s %s", r.Method, r.URL.RequestURI())
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	c := fixtureConfig(t)
	enableReaders(&c)
	c.DockerReader = dockeradapter.NewReader(socket)
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || !r.Docker.Available || r.Docker.Count != 1 ||
		r.Docker.Summary.Running != 1 || r.Docker.Status != "partial" || !r.System.Available || !r.VM.Available {
		t.Fatalf("partial protocol report: %+v", r)
	}
	data, err := json.Marshal(r)
	if err != nil || strings.Contains(string(data), "SECRET") || strings.Contains(string(data), id) {
		t.Fatalf("protocol content leaked: %s %v", data, err)
	}
	mu.Lock()
	defer mu.Unlock()
	for _, request := range []string{"GET /version", "GET /v1.44/containers/json?all=1",
		"GET /v1.44/containers/" + id + "/json", "GET /v1.44/containers/" + id + "/stats?stream=false&one-shot=true"} {
		if requests[request] != 2 {
			t.Fatalf("two-cycle request %q = %d, want 2", request, requests[request])
		}
	}
}

// TestDockerProductionProtocolTimeoutClosesStalledRead verifies the real socket client obeys the module deadline.
func TestDockerProductionProtocolTimeoutClosesStalledRead(t *testing.T) {
	closed := make(chan struct{}, 1)
	socket := dockerProtocol(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
		closed <- struct{}{}
	}))
	c := fixtureConfig(t)
	enableReaders(&c)
	c.ModuleTimeout = 50 * time.Millisecond
	c.DockerReader = dockeradapter.NewReader(socket)
	start := time.Now()
	r := Run(context.Background(), c)
	if time.Since(start) > 500*time.Millisecond || r.ExitCode() != 2 || r.Docker.Available || !r.Storage.Available {
		t.Fatalf("stalled socket result: %+v", r)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("deadline returned but the production Docker socket was not closed")
	}
}

// TestDockerProductionProtocolSuccessAndInspectFailure checks fixed reads and optional network absence independently.
func TestDockerProductionProtocolSuccessAndInspectFailure(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		failInspect bool
		noNetwork   bool
		code        int
	}{
		{name: "complete"},
		{name: "optionalNetwork", noNetwork: true},
		{name: "inspectFailure", failInspect: true, code: 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			id := strings.Repeat("b", 64)
			socket := dockerProtocol(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method + " " + r.URL.RequestURI() {
				case "GET /version":
					_, _ = w.Write([]byte(`{"ApiVersion":"1.44","MinAPIVersion":"1.24"}`))
				case "GET /v1.44/containers/json?all=1":
					_ = json.NewEncoder(w).Encode([]map[string]string{{"Id": id, "State": "running"}})
				case "GET /v1.44/containers/" + id + "/json":
					if scenario.failInspect {
						w.WriteHeader(http.StatusServiceUnavailable)
						_, _ = w.Write([]byte("SECRET inspect XML labels token"))
					} else {
						_, _ = w.Write([]byte(`{"State":{"StartedAt":"2020-01-01T00:00:00Z","Status":"running"}}`))
					}
				case "GET /v1.44/containers/" + id + "/stats?stream=false&one-shot=true":
					stats := map[string]any{
						"read":         time.Now().UTC(),
						"cpu_stats":    map[string]any{"cpu_usage": map[string]uint64{"total_usage": 100}, "system_cpu_usage": 1000, "online_cpus": 2},
						"memory_stats": map[string]any{"usage": 1024, "limit": 4096},
					}
					if !scenario.noNetwork {
						stats["networks"] = map[string]any{"SECRET_interface": map[string]uint64{"rx_bytes": 10, "tx_bytes": 20}}
					}
					_ = json.NewEncoder(w).Encode(stats)
				default:
					t.Errorf("unapproved request: %s %s", r.Method, r.URL.RequestURI())
					w.WriteHeader(http.StatusForbidden)
				}
			}))
			c := fixtureConfig(t)
			enableReaders(&c)
			c.DockerReader = dockeradapter.NewReader(socket)
			r := Run(context.Background(), c)
			if r.ExitCode() != scenario.code || !r.Docker.Available || r.Docker.Count != 1 ||
				r.Docker.ProtocolPassed != (scenario.code == 0) {
				t.Fatalf("protocol result: %+v", r)
			}
			data, err := json.Marshal(r)
			if err != nil || strings.Contains(string(data), "SECRET") || strings.Contains(string(data), id) {
				t.Fatalf("sensitive output: %s: %v", data, err)
			}
			if scenario.noNetwork && (r.Docker.Status != "partial" ||
				len(r.Docker.Diagnostics) != 1 || r.Docker.Diagnostics[0] != "networkCountersUnavailable") {
				t.Fatalf("missing optional metric diagnostics: %+v", r.Docker)
			}
		})
	}
}
