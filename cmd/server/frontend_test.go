package main

import (
	"bufio"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/api"
	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
)

const frontendPage = "<!doctype html><title>Unraid Mobile</title>"
const frontendManifest = `{"name":"Unraid Mobile","start_url":"/","scope":"/","display":"standalone"}`
const frontendWorker = "self.addEventListener('fetch', () => {})"

// frontendTestFiles provides synthetic assets without touching embedded output.
func frontendTestFiles() fs.FS {
	return fstest.MapFS{
		"index.html":                 {Data: []byte(frontendPage)},
		"assets/app.js":              {Data: []byte("console.log('asset')")},
		"assets/app.css":             {Data: []byte("body{color:white}")},
		"assets/license":             {Data: []byte("asset license")},
		"manifest.webmanifest":       {Data: []byte(frontendManifest)},
		"sw.js":                      {Data: []byte(frontendWorker)},
		"icons/icon-192.png":         {Data: []byte("\x89PNG\r\n\x1a\nsynthetic icon")},
		"icons/icon-512.png":         {Data: []byte("\x89PNG\r\n\x1a\nsynthetic icon")},
		"icons/maskable-512.png":     {Data: []byte("\x89PNG\r\n\x1a\nsynthetic icon")},
		"icons/apple-touch-icon.png": {Data: []byte("\x89PNG\r\n\x1a\nsynthetic icon")},
		"icons/favicon.png":          {Data: []byte("\x89PNG\r\n\x1a\nsynthetic icon")},
		"robots.txt":                 {Data: []byte("User-agent: *")},
		"version":                    {Data: []byte("development")},
		"directory/file.txt":         {Data: []byte("not a directory listing")},
		"with-index/index.html":      {Data: []byte("directory index")},
		".hidden":                    {Data: []byte("private")},
		"special":                    {Mode: fs.ModeNamedPipe},
	}
}

// TestFrontendPWAAssets catches private assets, unstable MIME types and cached workers.
func TestFrontendPWAAssets(t *testing.T) {
	for _, mode := range []struct {
		name, token string
	}{{"LAN", ""}, {"authenticated", "pwa-test-credential"}} {
		t.Run(mode.name, func(t *testing.T) {
			t.Setenv("APP_TOKEN", mode.token)
			handler := newFrontendHandler(api.NewServer(apiConfigFromEnvironment()), frontendTestFiles())
			for _, tc := range []struct {
				path, contentType, cacheControl, body string
			}{
				{"/manifest.webmanifest", "application/manifest+json", "", frontendManifest},
				{"/sw.js", "text/javascript; charset=utf-8", "no-cache", frontendWorker},
				{"/sw.js?version=next", "text/javascript; charset=utf-8", "no-cache", frontendWorker},
				{"/icons/icon-192.png", "image/png", "", "\x89PNG\r\n\x1a\nsynthetic icon"},
				{"/icons/icon-512.png", "image/png", "", "\x89PNG\r\n\x1a\nsynthetic icon"},
				{"/icons/maskable-512.png", "image/png", "", "\x89PNG\r\n\x1a\nsynthetic icon"},
				{"/icons/apple-touch-icon.png", "image/png", "", "\x89PNG\r\n\x1a\nsynthetic icon"},
				{"/icons/favicon.png", "image/png", "", "\x89PNG\r\n\x1a\nsynthetic icon"},
			} {
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					t.Run(method+" "+tc.path, func(t *testing.T) {
						response := httptest.NewRecorder()
						handler.ServeHTTP(response, httptest.NewRequest(method, tc.path, nil))
						if response.Code != 200 {
							t.Fatalf("public PWA asset = %d, want 200", response.Code)
						}
						if got := response.Header().Get("Content-Type"); got != tc.contentType {
							t.Errorf("Content-Type = %q, want %q", got, tc.contentType)
						}
						if got := response.Header().Get("Cache-Control"); got != tc.cacheControl {
							t.Errorf("Cache-Control = %q, want %q", got, tc.cacheControl)
						}
						if response.Header().Get("Location") != "" {
							t.Errorf("unexpected redirect: %v", response.Header())
						}
						wantBody := tc.body
						if method == http.MethodHead {
							wantBody = ""
						}
						if response.Body.String() != wantBody {
							t.Errorf("body = %q, want %q", response.Body.String(), wantBody)
						}
						if response.Header().Get("Content-Length") != strconv.Itoa(len(tc.body)) {
							t.Errorf("Content-Length = %q, want %d", response.Header().Get("Content-Length"), len(tc.body))
						}
					})
				}
			}
		})
	}
}

// TestFrontendPWABoundaries rejects missing, malformed and nonread PWA requests in both modes.
func TestFrontendPWABoundaries(t *testing.T) {
	for _, token := range []string{"", "pwa-test-credential"} {
		t.Setenv("APP_TOKEN", token)
		handler := newFrontendHandler(api.NewServer(apiConfigFromEnvironment()), frontendTestFiles())
		for _, requestPath := range []string{
			"/missing.webmanifest", "/missing-sw.js", "/icons/missing.png",
			"/icons", "/icons/", "/icons/icon-192.png/child",
			"//sw.js", "/%73w.js", "/icons/%69con-192.png", "/icons/../sw.js",
			"/manifest%2ewebmanifest", "/sw.js/", "/sw.js/..",
		} {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(method, requestPath, nil))
				if response.Code != 404 || response.Header().Get("Location") != "" ||
					strings.Contains(response.Body.String(), frontendPage) {
					t.Fatalf("%s %s = %d %v %q", method, requestPath, response.Code, response.Header(), response.Body.String())
				}
				if method == http.MethodHead && response.Body.Len() != 0 {
					t.Fatal("HEAD rejection returned a body")
				}
			}
		}
		for _, requestPath := range []string{"/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, requestPath, nil))
			if response.Code != 405 || response.Header().Get("Allow") != "GET, HEAD" ||
				response.Header().Get("Cache-Control") != "" {
				t.Fatalf("nonread PWA request = %d %v", response.Code, response.Header())
			}
		}
	}
}

// TestFrontendRoutes catches broad fallback, directory exposure and lost HEAD semantics.
func TestFrontendRoutes(t *testing.T) {
	handler := newFrontendHandler(api.NewServer(api.Config{}), frontendTestFiles())
	for _, tc := range []struct {
		method, path, body, contentType string
		status                          int
	}{
		{"GET", "/", frontendPage, "text/html", 200},
		{"GET", "/docker", frontendPage, "text/html", 200},
		{"GET", "/vm", frontendPage, "text/html", 200},
		{"GET", "/storage", frontendPage, "text/html", 200},
		{"GET", "/unknown", frontendPage, "text/html", 200},
		{"GET", "/unknown/nested?view=summary", frontendPage, "text/html", 200},
		{"GET", "/assets-other", frontendPage, "text/html", 200},
		{"GET", "/index.html", frontendPage, "text/html", 200},
		{"GET", "/with-index/index.html", "directory index", "text/html", 200},
		{"HEAD", "/", "", "text/html", 200},
		{"HEAD", "/docker", "", "text/html", 200},
		{"HEAD", "/unknown/nested", "", "text/html", 200},
		{"GET", "/assets/app.js", "console.log('asset')", "javascript", 200},
		{"HEAD", "/assets/app.js", "", "javascript", 200},
		{"GET", "/assets/app.css", "body{color:white}", "text/css", 200},
		{"GET", "/assets/license", "asset license", "text/plain", 200},
		{"GET", "/robots.txt", "User-agent: *", "text/plain", 200},
		{"GET", "/version", "development", "text/plain", 200},
		{"GET", "/missing.js", "", "text/plain", 404},
		{"GET", "/missing.css", "", "text/plain", 404},
		{"GET", "/missing.ico", "", "text/plain", 404},
		{"GET", "/missing.js/child", "", "text/plain", 404},
		{"GET", "/assets", "", "text/plain", 404},
		{"GET", "/assets/", "", "text/plain", 404},
		{"GET", "/assets/missing", "", "text/plain", 404},
		{"GET", "/assets/missing.js", "", "text/plain", 404},
		{"HEAD", "/assets/missing.js", "", "text/plain", 404},
		{"GET", "/directory", "", "text/plain", 404},
		{"GET", "/directory/", "", "text/plain", 404},
		{"GET", "/with-index", "", "text/plain", 404},
		{"GET", "/with-index/", "", "text/plain", 404},
		{"GET", "/special", "", "text/plain", 404},
		{"POST", "/docker", "", "text/plain", 405},
		{"PUT", "/unknown", "", "text/plain", 405},
		{"DELETE", "/", "", "text/plain", 405},
		{"OPTIONS", "/assets/app.js", "", "text/plain", 405},
		{"GET", "/healthz", "", "", 204},
		{"HEAD", "/healthz", "", "", 204},
		{"GET", "/api/v1/unknown", "", "application/json", 404},
		{"POST", "/api/v1/unknown", "", "application/json", 404},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
			if response.Code != tc.status {
				t.Fatalf("status = %d, want %d; body = %q", response.Code, tc.status, response.Body.String())
			}
			if response.Header().Get("Location") != "" {
				t.Fatalf("unexpected redirect: %v", response.Header())
			}
			if !strings.Contains(response.Header().Get("Content-Type"), tc.contentType) {
				t.Fatalf("content type = %q, want %q", response.Header().Get("Content-Type"), tc.contentType)
			}
			if tc.method == http.MethodHead || tc.status == 200 || tc.status == 204 {
				if response.Body.String() != tc.body {
					t.Fatalf("body = %q, want %q", response.Body.String(), tc.body)
				}
			} else if strings.Contains(response.Body.String(), frontendPage) {
				t.Fatal("error returned the frontend page")
			}
			if tc.method == http.MethodHead && tc.status == 200 {
				wantLength := len(frontendPage)
				if tc.path == "/assets/app.js" {
					wantLength = len("console.log('asset')")
				}
				if response.Header().Get("Content-Length") != strconv.Itoa(wantLength) {
					t.Fatalf("HEAD length = %q, want %d", response.Header().Get("Content-Length"), wantLength)
				}
			}
			if tc.status == 405 && response.Header().Get("Allow") != "GET, HEAD" {
				t.Fatalf("Allow = %q", response.Header().Get("Allow"))
			}
			if strings.HasPrefix(tc.path, "/api/") {
				var body struct {
					Error struct {
						Code string `json:"code"`
					} `json:"error"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error.Code != "ROUTE_NOT_FOUND" {
					t.Fatalf("API error = %q, %v", response.Body.String(), err)
				}
			}
		})
	}
}

// TestFrontendMissingIndex never lists the root or turns a broken build into HTML.
func TestFrontendMissingIndex(t *testing.T) {
	for _, files := range []fstest.MapFS{
		{"assets/app.js": {Data: []byte("asset")}},
		{"index.html/child": {Data: []byte("not an index file")}},
	} {
		handler := newFrontendHandler(api.NewServer(api.Config{}), files)
		for _, requestPath := range []string{"/", "/docker"} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
			if response.Code != 404 || response.Header().Get("Location") != "" ||
				strings.Contains(response.Body.String(), "<") {
				t.Fatalf("missing index = %d %v %q", response.Code, response.Header(), response.Body.String())
			}
		}
	}
}

// TestFrontendRejectsMalformedPaths catches normalization and encoded asset access.
func TestFrontendRejectsMalformedPaths(t *testing.T) {
	handler := newFrontendHandler(api.NewServer(api.Config{}), frontendTestFiles())
	for _, requestPath := range []string{
		"//docker", "/docker//child", "/docker/", "/docker/.", "/docker/..",
		"/./docker", "/../docker", "/directory/../assets/app.js",
		"/assets//app.js", "/assets/./app.js", "/%64ocker", "/docker%2fchild",
		"/docker%2Fchild", "/%2e/docker", "/%2e%2e/assets/app.js",
		"/assets/%61pp.js", "/assets%2fapp.js", "/docker%252fchild",
		"/docker%5cchild", "/docker\\child", "/docker%00", "/docker%20child",
		"/.hidden", "/.well-known/missing", "/%23docker",
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(method+" "+requestPath, func(t *testing.T) {
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(method, requestPath, nil))
				if response.Code != 404 || response.Header().Get("Location") != "" ||
					strings.Contains(response.Body.String(), frontendPage) {
					t.Fatalf("malformed route = %d %v %q", response.Code, response.Header(), response.Body.String())
				}
				if method == http.MethodHead && response.Body.Len() != 0 {
					t.Fatal("HEAD rejection returned a body")
				}
			})
		}
	}
}

// TestFrontendAppToken keeps client pages public and authenticates original API paths.
func TestFrontendAppToken(t *testing.T) {
	t.Setenv("APP_TOKEN", "frontend-test-credential")
	handler := newFrontendHandler(api.NewServer(apiConfigFromEnvironment()), frontendTestFiles())
	for _, requestPath := range []string{"/", "/docker", "/vm", "/storage", "/unknown", "/assets/app.js", "/healthz"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
		want := 200
		if requestPath == "/healthz" {
			want = 204
		}
		if response.Code != want {
			t.Fatalf("public %s = %d, want %d", requestPath, response.Code, want)
		}
	}
	for _, requestPath := range []string{"//docker", "/assets/%61pp.js", "/directory/../assets/app.js"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
		if response.Code != 404 || response.Header().Get("Location") != "" ||
			strings.Contains(response.Body.String(), frontendPage) {
			t.Fatalf("malformed public path = %d %v %q", response.Code, response.Header(), response.Body.String())
		}
	}
	for _, requestPath := range []string{
		"/api", "/api/", "/api/v1/capabilities", "/api/v1/unknown",
		"//api/v1/system", "/api//v1/system", "/api/./v1/system",
		"/api/../healthz", "/api/%2e%2e/healthz", "/%61pi/v1/system",
		"/api%2fv1/system", "/%2fapi/v1/events",
		"/assets/../api/v1/capabilities", "/assets/%2e%2e/api/v1/capabilities",
		"/assets%2f..%2fapi%2fv1/capabilities",
		"/icons/../api/v1/capabilities", "/sw.js/../api/v1/events",
		"/manifest.webmanifest/../api/v1/capabilities", "/icons/%2e%2e/api/v1/system",
		"/api/v1/operations%2fop_1",
	} {
		t.Run(requestPath, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestPath, nil))
			if response.Code != 401 || response.Header().Get("Location") != "" ||
				response.Body.String() != "{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"Authentication required\",\"retryable\":false}}\n" {
				t.Fatalf("API auth = %d %v %q", response.Code, response.Header(), response.Body.String())
			}
		})
	}
	for _, tc := range []struct {
		path string
		code int
	}{{"/api/v1/capabilities", 200}, {"/api/v1/unknown", 404}, {"/api/v1/operations%2fop_1", 404}} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, tc.path, nil)
		request.Header.Set("Authorization", "Bearer frontend-test-credential")
		handler.ServeHTTP(response, request)
		if response.Code != tc.code || !json.Valid(response.Body.Bytes()) ||
			response.Header().Get("Location") != "" || strings.Contains(response.Body.String(), frontendPage) {
			t.Fatalf("authenticated API = %d %v %q", response.Code, response.Header(), response.Body.String())
		}
	}
}

// TestFrontendEvents preserves streaming through the production frontend handler.
func TestFrontendEvents(t *testing.T) {
	store := operation.NewStore(time.Now)
	handler := newFrontendHandler(api.NewServer(api.Config{
		AppToken: "stream-test-credential", Operations: store,
	}), frontendTestFiles())
	server := httptest.NewServer(handler)
	defer server.Close()
	request, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer stream-test-credential")
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "text/event-stream" ||
		response.Header.Get("Cache-Control") != "no-cache, no-transform" ||
		response.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("SSE headers = %d %v", response.StatusCode, response.Header)
	}
	scanner := bufio.NewScanner(response.Body)
	if !scanner.Scan() || scanner.Text() != "event: system.metrics" {
		t.Fatalf("initial SSE frame = %q, %v", scanner.Text(), scanner.Err())
	}
	op, err := store.Create("docker.restart", "docker:frontend-test")
	if err != nil {
		t.Fatal(err)
	}
	for scanner.Scan() {
		if scanner.Text() != "event: operation.updated" {
			continue
		}
		if !scanner.Scan() {
			t.Fatalf("operation data missing: %v", scanner.Err())
		}
		var got operation.Operation
		if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &got); err != nil ||
			got.ID != op.ID || got.State != operation.Pending {
			t.Fatalf("operation SSE = %+v, %v", got, err)
		}
		return
	}
	t.Fatalf("operation SSE frame missing: %v", scanner.Err())
}
