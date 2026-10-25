// Package api exposes the versioned HTTP contract used by the PWA.
package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
	"github.com/unraid-mobile/unraid-mobile/internal/app/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
	"github.com/unraid-mobile/unraid-mobile/internal/app/vm"
)

type Config struct {
	AppToken        string
	VM              *vm.Service
	Docker          *docker.Service
	Storage         *storage.Service
	System          *system.Service
	Capabilities    capability.Set
	Operations      *operation.Store
	ContainerExists func(id string) bool
}

// NewServer exposes cached read endpoints and explicitly gated operation routes.
func NewServer(config Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/capabilities", func(w http.ResponseWriter, _ *http.Request) {
		caps := config.Capabilities
		caps.Docker = config.Docker != nil && config.Docker.Latest().Available
		caps.VM = config.VM != nil && config.VM.Latest().Available
		if config.Storage != nil {
			snapshot := config.Storage.Latest()
			caps.Storage.Read = snapshot.Available
			caps.Array.Read = snapshot.Available && snapshot.Array.State != "unknown"
			caps.Parity.Read = snapshot.Available && snapshot.Parity.State != "unknown"
			for _, disk := range snapshot.Disks {
				caps.Storage.Temperature = caps.Storage.Temperature || disk.Temperature != nil
				caps.Storage.IO = caps.Storage.IO || disk.Counters != nil
			}
		}
		writeJSON(w, http.StatusOK, caps)
	})
	mux.HandleFunc("GET /api/v1/docker", func(w http.ResponseWriter, _ *http.Request) {
		if config.Docker == nil {
			writeJSON(w, http.StatusOK, docker.Unavailable(time.Now(), "Docker provider unavailable; check the Unix socket mount and permissions"))
			return
		}
		writeJSON(w, http.StatusOK, config.Docker.Latest())
	})
	mux.HandleFunc("GET /api/v1/docker/{id}/icon", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if config.Docker != nil {
			if data, ok := config.Docker.Icon(r.PathValue("id"), r.URL.Query().Get("v")); ok {
				w.Header().Set("Content-Type", "image/png")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(data)
				return
			}
		}
		writeError(w, http.StatusNotFound, "DOCKER_ICON_NOT_FOUND", "Container icon unavailable", false)
	})
	mux.HandleFunc("GET /api/v1/vms", func(w http.ResponseWriter, _ *http.Request) {
		if config.VM == nil {
			writeJSON(w, http.StatusOK, vm.Unavailable(time.Now(), "VM provider unavailable; mount /var/run/libvirt read-only and check socket permissions"))
			return
		}
		writeJSON(w, http.StatusOK, config.VM.Latest())
	})
	mux.HandleFunc("GET /api/v1/storage", func(w http.ResponseWriter, _ *http.Request) {
		if config.Storage == nil {
			writeJSON(w, http.StatusOK, storage.Snapshot{Reason: "Storage provider unavailable; mount /var/local/emhttp at /host/var/local/emhttp read-only", Array: storage.Array{State: "unknown"}, Parity: storage.Parity{State: "unknown"}, Pools: []storage.Pool{}, Disks: []storage.Disk{}, Diagnostics: []string{}})
			return
		}
		writeJSON(w, http.StatusOK, config.Storage.Latest())
	})
	mux.HandleFunc("GET /api/v1/system", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, systemSnapshot(config.System))
	})
	mux.HandleFunc("GET /api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		handleEvents(w, r, config.System, config.Operations)
	})
	mux.HandleFunc("POST /api/v1/docker/", func(w http.ResponseWriter, r *http.Request) {
		handleDockerAction(w, r, config)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "ROUTE_NOT_FOUND", "Route not found", false)
	})
	return authenticateAPI(config.AppToken, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isOperationPath(r.URL.Path) {
			handleOperationQuery(w, r, config.Operations)
			return
		}
		mux.ServeHTTP(w, r)
	}))
}

// handleDockerAction validates resource and explicit write flags before acceptance.
func handleDockerAction(w http.ResponseWriter, r *http.Request, config Config) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/docker/"), "/")
	if len(parts) != 2 || parts[0] == "" || !isDockerAction(parts[1]) {
		writeError(w, http.StatusNotFound, "ROUTE_NOT_FOUND", "Route not found", false)
		return
	}
	id, action := parts[0], parts[1]
	if config.ContainerExists == nil || !config.ContainerExists(id) {
		writeError(w, http.StatusNotFound, "DOCKER_NOT_FOUND", "Container not found", false)
		return
	}
	caps := config.Capabilities
	if config.Docker != nil {
		caps.Docker = config.Docker.Latest().Available
	}
	if !caps.Allows("docker", action) {
		writeError(w, http.StatusConflict, "CAPABILITY_UNAVAILABLE", "Docker operation is unavailable on this system", false)
		return
	}
	if config.Operations == nil {
		writeError(w, http.StatusServiceUnavailable, "OPERATIONS_UNAVAILABLE", "Operations are unavailable", true)
		return
	}

	op, err := config.Operations.Create("docker."+action, "docker:"+id)
	if err == operation.ErrResourceBusy {
		writeError(w, http.StatusConflict, "RESOURCE_BUSY", "Another operation is already running for this container", true)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "OPERATION_CREATE_FAILED", "Couldn't create operation", true)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"operationId": op.ID, "accepted": true})
}

func isDockerAction(action string) bool {
	return action == "start" || action == "stop" || action == "restart"
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string, retryable bool) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":      code,
			"message":   message,
			"retryable": retryable,
		},
	})
}
