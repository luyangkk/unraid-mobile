package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
)

// TestOperationQuery covers the complete query and unified error contracts.
func TestOperationQuery(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	store := operation.NewStore(func() time.Time { return at })
	op, _ := store.Create("docker.restart", "docker:plex")
	store.Update(op.ID, operation.Running, nil)
	cases := []struct {
		name, path, code, message string
		store                     *operation.Store
		status                    int
		retryable                 bool
	}{
		{name: "running", path: "/api/v1/operations/" + op.ID, store: store, status: 200},
		{name: "unknown", path: "/api/v1/operations/missing", store: store, status: 404, code: "OPERATION_NOT_FOUND", message: "Operation not found"},
		{name: "unavailable", path: "/api/v1/operations/" + op.ID, status: 503, code: "OPERATIONS_UNAVAILABLE", message: "Operations are unavailable", retryable: true},
	}
	for _, path := range []string{
		"/api/v1/operations", "/api/v1/operations/", "/api/v1/operations/op_1/",
		"/api/v1/operations/op_1/extra", "/api/v1/operations/op_1%2Fextra",
		"/api/v1/operations/%2F", "/api/v1/operations//op_1",
		"/api/v1/operations/./op_1", "/api/v1/operations/../operations/op_1",
		"/api/v1/operations/.", "/api/v1/operations/..",
		"/api/v1/operations%2fop_1", "/api%2fv1/operations/op_1",
		"/api/v1%2Foperations/op_1", "//api/v1/operations/op_1",
		"/api//v1/operations/op_1", "/api/v1//operations/op_1",
		"/api/./v1/operations/op_1",
	} {
		cases = append(cases, struct {
			name, path, code, message string
			store                     *operation.Store
			status                    int
			retryable                 bool
		}{name: path, path: path, store: store, status: 404, code: "ROUTE_NOT_FOUND", message: "Route not found"})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			NewServer(Config{Operations: tc.store}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if response.Code != tc.status {
				t.Fatalf("status = %d; body = %s", response.Code, response.Body.String())
			}
			if tc.code != "" {
				var payload struct {
					Error struct {
						Code, Message string
						Retryable     bool
					} `json:"error"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				if payload.Error.Code != tc.code || payload.Error.Message != tc.message || payload.Error.Retryable != tc.retryable {
					t.Fatalf("error = %+v", payload.Error)
				}
				return
			}
			var got operation.Operation
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.ID != op.ID || got.State != operation.Running || got.Type != "docker.restart" || got.Resource != "docker:plex" || !got.StartedAt.Equal(at) {
				t.Fatalf("query = %+v", got)
			}
			var fields map[string]json.RawMessage
			json.Unmarshal(response.Body.Bytes(), &fields)
			if string(fields["progress"]) != "null" {
				t.Fatalf("unknown progress = %s", fields["progress"])
			}
		})
	}
}

// TestOperationQueryTerminalAndExpiry exposes real progress/error and expires by clock.
func TestOperationQueryTerminalAndExpiry(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	store := operation.NewStore(func() time.Time { return at })
	op, _ := store.Create("docker.restart", "docker:plex")
	store.Update(op.ID, operation.Running, nil)
	progress := 42.5
	store.UpdateProgress(op.ID, &progress)
	store.Update(op.ID, operation.Failed, &operation.Error{Code: "FAILED", Message: "Execution failed", Retryable: true})
	handler := NewServer(Config{Operations: store})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/operations/"+op.ID, nil))
	var got operation.Operation
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || got.EndedAt == nil || !got.EndedAt.Equal(at) || got.Progress == nil || *got.Progress != 42.5 || got.Error == nil || got.Error.Code != "FAILED" || !got.Error.Retryable {
		t.Fatalf("terminal query = %d %s", response.Code, response.Body.String())
	}
	at = at.Add(25 * time.Hour)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/operations/"+op.ID, nil))
	if response.Code != 404 {
		t.Fatalf("expired query = %d", response.Code)
	}
}

// TestFakeDockerAcceptanceRemainsPending rejects writes by default and never executes.
func TestFakeDockerAcceptanceRemainsPending(t *testing.T) {
	service := docker.NewService(&dockerReader{}, time.Now)
	service.Collect(context.Background())
	for _, enabled := range []bool{false, true} {
		for _, action := range []string{"start", "stop", "restart"} {
			t.Run(action+map[bool]string{false: "/production", true: "/fake"}[enabled], func(t *testing.T) {
				store := operation.NewStore(time.Now)
				handler := NewServer(Config{
					Docker: service, Operations: store,
					Capabilities:    capability.Set{DockerActions: capability.DockerActions{Start: enabled, Stop: enabled, Restart: enabled}},
					ContainerExists: func(string) bool { return true },
				})
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/docker/plex/"+action, nil))
				if !enabled {
					if response.Code != 409 {
						t.Fatalf("default write accepted: %d", response.Code)
					}
					if _, exists := store.Get("op_1"); exists {
						t.Fatal("denied write created an operation")
					}
					return
				}
				var accepted struct {
					OperationID string `json:"operationId"`
				}
				if response.Code != 202 || json.Unmarshal(response.Body.Bytes(), &accepted) != nil {
					t.Fatalf("fake acceptance = %d %s", response.Code, response.Body.String())
				}
				op, exists := store.Get(accepted.OperationID)
				if !exists || op.State != operation.Pending || op.EndedAt != nil {
					t.Fatalf("fake route executed operation: %+v", op)
				}
				query := httptest.NewRecorder()
				handler.ServeHTTP(query, httptest.NewRequest(http.MethodGet, "/api/v1/operations/"+op.ID, nil))
				if query.Code != 200 {
					t.Fatalf("accepted operation not queryable: %d", query.Code)
				}
			})
		}
	}
}
