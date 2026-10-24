package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/api"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
)

func TestVMReadRequiresExplicitOptIn(t *testing.T) {
	for _, value := range []string{"", "false", "1", "TRUE", "true"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("VM_READ_ENABLED", value)
			if got := vmReaderFromEnvironment(); (got != nil) != (value == "true") {
				t.Fatalf("VM_READ_ENABLED=%q reader=%v", value, got)
			}
		})
	}
}

// TestProductionOperationRoutes checks API validation before static routing
// can normalize malformed paths, while keeping embedded assets accessible.
func TestProductionOperationRoutes(t *testing.T) {
	store := operation.NewStore(time.Now)
	op, _ := store.Create("docker.restart", "docker:plex")
	apiHandler := api.NewServer(api.Config{Operations: store})
	static := http.FileServer(http.FS(fstest.MapFS{"index.html": {Data: []byte("embedded page")}}))
	handler := routeAPIRequests(apiHandler, static)
	for _, requestPath := range []string{
		"/api/v1/operations/" + op.ID,
		"/api/v1/operations%2f" + op.ID,
		"//api/v1/operations/" + op.ID,
		"/api//v1/operations/" + op.ID,
		"/api/v1//operations/" + op.ID,
		"/api/./v1/operations/" + op.ID,
	} {
		t.Run(requestPath, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
			if requestPath == "/api/v1/operations/"+op.ID {
				if response.Code != 200 {
					t.Fatalf("valid query = %d %s", response.Code, response.Body.String())
				}
			} else if response.Code != 404 || !strings.Contains(response.Body.String(), `"code":"ROUTE_NOT_FOUND"`) {
				t.Fatalf("malformed route = %d %s", response.Code, response.Body.String())
			}
		})
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != 200 || response.Body.String() != "embedded page" {
		t.Fatalf("static response = %d %s", response.Code, response.Body.String())
	}
}
