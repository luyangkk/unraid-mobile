package spike

import (
	"errors"
	"testing"
)

// TestInspectReportsEveryRequiredHostSurface checks required-only preflight.
func TestInspectReportsEveryRequiredHostSurface(t *testing.T) {
	t.Parallel()

	missing := errors.New("not found")
	report := Inspect(func(path string) error {
		if path == HostProcStat {
			return missing
		}
		return nil
	})

	if report.ExitCode() != 2 {
		t.Fatal("missing required CPU surface must fail")
	}
	if len(report.Checks) != len(RequiredSurfaces) {
		t.Fatalf("checks = %d, want %d", len(report.Checks), len(RequiredSurfaces))
	}

	for _, check := range report.Checks {
		if check.Path == DockerSocket || check.Path == LibvirtSocket || check.Path == HostSysThermal {
			t.Fatalf("optional surface treated as required: %s", check.Path)
		}
		if check.Path == HostProcStat {
			if check.Available || check.Error == "" {
				t.Fatalf("uptime check = %#v, want unavailable with error", check)
			}
			continue
		}
		if !check.Available || check.Error != "" {
			t.Fatalf("check = %#v, want available", check)
		}
	}
}
