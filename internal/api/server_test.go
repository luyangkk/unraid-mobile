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

// newTestServer explicitly opts a fake read provider into restart acceptance.
func newTestServer() http.Handler {
	service := docker.NewService(&dockerReader{}, time.Now)
	service.Collect(context.Background())
	return NewServer(Config{
		Docker: service,
		Capabilities: capability.Set{
			Docker:        true,
			DockerActions: capability.DockerActions{Restart: true},
			Array:         capability.Array{Read: true, Start: true},
		},
		Operations: operation.NewStore(time.Now),
		ContainerExists: func(id string) bool {
			return id == "plex"
		},
	})
}

func TestCapabilitiesEndpoint(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	response := httptest.NewRecorder()
	newTestServer().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}

	var payload capability.Set
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Docker || !payload.Array.Start {
		t.Fatalf("capability payload = %#v, want docker and array.start", payload)
	}
}

func TestDockerActionEndpoint(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		path     string
		wantCode int
		wantErr  string
	}{
		{name: "accepts known docker restart", path: "/api/v1/docker/plex/restart", wantCode: http.StatusAccepted},
		{name: "rejects an unknown container", path: "/api/v1/docker/missing/restart", wantCode: http.StatusNotFound, wantErr: "DOCKER_NOT_FOUND"},
		{name: "rejects unsupported action", path: "/api/v1/docker/plex/pause", wantCode: http.StatusNotFound, wantErr: "ROUTE_NOT_FOUND"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, tc.path, nil)
			response := httptest.NewRecorder()
			newTestServer().ServeHTTP(response, request)

			if response.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, tc.wantCode, response.Body.String())
			}
			if tc.wantErr == "" {
				var payload struct {
					OperationID string `json:"operationId"`
					Accepted    bool   `json:"accepted"`
				}
				if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
					t.Fatalf("decode response: %v", err)
				}
				if !payload.Accepted || payload.OperationID == "" {
					t.Fatalf("accepted payload = %#v", payload)
				}
				return
			}

			var payload struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if payload.Error.Code != tc.wantErr {
				t.Fatalf("error code = %q, want %q", payload.Error.Code, tc.wantErr)
			}
		})
	}
}
