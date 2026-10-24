package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

// systemSnapshot returns the cached snapshot or the existing unavailable contract.
func systemSnapshot(service *system.Service) system.Snapshot {
	if service == nil {
		return system.Snapshot{Timestamp: time.Now().UTC(), Reason: "Host metrics service unavailable", Diagnostics: map[string]string{}}
	}
	return service.Latest()
}

// handleEvents multiplexes independent latest-only sources and releases both on exit.
func handleEvents(w http.ResponseWriter, r *http.Request, service *system.Service, store *operation.Store) {
	if _, ok := w.(http.Flusher); !ok {
		writeError(w, 503, "STREAM_UNAVAILABLE", "Streaming unavailable", true)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	write := func(data string) bool {
		_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if _, err := fmt.Fprint(w, data); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	writeEvent := func(event string, snapshot any) bool {
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return false
		}
		return write("event: " + event + "\ndata: " + string(payload) + "\n\n")
	}
	var events <-chan system.Snapshot
	var operations <-chan operation.Operation
	if service != nil {
		var cancel func()
		events, cancel = service.Subscribe()
		defer cancel()
	}
	if store != nil {
		var cancel func()
		operations, cancel = store.Subscribe()
		defer cancel()
	}
	if service == nil {
		if !writeEvent("system.metrics", systemSnapshot(nil)) {
			return
		}
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case snapshot, ok := <-events:
			if !ok || !writeEvent("system.metrics", snapshot) {
				return
			}
		case snapshot, ok := <-operations:
			if !ok || !writeEvent("operation.updated", snapshot) {
				return
			}
		case <-heartbeat.C:
			if !write(": heartbeat\n\n") {
				return
			}
		}
	}
}
