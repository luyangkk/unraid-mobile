// Package api exposes the versioned HTTP contract used by the PWA.
package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

type Config struct {
	System          *system.Service
	Capabilities    capability.Set
	Operations      *operation.Store
	ContainerExists func(id string) bool
}

func NewServer(config Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/capabilities", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, config.Capabilities)
	})
	mux.HandleFunc("GET /api/v1/system", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, systemSnapshot(config.System))
	})
	mux.HandleFunc("GET /api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		handleSystemEvents(w, r, config.System)
	})
	mux.HandleFunc("POST /api/v1/docker/", func(w http.ResponseWriter, r *http.Request) {
		handleDockerAction(w, r, config)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "ROUTE_NOT_FOUND", "Route not found", false)
	})
	return mux
}

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
	if !config.Capabilities.Allows("docker", action) {
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
