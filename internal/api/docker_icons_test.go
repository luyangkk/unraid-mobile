package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
)

type iconReader struct{ calls int }

func (r *iconReader) Read(context.Context) (docker.Raw, error) {
	r.calls++
	return docker.Raw{Containers: []docker.RawContainer{{ID: "one", Name: "Plex", IconPNG: []byte("synthetic verified png")}}}, nil
}
func TestDockerIconIsAuthenticatedAndOnlyServesTheLatestCache(t *testing.T) {
	reader := &iconReader{}
	service := docker.NewService(reader, time.Now)
	snapshot := service.Collect(context.Background())
	version := snapshot.Containers[0].IconVersion
	handler := NewServer(Config{Docker: service, AppToken: testAppToken})
	url := "/api/v1/docker/one/icon?v=" + version
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest("GET", url, nil))
	assertUnauthorized(t, unauthorized)
	for _, target := range []string{url, "/api/v1/docker/missing/icon?v=" + version, "/api/v1/docker/one/icon?v=old", "/api/v1/docker/one/icon"} {
		req := httptest.NewRequest("GET", target, nil)
		req.Header.Set("Authorization", "Bearer "+testAppToken)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		want := http.StatusNotFound
		if target == url {
			want = http.StatusOK
		}
		if rr.Code != want || rr.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %v", target, rr.Code, rr.Header())
		}
		if target == url && (rr.Body.String() != "synthetic verified png" || rr.Header().Get("Content-Type") != "image/png" || rr.Header().Get("X-Content-Type-Options") != "nosniff") {
			t.Fatal("unsafe image response")
		}
	}
	if reader.calls != 1 {
		t.Fatal("icon request sampled the host")
	}
}
