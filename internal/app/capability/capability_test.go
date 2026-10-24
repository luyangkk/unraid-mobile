package capability

import "testing"

func TestVMReadDoesNotAllowWrites(t *testing.T) {
	set := Set{VM: true}
	for _, action := range []string{"start", "stop", "force-stop"} {
		if set.Allows("vm", action) {
			t.Fatalf("read capability enabled %s", action)
		}
	}
}

func TestVMActionFlagsRequireReadAvailability(t *testing.T) {
	set := Set{VMActions: VMActions{Start: true, Stop: true, ForceStop: true}}
	for _, available := range []bool{false, true} {
		set.VM = available
		for _, action := range []string{"start", "stop", "force-stop"} {
			if set.Allows("vm", action) != available {
				t.Fatalf("read=%v action=%s", available, action)
			}
		}
		if set.Allows("vm", "destroy") {
			t.Fatal("accepted non-public action")
		}
	}
}

// TestDockerReadDoesNotAllowWrites separates read availability from action permissions.
func TestDockerReadDoesNotAllowWrites(t *testing.T) {
	set := Set{Docker: true}
	for _, action := range []string{"start", "stop", "restart"} {
		if set.Allows("docker", action) {
			t.Fatalf("read capability enabled %s", action)
		}
	}
}

func TestSetAllows(t *testing.T) {
	t.Parallel()

	set := Set{
		Docker:        true,
		DockerActions: DockerActions{Restart: true},
		Array:         Array{Read: true, Start: true, Stop: false},
		Parity:        Parity{Read: true, Start: false, Cancel: false},
	}

	cases := []struct {
		name     string
		resource string
		action   string
		want     bool
	}{
		{name: "allows an available docker action", resource: "docker", action: "restart", want: true},
		{name: "rejects a disabled docker action", resource: "docker", action: "stop", want: false},
		{name: "rejects an unavailable array action", resource: "array", action: "stop", want: false},
		{name: "rejects an unknown action", resource: "parity", action: "pause", want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := set.Allows(tc.resource, tc.action); got != tc.want {
				t.Fatalf("Allows(%q, %q) = %v, want %v", tc.resource, tc.action, got, tc.want)
			}
		})
	}
}
