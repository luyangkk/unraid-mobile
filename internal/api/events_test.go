package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

type eventWriter struct {
	header    http.Header
	frames    chan string
	deadlines chan time.Time
	failWrite bool
	failFlush bool
	blockAt   int
	writes    int
	entered   chan struct{}
	release   chan struct{}
}

// newEventWriter records frames and write deadlines without a real network.
func newEventWriter() *eventWriter {
	return &eventWriter{header: make(http.Header), frames: make(chan string, 32), deadlines: make(chan time.Time, 32)}
}

// Header implements ResponseWriter's response-header storage.
func (w *eventWriter) Header() http.Header { return w.header }

// WriteHeader is unused because SSE sends only successful stream frames.
func (w *eventWriter) WriteHeader(int) {}

// Write records a frame or simulates a disconnected or stalled network.
func (w *eventWriter) Write(data []byte) (int, error) {
	w.writes++
	if w.blockAt == w.writes {
		close(w.entered)
		<-w.release
	}
	if w.failWrite {
		return 0, errors.New("disconnected")
	}
	w.frames <- string(data)
	return len(data), nil
}

// Flush provides the standard streaming capability required by the handler.
func (w *eventWriter) Flush() {}

// FlushError simulates a failure reported through ResponseController.
func (w *eventWriter) FlushError() error {
	if w.failFlush {
		return errors.New("flush failed")
	}
	return nil
}

// SetWriteDeadline records each deadline applied by ResponseController.
func (w *eventWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines <- deadline
	return nil
}

// awaitFrame waits for a real SSE frame, with a bound only for broken delivery.
func awaitFrame(t *testing.T, w *eventWriter) string {
	t.Helper()
	select {
	case frame := <-w.frames:
		return frame
	case <-time.After(time.Second):
		t.Fatal("SSE frame missing")
		return ""
	}
}

// awaitEventsExit joins a handler before inspecting its released subscriptions.
func awaitEventsExit(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("SSE handler did not exit")
	}
}

// subscriberCount inspects lifecycle bookkeeping only after registration or exit
// barriers, when no concurrent subscription mutation is possible.
func subscriberCount(service any) int {
	return reflect.ValueOf(service).Elem().FieldByName("subscribers").Len()
}

// TestEventsOperationAndSystem checks full snapshots, no replay and both sources.
func TestEventsOperationAndSystem(t *testing.T) {
	for _, withSystem := range []bool{false, true} {
		t.Run(map[bool]string{false: "without system", true: "with system"}[withSystem], func(t *testing.T) {
			store := operation.NewStore(time.Now)
			old, _ := store.Create("docker.start", "docker:old")
			config := Config{Operations: store}
			if withSystem {
				config.System = system.NewService(systemReader{}, time.Now)
				config.System.Collect(context.Background())
			}
			w := newEventWriter()
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan struct{})
			go func() {
				NewServer(config).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx))
				close(done)
			}()
			defer func() { cancel(); awaitEventsExit(t, done) }()
			if frame := awaitFrame(t, w); !strings.HasPrefix(frame, "event: system.metrics\n") {
				t.Fatalf("initial event: %q", frame)
			}
			if w.header.Get("Content-Type") != "text/event-stream" || w.header.Get("Cache-Control") != "no-cache, no-transform" || w.header.Get("X-Accel-Buffering") != "no" {
				t.Fatalf("SSE headers: %v", w.header)
			}
			if subscriberCount(store) != 1 {
				t.Fatal("Operation subscription missing")
			}
			op, _ := store.Create("docker.restart", "docker:plex")
			for _, state := range []operation.State{operation.Pending, operation.Running, operation.Failed} {
				if state == operation.Running {
					store.Update(op.ID, state, nil)
				}
				if state == operation.Failed {
					store.Update(op.ID, state, &operation.Error{Code: "FAILED", Message: "Execution failed"})
				}
				frame := awaitFrame(t, w)
				prefix := "event: operation.updated\ndata: "
				if !strings.HasPrefix(frame, prefix) || !strings.HasSuffix(frame, "\n\n") {
					t.Fatalf("Operation SSE frame: %q", frame)
				}
				var got operation.Operation
				data := strings.TrimSuffix(strings.TrimPrefix(frame, prefix), "\n\n")
				if err := json.Unmarshal([]byte(data), &got); err != nil {
					t.Fatal(err)
				}
				if got.ID != op.ID || got.ID == old.ID || got.State != state || got.Type != "docker.restart" || got.Resource != "docker:plex" || got.StartedAt.IsZero() {
					t.Fatalf("Operation snapshot: %+v", got)
				}
				if !strings.Contains(data, `"progress":null`) {
					t.Fatal("missing null progress")
				}
				if state == operation.Failed && (got.EndedAt == nil || got.Error == nil || got.Error.Code != "FAILED") {
					t.Fatal("terminal event omitted result")
				}
			}
			progressOp, _ := store.Create("docker.stop", "docker:progress")
			awaitFrame(t, w)
			store.Update(progressOp.ID, operation.Running, nil)
			awaitFrame(t, w)
			progress := 42.5
			store.UpdateProgress(progressOp.ID, &progress)
			frame := awaitFrame(t, w)
			var progressed operation.Operation
			data := strings.TrimSuffix(strings.TrimPrefix(frame, "event: operation.updated\ndata: "), "\n\n")
			if err := json.Unmarshal([]byte(data), &progressed); err != nil || progressed.ID != progressOp.ID || progressed.State != operation.Running || progressed.Progress == nil || *progressed.Progress != 42.5 {
				t.Fatalf("progress SSE = %+v, %v", progressed, err)
			}
			if withSystem {
				config.System.Collect(context.Background())
				if frame := awaitFrame(t, w); !strings.HasPrefix(frame, "event: system.metrics\n") {
					t.Fatalf("System stopped after Operation event: %q", frame)
				}
			}
			cancel()
			awaitEventsExit(t, done)
			if subscriberCount(store) != 0 || withSystem && subscriberCount(config.System) != 0 {
				t.Fatal("SSE disconnect leaked subscribers")
			}
			select {
			case deadline := <-w.deadlines:
				if remaining := time.Until(deadline); remaining <= 0 || remaining > 5*time.Second {
					t.Fatalf("write deadline = %v", deadline)
				}
			default:
				t.Fatal("SSE writes have no deadline")
			}
		})
	}
}

// TestEventsHTTPDisconnect releases both subscriptions after the TCP client exits.
func TestEventsHTTPDisconnect(t *testing.T) {
	store := operation.NewStore(time.Now)
	service := system.NewService(systemReader{}, time.Now)
	handler := NewServer(Config{System: service, Operations: store})
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler.ServeHTTP(w, r)
		close(done)
	}))
	defer server.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(server.URL + "/api/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	if !scanner.Scan() || scanner.Text() != "event: system.metrics" {
		t.Fatalf("initial HTTP event = %q, %v", scanner.Text(), scanner.Err())
	}
	store.Create("docker.restart", "docker:plex")
	found := false
	for scanner.Scan() {
		if scanner.Text() == "event: operation.updated" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("HTTP Operation event missing: %v", scanner.Err())
	}
	response.Body.Close()
	awaitEventsExit(t, done)
	if subscriberCount(store) != 0 || subscriberCount(service) != 0 {
		t.Fatal("closed TCP connection leaked subscribers")
	}
}

// TestEventsFailuresReleaseBothSubscriptions covers initial write and flush errors.
func TestEventsFailuresReleaseBothSubscriptions(t *testing.T) {
	for _, flush := range []bool{false, true} {
		t.Run(map[bool]string{false: "write failure", true: "flush failure"}[flush], func(t *testing.T) {
			store := operation.NewStore(time.Now)
			service := system.NewService(systemReader{}, time.Now)
			w := newEventWriter()
			w.failWrite, w.failFlush = !flush, flush
			NewServer(Config{System: service, Operations: store}).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/events", nil))
			if subscriberCount(store) != 0 || subscriberCount(service) != 0 {
				t.Fatal("initial SSE failure leaked subscriptions")
			}
		})
	}
}

// TestSlowEventsClientDoesNotBlockStoreSystemOrHTTP stalls one network write.
func TestSlowEventsClientDoesNotBlockStoreSystemOrHTTP(t *testing.T) {
	store := operation.NewStore(time.Now)
	service := system.NewService(systemReader{}, time.Now)
	handler := NewServer(Config{System: service, Operations: store})
	w := newEventWriter()
	w.blockAt, w.entered, w.release = 2, make(chan struct{}), make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx))
		close(done)
	}()
	defer func() { cancel(); close(w.release); awaitEventsExit(t, done) }()
	awaitFrame(t, w)
	op, _ := store.Create("docker.restart", "docker:plex")
	select {
	case <-w.entered:
	case <-time.After(time.Second):
		t.Fatal("Operation event did not reach slow client")
	}
	completed := make(chan struct{})
	go func() {
		defer close(completed)
		store.Update(op.ID, operation.Running, nil)
		for i := 0; i <= 100; i++ {
			progress := float64(i)
			store.UpdateProgress(op.ID, &progress)
		}
		service.Collect(context.Background())
		for _, path := range []string{"/healthz", "/api/v1/system", "/api/v1/operations/" + op.ID} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
			if response.Code != 200 && response.Code != 204 {
				t.Errorf("HTTP %s: %d", path, response.Code)
			}
		}
	}()
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("slow SSE client blocked Store, System collection or HTTP")
	}
}
