package main

import (
	"bytes"
	"log"
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
	handler := newFrontendHandler(apiHandler, fstest.MapFS{"index.html": {Data: []byte("embedded page")}})
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

// TestProductionAuthDispatch keeps all API variants outside the static fallback.
func TestProductionAuthDispatch(t *testing.T) {
	config := api.Config{AppToken: "production-test-credential"}
	apiHandler := api.NewServer(config)
	fallbackCalls := 0
	fallback := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fallbackCalls++
		if r.URL.Path == "/healthz" {
			apiHandler.ServeHTTP(w, r)
			return
		}
		w.Write([]byte("public asset"))
	})
	handler := routeAPIRequests(apiHandler, fallback)
	for _, requestPath := range []string{
		"/api", "/api/", "//api", "//api/v1/system", "/api//v1/system",
		"/api/./v1/system", "/api/../healthz", "/api/%2e%2e/healthz",
		"/assets/../api", "/assets/%2e%2e/api/v1/capabilities",
		"/%61pi/v1/storage", "/%2fapi/v1/events", "/api%2fv1/docker",
		"/assets%2f..%2fapi%2fv1/capabilities", "/api/v1/unknown",
		"/api/v1/operations%2fop_1", "/api/v1/operations/./op_1",
	} {
		t.Run(requestPath, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
			if response.Code != 401 || response.Header().Get("Location") != "" ||
				response.Body.String() != "{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"Authentication required\",\"retryable\":false}}\n" {
				t.Fatalf("API dispatch = %d %v %s", response.Code, response.Header(), response.Body.String())
			}
		})
	}
	if fallbackCalls != 0 {
		t.Fatalf("API reached static fallback %d times", fallbackCalls)
	}
	for _, tc := range []struct {
		path string
		code int
	}{{"/healthz", 204}, {"/", 200}, {"/assets/app.js", 200}} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if response.Code != tc.code {
			t.Fatalf("public %s = %d", tc.path, response.Code)
		}
	}
}

// TestProductionAuthenticatedOperationPaths preserves malformed-query rejection.
func TestProductionAuthenticatedOperationPaths(t *testing.T) {
	config := api.Config{AppToken: "production-test-credential", Operations: operation.NewStore(time.Now)}
	handler := routeAPIRequests(api.NewServer(config), http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("malformed authenticated API reached static fallback")
	}))
	for _, requestPath := range []string{
		"//api/v1/operations/op_1", "/api/./v1/operations/op_1",
		"/api/v1/operations%2fop_1", "/api/v1/operations/op_1%2fextra",
		"/api//v1/operations/op_1", "/api/v1//operations/op_1",
		"/other/%2e%2e/api/v1/operations/op_1", "/api/v1/operations/%2e",
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, requestPath, nil)
		request.Header.Set("Authorization", "Bearer production-test-credential")
		handler.ServeHTTP(response, request)
		if response.Code != 404 || !strings.Contains(response.Body.String(), `"code":"ROUTE_NOT_FOUND"`) || response.Header().Get("Location") != "" {
			t.Fatalf("malformed path = %d %v %s", response.Code, response.Header(), response.Body.String())
		}
	}
}

// TestAppTokenEnvironment uses the production configuration and sanitized mode log.
func TestAppTokenEnvironment(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	for _, token := range []string{"", "environment-only-credential", " "} {
		t.Setenv("APP_TOKEN", token)
		output.Reset()
		config := apiConfigFromEnvironment()
		if config.AppToken != token {
			t.Fatal("APP_TOKEN was changed before configuring authentication")
		}
		logAuthenticationMode(config.AppToken)
		want := "authentication enabled"
		if token == "" {
			want = "LAN mode"
		}
		if !strings.Contains(output.String(), want) ||
			strings.Contains(output.String(), "environment-only-credential") {
			t.Fatalf("unsafe startup mode log: %q", output.String())
		}
		response := httptest.NewRecorder()
		api.NewServer(config).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
		wantStatus := 401
		if token == "" {
			wantStatus = 200
		}
		if response.Code != wantStatus {
			t.Fatalf("environment auth mode = %d, want %d", response.Code, wantStatus)
		}
	}
}
