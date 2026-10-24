package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/spike"
)

// commandConfig uses synthetic mounts and production deadlines so race instrumentation can read fixtures.
func commandConfig(t *testing.T) spike.Config {
	t.Helper()
	return spike.Config{HostFS: os.DirFS("../../testdata/host"), RuntimeFS: fstest.MapFS{},
		SampleInterval: time.Millisecond}
}

// TestExecuteReportsRequiredSuccess checks the standalone CLI JSON and successful exit.
func TestExecuteReportsRequiredSuccess(t *testing.T) {
	var out bytes.Buffer
	code := execute(context.Background(), &out, commandConfig(t))
	var r spike.Report
	if err := json.Unmarshal(out.Bytes(), &r); err != nil {
		t.Fatal(err)
	}
	if code != 0 || !r.ReadOnly || r.WriteVerified || r.Docker.Status != "skipped" || r.VM.Status != "skipped" {
		t.Fatalf("code %d report %+v", code, r)
	}
}

// TestExecuteReportsCapabilityFailure checks exit 2 and absence of local path error content.
func TestExecuteReportsCapabilityFailure(t *testing.T) {
	c := commandConfig(t)
	c.HostFS = fstest.MapFS{}
	var out bytes.Buffer
	if code := execute(context.Background(), &out, c); code != 2 {
		t.Fatalf("code = %d, want 2", code)
	}
	if strings.Contains(out.String(), "no such file") || strings.Contains(out.String(), "PathError") {
		t.Fatalf("raw error leaked: %s", out.String())
	}
}

type failedOutput struct{}

// Write models an unavailable report stream.
func (failedOutput) Write([]byte) (int, error) { return 0, errors.New("private output error") }

// TestExecuteEncodingFailure checks exit 1 for output failures.
func TestExecuteEncodingFailure(t *testing.T) {
	if code := execute(context.Background(), failedOutput{}, commandConfig(t)); code != 1 {
		t.Fatalf("code = %d, want 1", code)
	}
}

// TestExecuteCancelledStillEmitsReport checks cancellation is a capability failure, not an encoding error.
func TestExecuteCancelledStillEmitsReport(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var out bytes.Buffer
	if code := execute(ctx, &out, commandConfig(t)); code != 2 || !json.Valid(out.Bytes()) {
		t.Fatalf("cancel code %d output %s", code, out.String())
	}
}

var _ io.Writer = failedOutput{}
var _ fs.FS = fstest.MapFS{}
