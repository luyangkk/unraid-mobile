package spike

import (
	"errors"
	"testing"
)

func TestInspectReportsEveryRequiredHostSurface(t *testing.T) {
	t.Parallel()

	missing := errors.New("not found")
	report := Inspect(func(path string) error {
		if path == DockerSocket {
			return missing
		}
		return nil
	})

	if report.AllAvailable {
		t.Fatal("AllAvailable = true, want false when Docker socket is missing")
	}
	if len(report.Checks) != len(RequiredSurfaces) {
		t.Fatalf("checks = %d, want %d", len(report.Checks), len(RequiredSurfaces))
	}

	for _, check := range report.Checks {
		if check.Path == DockerSocket {
			if check.Available || check.Error == "" {
				t.Fatalf("docker check = %#v, want unavailable with error", check)
			}
			continue
		}
		if !check.Available || check.Error != "" {
			t.Fatalf("check = %#v, want available", check)
		}
	}
}
