package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/capability"
	"github.com/unraid-mobile/unraid-mobile/internal/app/vm"
)

type vmReader struct {
	calls int
	fail  bool
}

func (r *vmReader) Read(context.Context) (vm.Snapshot, error) {
	r.calls++
	if r.fail {
		return vm.Snapshot{}, errors.New("libvirt unavailable")
	}
	return vm.Snapshot{Domains: []vm.Domain{{ID: "uuid", Name: "Windows", State: "running"}}}, nil
}

func TestVMCacheAndCapabilities(t *testing.T) {
	for _, ready := range []bool{false, true} {
		r := &vmReader{}
		config := Config{Capabilities: capability.Set{VM: true}}
		if ready {
			config.VM = vm.NewService(r, time.Now)
			config.VM.Collect(context.Background())
		}
		handler := NewServer(config)
		for i := 0; i < 2; i++ {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/vms", nil))
			var got vm.Snapshot
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || got.Available != ready || got.Timestamp.IsZero() || got.Domains == nil || got.Diagnostics == nil {
				t.Fatalf("VM response: %s", response.Body)
			}
			if !ready && got.Reason == "" {
				t.Fatal("missing reason")
			}
			if ready {
				var fields map[string]json.RawMessage
				json.Unmarshal(response.Body.Bytes(), &fields)
				var rows []map[string]json.RawMessage
				json.Unmarshal(fields["domains"], &rows)
				if len(fields) != 6 || len(rows) != 1 || len(rows[0]) != 7 {
					t.Fatalf("whitelist: %s", response.Body)
				}
			}
			capsResponse := httptest.NewRecorder()
			handler.ServeHTTP(capsResponse, httptest.NewRequest("GET", "/api/v1/capabilities", nil))
			var caps capability.Set
			json.Unmarshal(capsResponse.Body.Bytes(), &caps)
			if caps.VM != ready || caps.Allows("vm", "start") || caps.Allows("vm", "stop") || caps.Allows("vm", "force-stop") {
				t.Fatalf("caps: %+v", caps)
			}
		}
		if ready && r.calls != 1 {
			t.Fatal("HTTP triggered sampling")
		}
		if ready {
			r.fail = true
			config.VM.Collect(context.Background())
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/capabilities", nil))
			var caps capability.Set
			json.Unmarshal(response.Body.Bytes(), &caps)
			if caps.VM {
				t.Fatal("capability ignored collection failure")
			}
		}
		for _, action := range []string{"start", "stop", "force-stop"} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/vms/uuid/"+action, nil))
			if response.Code == 202 || strings.Contains(response.Body.String(), "operationId") {
				t.Fatal("VM write accepted without executor")
			}
		}
	}
}

type stalledVM struct{ entered, release chan struct{} }

func (r stalledVM) Read(context.Context) (vm.Snapshot, error) {
	close(r.entered)
	<-r.release
	return vm.Snapshot{}, nil
}

func TestVMCollectionDoesNotBlockHTTP(t *testing.T) {
	r := stalledVM{make(chan struct{}), make(chan struct{})}
	s := vm.NewService(r, time.Now)
	done := make(chan struct{})
	go func() { s.Collect(context.Background()); close(done) }()
	<-r.entered
	defer func() { close(r.release); <-done }()
	handler := NewServer(Config{VM: s})
	requestsDone := make(chan struct{})
	go func() {
		defer close(requestsDone)
		for _, path := range []string{"/healthz", "/api/v1/vms", "/api/v1/capabilities"} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
			want := 200
			if path == "/healthz" {
				want = 204
			}
			if response.Code != want {
				t.Errorf("%s status=%d", path, response.Code)
			}
		}
	}()
	select {
	case <-requestsDone:
	case <-time.After(time.Second):
		t.Error("HTTP blocked on libvirt")
	}
}
