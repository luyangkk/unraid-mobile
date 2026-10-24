package capability

import "testing"

func TestSetAllows(t *testing.T) {
	t.Parallel()

	set := Set{
		Docker: true,
		Array:  Array{Read: true, Start: true, Stop: false},
		Parity: Parity{Read: true, Start: false, Cancel: false},
	}

	cases := []struct {
		name     string
		resource string
		action   string
		want     bool
	}{
		{name: "allows an available docker action", resource: "docker", action: "restart", want: true},
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
