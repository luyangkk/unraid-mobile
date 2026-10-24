package main

import "testing"

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
