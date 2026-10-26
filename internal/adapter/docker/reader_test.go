package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	appdocker "github.com/unraid-mobile/unraid-mobile/internal/app/docker"
)

var containerID = strings.Repeat("a", 64)

// unixEngine serves a synthetic Docker API over a real Unix socket.
func unixEngine(t *testing.T, handler http.HandlerFunc) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "engine-")
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "docker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		os.RemoveAll(dir)
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); os.RemoveAll(dir) })
	return socket
}

// TestReaderRestrictedEngine verifies negotiation, fixed GETs and skipped stopped telemetry.
func TestReaderRestrictedEngine(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]int{}
	socket := unixEngine(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen[r.Method+" "+r.URL.RequestURI()]++
		mu.Unlock()
		switch r.URL.Path {
		case "/version":
			fmt.Fprint(w, `{"ApiVersion":"1.43","MinAPIVersion":"1.24"}`)
		case "/v1.43/containers/json":
			if r.URL.RawQuery != "all=1" {
				t.Error("list must include all containers")
			}
			fmt.Fprintf(w, `[{"Id":%q,"Names":["/Plex"],"State":"running","Labels":{"secret":"hidden","folder.view2":"Photos"}},{"Id":%q,"Names":["/Stopped"],"State":"exited"}]`, containerID, strings.Repeat("b", 64))
		case "/v1.43/containers/" + containerID + "/json":
			fmt.Fprint(w, `{"State":{"StartedAt":"2026-10-23T23:00:00Z"},"Config":{"Env":["SECRET=hidden"]}}`)
		case "/v1.43/containers/" + containerID + "/stats":
			if r.URL.Query().Get("stream") != "false" || r.URL.Query().Get("one-shot") != "true" {
				t.Error("stats must be one shot")
			}
			fmt.Fprint(w, `{"read":"2026-10-24T00:00:00Z","cpu_stats":{"cpu_usage":{"total_usage":100,"percpu_usage":[50,50]},"system_cpu_usage":1000},"memory_stats":{"usage":1000,"limit":2000,"stats":{"inactive_file":200}},"networks":{"eth0":{"rx_bytes":100,"tx_bytes":200}},"secret":"hidden"}`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
			w.WriteHeader(404)
		}
	})
	got, err := NewReader(socket).Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.Containers[0].FolderName != "Photos" {
		t.Fatal("folder label was not read")
	}
	if len(got.Containers) != 2 {
		t.Fatalf("list: %+v", got)
	}
	c := got.Containers[0]
	if c.Name != "Plex" || c.StartedAt == nil || c.Stats == nil || c.Stats.Read.Format(time.RFC3339) != "2026-10-24T00:00:00Z" || c.Stats.OnlineCPUs != 2 || *c.Stats.CPUUsage != 100 {
		t.Fatalf("container: %+v", c)
	}
	bytes, _ := json.Marshal(got)
	if strings.Contains(string(bytes), "hidden") || strings.Contains(string(bytes), "SECRET") {
		t.Fatalf("private metadata retained: %s", bytes)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 4 {
		t.Fatalf("requests: %v", seen)
	}
	for path := range seen {
		if !strings.HasPrefix(path, "GET ") {
			t.Fatalf("non-GET: %s", path)
		}
	}
}

// TestReaderPartialFailures retains list entries when individual telemetry disappears.
func TestReaderPartialFailures(t *testing.T) {
	for _, failure := range []string{"inspect", "stats", "bad id"} {
		t.Run(failure, func(t *testing.T) {
			id := containerID
			if failure == "bad id" {
				id = "../../version"
			}
			socket := unixEngine(t, func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.URL.Path == "/version":
					fmt.Fprint(w, `{"ApiVersion":"1.44"}`)
				case r.URL.Path == "/v1.44/containers/json":
					fmt.Fprintf(w, `[{"Id":%q,"Names":["/Plex"],"State":"running"}]`, id)
				case failure == "bad id":
					t.Error("invalid ID reached Engine")
					w.WriteHeader(404)
				case strings.HasSuffix(r.URL.Path, "/json"):
					if failure == "inspect" {
						w.WriteHeader(404)
						fmt.Fprint(w, "private-error")
						return
					}
					fmt.Fprint(w, `{"State":{"StartedAt":"2026-10-23T00:00:00Z"}}`)
				case strings.HasSuffix(r.URL.Path, "/stats"):
					if failure == "stats" {
						w.WriteHeader(500)
						fmt.Fprint(w, "private-error")
						return
					}
					fmt.Fprint(w, `{"read":"2026-10-24T00:00:00Z"}`)
				default:
					t.Error("unexpected path")
				}
			})
			raw, err := NewReader(socket).Read(context.Background())
			if err != nil || len(raw.Containers) != 1 || len(raw.Containers[0].Diagnostics) == 0 {
				t.Fatalf("partial failure: %+v %v", raw, err)
			}
			if failure == "stats" && raw.Containers[0].Stats != nil {
				t.Fatal("failed stats retained")
			}
			if failure == "inspect" && (raw.Containers[0].StartedAt != nil || raw.Containers[0].Stats == nil) {
				t.Fatal("inspect failure discarded independent stats")
			}
			data, _ := json.Marshal(raw)
			if strings.Contains(string(data), "private-error") {
				t.Fatal("daemon error leaked")
			}
		})
	}
}

// TestReaderNegotiation rejects incompatible APIs and caps newer daemons.
func TestReaderNegotiation(t *testing.T) {
	for _, tc := range []struct {
		version, minimum, path string
		fail                   bool
	}{
		{"1.30", "1.24", "/v1.30/containers/json", false},
		{"1.99", "1.24", "/v1.44/containers/json", false},
		{"1.52", "1.44", "/v1.44/containers/json", false},
		{"1.23", "1.12", "", true},
		{"1.99", "1.45", "", true},
		{"invalid", "", "", true},
	} {
		t.Run(tc.version+tc.minimum, func(t *testing.T) {
			socket := unixEngine(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/version" {
					fmt.Fprintf(w, `{"ApiVersion":%q,"MinAPIVersion":%q}`, tc.version, tc.minimum)
					return
				}
				if r.URL.Path != tc.path {
					t.Errorf("negotiated path: %s", r.URL.Path)
				}
				fmt.Fprint(w, `[]`)
			})
			raw, err := NewReader(socket).Read(context.Background())
			if (err != nil) != tc.fail || (!tc.fail && len(raw.Containers) != 0) {
				t.Fatalf("negotiation: %+v %v", raw, err)
			}
		})
	}
}

// TestReaderRestartDuringStats rejects mixed startup identities even when counters grow.
func TestReaderRestartDuringStats(t *testing.T) {
	var phase atomic.Int32
	var restarted atomic.Bool
	socket := unixEngine(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/version":
			fmt.Fprint(w, `{"ApiVersion":"1.44"}`)
		case r.URL.Path == "/v1.44/containers/json":
			fmt.Fprintf(w, `[{"Id":%q,"Names":["/Plex"],"State":"running"}]`, containerID)
		case strings.HasSuffix(r.URL.Path, "/json"):
			start := "2026-10-23T23:00:00Z"
			if restarted.Load() {
				start = "2026-10-24T00:00:01Z"
			}
			fmt.Fprintf(w, `{"State":{"StartedAt":%q,"Status":"running"}}`, start)
		case strings.HasSuffix(r.URL.Path, "/stats"):
			n := phase.Load()
			if n == 1 {
				restarted.Store(true)
			}
			fmt.Fprintf(w, `{"read":"2026-10-24T00:00:%02dZ","cpu_stats":{"cpu_usage":{"total_usage":%d},"system_cpu_usage":%d,"online_cpus":4},"memory_stats":{"usage":1000},"networks":{"eth0":{"rx_bytes":%d,"tx_bytes":%d}}}`,
				n*2, 100+n*50, 1000+n*1000, 100+n*200, 200+n*400)
		}
	})
	reader := NewReader(socket)
	service := appdocker.NewService(reader, func() time.Time {
		return time.Date(2026, 10, 24, 0, 1, 0, 0, time.UTC)
	})
	service.Collect(context.Background())
	phase.Store(1)
	mixed := service.Collect(context.Background()).Containers[0]
	if mixed.CPUUsage != nil || mixed.NetworkRXRate != nil || len(mixed.Diagnostics) == 0 {
		t.Fatalf("mixed restart stats accepted: %+v", mixed)
	}
	phase.Store(2)
	first := service.Collect(context.Background()).Containers[0]
	if first.CPUUsage != nil || first.NetworkRXRate != nil {
		t.Fatal("recovery must rebuild startup baseline")
	}
	phase.Store(3)
	valid := service.Collect(context.Background()).Containers[0]
	if valid.CPUUsage == nil || *valid.CPUUsage != 20 || valid.NetworkRXRate == nil || *valid.NetworkRXRate != 100 {
		t.Fatalf("stable new startup did not recover: %+v", valid)
	}
}

// TestReaderFairness gives healthy tail containers a turn despite repeated front timeouts.
func TestReaderFairness(t *testing.T) {
	var healthyReads atomic.Int32
	healthyID := fmt.Sprintf("%064x", 8)
	socket := unixEngine(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/version":
			fmt.Fprint(w, `{"ApiVersion":"1.44"}`)
		case r.URL.Path == "/v1.44/containers/json":
			fmt.Fprint(w, "[")
			for i := 0; i < 9; i++ {
				if i > 0 {
					fmt.Fprint(w, ",")
				}
				fmt.Fprintf(w, `{"Id":"%064x","Names":["/c%d"],"State":"running"}`, i, i)
			}
			fmt.Fprint(w, "]")
		case strings.Contains(r.URL.Path, healthyID):
			healthyReads.Add(1)
			if strings.HasSuffix(r.URL.Path, "/json") {
				fmt.Fprint(w, `{"State":{"StartedAt":"2026-10-23T00:00:00Z","Status":"running"}}`)
			} else {
				fmt.Fprint(w, `{"read":"2026-10-24T00:00:00Z","memory_stats":{"usage":1000}}`)
			}
		default:
			<-r.Context().Done()
		}
	})
	reader := NewReader(socket)
	var observed bool
	for i := 0; i < 3; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
		raw, err := reader.Read(ctx)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		if len(raw.Containers) != 9 {
			t.Fatal("list was truncated")
		}
		if raw.Containers[8].Stats != nil && raw.Containers[8].StartedAt != nil {
			observed = true
		}
	}
	if !observed || healthyReads.Load() == 0 {
		t.Fatal("healthy tail container starved across sampling rounds")
	}
}

// TestReaderBounds covers refused sockets, deadlines, redirects and oversized responses.
func TestReaderBounds(t *testing.T) {
	if _, err := NewReader("/tmp/unraid-mobile-no-such-socket").Read(context.Background()); err == nil {
		t.Fatal("missing socket accepted")
	}
	for _, mode := range []string{"slow", "redirect", "large", "malformed", "list failure"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			socket := unixEngine(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				switch mode {
				case "slow":
					<-r.Context().Done()
				case "redirect":
					http.Redirect(w, r, "http://example.com/secret", http.StatusFound)
				case "large":
					fmt.Fprint(w, strings.Repeat(" ", 8*1024*1024+1))
				case "malformed":
					fmt.Fprint(w, `{} {}`)
				case "list failure":
					if r.URL.Path == "/version" {
						fmt.Fprint(w, `{"ApiVersion":"1.44"}`)
					} else {
						w.WriteHeader(403)
					}
				}
			})
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			start := time.Now()
			if _, err := NewReader(socket).Read(ctx); err == nil {
				t.Fatal("unbounded/invalid response accepted")
			}
			if time.Since(start) > time.Second {
				t.Fatal("read ignored deadline")
			}
			if mode == "redirect" && calls.Load() != 1 {
				t.Fatal("redirect followed")
			}
		})
	}
}

// TestReaderConcurrency limits in-flight telemetry and retains complete list order.
func TestReaderConcurrency(t *testing.T) {
	var inFlight, peak atomic.Int32
	socket := unixEngine(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/version" {
			fmt.Fprint(w, `{"ApiVersion":"1.44"}`)
			return
		}
		if r.URL.Path == "/v1.44/containers/json" {
			fmt.Fprint(w, "[")
			for i := 0; i < 12; i++ {
				if i > 0 {
					fmt.Fprint(w, ",")
				}
				fmt.Fprintf(w, `{"Id":"%064x","Names":["/c%d"],"State":"running"}`, i, i)
			}
			fmt.Fprint(w, "]")
			return
		}
		n := inFlight.Add(1)
		defer inFlight.Add(-1)
		for old := peak.Load(); n > old; old = peak.Load() {
			if peak.CompareAndSwap(old, n) {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
		if strings.HasSuffix(r.URL.Path, "/json") {
			fmt.Fprint(w, `{"State":{"StartedAt":"2026-10-23T00:00:00Z"}}`)
		} else {
			fmt.Fprint(w, `{"read":"2026-10-24T00:00:00Z"}`)
		}
	})
	raw, err := NewReader(socket).Read(context.Background())
	if err != nil || len(raw.Containers) != 12 || raw.Containers[11].Name != "c11" {
		t.Fatalf("list: %+v %v", raw, err)
	}
	if peak.Load() > 4 || peak.Load() < 2 {
		t.Fatalf("concurrency=%d", peak.Load())
	}
}
