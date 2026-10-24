package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

func systemSnapshot(service *system.Service) system.Snapshot {
	if service == nil {
		return system.Snapshot{Timestamp: time.Now().UTC(), Reason: "Host metrics service unavailable", Diagnostics: map[string]string{}}
	}
	return service.Latest()
}

func handleSystemEvents(w http.ResponseWriter, r *http.Request, service *system.Service) {
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
	writeSnapshot := func(snapshot system.Snapshot) bool {
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return false
		}
		return write("event: system.metrics\ndata: " + string(payload) + "\n\n")
	}
	var events <-chan system.Snapshot
	if service != nil {
		var cancel func()
		events, cancel = service.Subscribe()
		defer cancel()
	} else {
		if !writeSnapshot(systemSnapshot(nil)) {
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
			if !ok || !writeSnapshot(snapshot) {
				return
			}
		case <-heartbeat.C:
			if !write(": heartbeat\n\n") {
				return
			}
		}
	}
}
