package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
	"github.com/unraid-mobile/unraid-mobile/internal/app/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
	"github.com/unraid-mobile/unraid-mobile/internal/app/vm"
)

const testAppToken = "test-only-credential"

// assertUnauthorized checks the exact public rejection contract without leaks.
func assertUnauthorized(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body = %s", response.Code, response.Body.String())
	}
	want := http.Header{
		"Content-Type":     {"application/json; charset=utf-8"},
		"Cache-Control":    {"no-store"},
		"Www-Authenticate": {"Bearer"},
	}
	if !reflect.DeepEqual(response.Header(), want) {
		t.Fatalf("unsafe rejection headers: %v", response.Header())
	}
	if response.Body.String() != "{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"Authentication required\",\"retryable\":false}}\n" {
		t.Fatalf("unsafe rejection body: %s", response.Body.String())
	}
}

// TestAuthFailuresAreUniform rejects ambiguous credentials and alternate carriers.
func TestAuthFailuresAreUniform(t *testing.T) {
	handler := NewServer(Config{AppToken: testAppToken})
	for _, headers := range [][]string{
		nil, {""}, {"Bearer"}, {"Bearer "}, {"Basic " + testAppToken},
		{"Bearer wrong"}, {"Bearer " + testAppToken + "x"},
		{"Bearer  " + testAppToken}, {" Bearer " + testAppToken},
		{"Bearer\t" + testAppToken}, {"Bearer " + testAppToken + " "},
		{"Bearer " + testAppToken + "\t"}, {"Bearer " + testAppToken + "\n"},
		{"Bearer " + testAppToken + ",Bearer " + testAppToken},
		{"Bearer " + testAppToken, "Bearer " + testAppToken},
		{"Bearer " + testAppToken, ""},
	} {
		t.Run(strings.Join(headers, "|"), func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities?token="+testAppToken, nil)
			request.AddCookie(&http.Cookie{Name: "APP_TOKEN", Value: testAppToken})
			for _, value := range headers {
				request.Header.Add("Authorization", value)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			assertUnauthorized(t, response)
		})
	}
}

// TestAuthPrecedesAllAPIRouting rejects every method before normalization or reads.
func TestAuthPrecedesAllAPIRouting(t *testing.T) {
	config := Config{
		AppToken: testAppToken,
		System:   &system.Service{}, Storage: &storage.Service{},
		Docker: &docker.Service{}, VM: &vm.Service{},
		Operations: operation.NewStore(func() time.Time {
			t.Error("unauthorized request accessed the operation store")
			return time.Now()
		}),
		Capabilities: capability.Set{Docker: true, DockerActions: capability.DockerActions{Start: true, Stop: true, Restart: true}},
		ContainerExists: func(string) bool {
			t.Error("unauthorized request looked up a resource")
			return true
		},
	}
	handler := NewServer(config)
	for _, requestPath := range []string{
		"/api", "/api/", "/api/v1/capabilities", "/api/v1/system",
		"/api/v1/storage", "/api/v1/docker", "/api/v1/vms", "/api/v1/events",
		"/api/v1/docker/plex/start", "/api/v1/docker/plex/stop", "/api/v1/docker/plex/restart",
		"/api/v1/operations", "/api/v1/operations/op_1", "/api/v1/unknown",
		"//api", "//api/v1/capabilities", "/api//v1/system", "/api/./v1/storage",
		"/outside/../api/v1/docker", "/outside/%2e%2e/api/v1/vms",
		"/%61pi/v1/capabilities", "/%2fapi/v1/events", "/api%2fv1/system",
		"/outside%2f..%2fapi%2fv1/capabilities", "/api/%2e%2e/healthz",
		"/api/../healthz", "/api/v1/operations%2fop_1", "/api/v1/operations/./op_1",
	} {
		for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT"} {
			t.Run(method+" "+requestPath, func(t *testing.T) {
				request := httptest.NewRequest(method, requestPath, nil)
				// CONNECT normally uses an authority target; exercise its path routing explicitly.
				if method == "CONNECT" {
					request.URL = httptest.NewRequest("GET", requestPath, nil).URL
				}
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				assertUnauthorized(t, response)
				if subscriberCount(config.Operations) != 0 {
					t.Fatal("unauthorized SSE registered an operation subscription")
				}
			})
		}
	}
}

// TestAuthOptionalAndExact preserves LAN mode without trimming configured tokens.
func TestAuthOptionalAndExact(t *testing.T) {
	for _, tc := range []struct {
		token, header string
		status        int
	}{
		{"", "", 200}, {"", "Basic ignored", 200},
		{testAppToken, "Bearer " + testAppToken, 200},
		{testAppToken, "bEaReR " + testAppToken, 200},
		{" " + testAppToken, "Bearer " + testAppToken, 401},
		{testAppToken + " ", "Bearer " + testAppToken, 401},
		{" ", "", 401},
	} {
		t.Run(tc.token+"/"+tc.header, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
			request.Header.Set("Authorization", tc.header)
			response := httptest.NewRecorder()
			NewServer(Config{AppToken: tc.token}).ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("status = %d, want %d", response.Code, tc.status)
			}
		})
	}
}

// TestAuthReadsAndDefaultWrites preserves read results and disabled write flags.
func TestAuthReadsAndDefaultWrites(t *testing.T) {
	service := docker.NewService(&dockerReader{}, time.Now)
	service.Collect(context.Background())
	store := operation.NewStore(time.Now)
	op, _ := store.Create("docker.restart", "docker:existing")
	config := Config{
		AppToken: testAppToken,
		Docker:   service, Operations: store,
		ContainerExists: func(string) bool { return true },
	}
	for _, requestPath := range []string{
		"/api/v1/capabilities", "/api/v1/system", "/api/v1/storage",
		"/api/v1/docker", "/api/v1/vms", "/api/v1/operations/" + op.ID,
	} {
		t.Run(requestPath, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, requestPath, nil)
			request.Header.Set("Authorization", "Bearer "+testAppToken)
			response := httptest.NewRecorder()
			NewServer(config).ServeHTTP(response, request)
			if response.Code != 200 || !json.Valid(response.Body.Bytes()) || strings.Contains(response.Body.String(), testAppToken) {
				t.Fatalf("read = %d %s", response.Code, response.Body.String())
			}
			if requestPath == "/api/v1/capabilities" {
				var caps capability.Set
				if err := json.Unmarshal(response.Body.Bytes(), &caps); err != nil {
					t.Fatal(err)
				}
				if !caps.Docker || caps.DockerActions != (capability.DockerActions{}) ||
					caps.VMActions != (capability.VMActions{}) || caps.Array.Start || caps.Array.Stop || caps.Parity.Start || caps.Parity.Cancel {
					t.Fatalf("authentication enabled writes: %+v", caps)
				}
			}
		})
	}
	for _, action := range []string{"start", "stop", "restart"} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/docker/plex/"+action, nil)
		request.Header.Set("Authorization", "Bearer "+testAppToken)
		response := httptest.NewRecorder()
		NewServer(config).ServeHTTP(response, request)
		if response.Code != 409 || !strings.Contains(response.Body.String(), `"code":"CAPABILITY_UNAVAILABLE"`) {
			t.Fatalf("default write = %d %s", response.Code, response.Body.String())
		}
	}
	next, err := store.Create("docker.restart", "docker:plex")
	if err != nil || next.ID != "op_2" {
		t.Fatalf("denied write changed store: %+v %v", next, err)
	}
}

// TestAuthSSEPassesThrough preserves streaming headers and subscription cleanup.
func TestAuthSSEPassesThrough(t *testing.T) {
	store := operation.NewStore(time.Now)
	service := system.NewService(systemReader{}, time.Now)
	handler := NewServer(Config{AppToken: testAppToken, System: service, Operations: store})
	writer := newEventWriter()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	request.Header.Set("Authorization", "Bearer "+testAppToken)
	go func() { handler.ServeHTTP(writer, request); close(done) }()
	defer func() { cancel(); awaitEventsExit(t, done) }()
	if frame := awaitFrame(t, writer); !strings.HasPrefix(frame, "event: system.metrics\n") {
		t.Fatalf("initial frame = %q", frame)
	}
	if writer.header.Get("Content-Type") != "text/event-stream" ||
		writer.header.Get("Cache-Control") != "no-cache, no-transform" ||
		writer.header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("stream headers = %v", writer.header)
	}
	store.Create("docker.restart", "docker:plex")
	if frame := awaitFrame(t, writer); !strings.HasPrefix(frame, "event: operation.updated\n") {
		t.Fatalf("operation frame = %q", frame)
	}
	cancel()
	awaitEventsExit(t, done)
	if subscriberCount(store) != 0 || subscriberCount(service) != 0 {
		t.Fatal("authenticated stream leaked subscriptions")
	}
}

// TestAuthAcceptedRouting preserves unknown routes, methods and canonical redirects.
func TestAuthAcceptedRouting(t *testing.T) {
	handler := NewServer(Config{AppToken: testAppToken})
	for _, tc := range []struct {
		method, path, location string
		status                 int
	}{
		{"GET", "/healthz", "", 204},
		{"GET", "/api/v1/unknown", "", 404},
		{"OPTIONS", "/api/v1/system", "", 404},
		{"POST", "/api/v1/capabilities", "", 404},
		{"HEAD", "/api/v1/capabilities", "", 200},
		{"GET", "//api/v1/system", "/api/v1/system", 301},
		{"GET", "/api/./v1/system", "/api/v1/system", 301},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.path, nil)
			request.Header.Set("Authorization", "Bearer "+testAppToken)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			statusMatches := response.Code == tc.status
			if tc.location != "" {
				// Go 1.26 changed ServeMux canonical redirects from 301 to 307.
				statusMatches = response.Code == http.StatusMovedPermanently || response.Code == http.StatusTemporaryRedirect
			}
			if !statusMatches || response.Header().Get("Location") != tc.location {
				t.Fatalf("accepted routing = %d %v", response.Code, response.Header())
			}
			if strings.Contains(response.Body.String(), testAppToken) || strings.Contains(response.Header().Get("Location"), testAppToken) {
				t.Fatal("accepted response disclosed credential")
			}
		})
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != 204 {
		t.Fatalf("public health = %d", response.Code)
	}
}

// TestAuthFailureDoesNotReadOrMutateStore checks queries, writes and subscriptions.
func TestAuthFailureDoesNotReadOrMutateStore(t *testing.T) {
	calls := 0
	store := operation.NewStore(func() time.Time {
		calls++
		return time.Now()
	})
	config := Config{
		AppToken: testAppToken, Operations: store,
		Capabilities: capability.Set{Docker: true, DockerActions: capability.DockerActions{Restart: true}},
		ContainerExists: func(string) bool {
			t.Error("rejected authentication reached resource lookup")
			return true
		},
	}
	for _, credential := range []string{"", "Bearer wrong"} {
		for _, tc := range []struct{ method, path string }{
			{"GET", "/api/v1/operations/op_1"},
			{"POST", "/api/v1/docker/plex/restart"},
			{"GET", "/api/v1/events"},
		} {
			request := httptest.NewRequest(tc.method, tc.path, nil)
			request.Header.Set("Authorization", credential)
			response := httptest.NewRecorder()
			NewServer(config).ServeHTTP(response, request)
			assertUnauthorized(t, response)
		}
	}
	if calls != 0 || subscriberCount(store) != 0 {
		t.Fatalf("rejection accessed store: clock calls=%d subscriptions=%d", calls, subscriberCount(store))
	}
	next, err := store.Create("docker.restart", "docker:plex")
	if err != nil || next.ID != "op_1" {
		t.Fatalf("rejection changed store: %+v %v", next, err)
	}
}
