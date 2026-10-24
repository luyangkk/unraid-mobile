package operation

import (
	"math"
	"testing"
	"time"
)

// TestStoreProgress validates running-only finite progress and copy isolation.
func TestStoreProgress(t *testing.T) {
	store := NewStore(time.Now)
	updater, ok := any(store).(interface {
		UpdateProgress(string, *float64) (Operation, error)
	})
	if !ok {
		t.Fatal("Store does not support progress updates")
	}
	op, _ := store.Create("docker.restart", "docker:plex")
	progress := 42.5
	if _, err := updater.UpdateProgress(op.ID, &progress); err != ErrInvalidTransition {
		t.Fatalf("pending progress error = %v", err)
	}
	if _, err := updater.UpdateProgress("missing", nil); err != ErrOperationNotFound {
		t.Fatalf("missing progress error = %v", err)
	}
	store.Update(op.ID, Running, nil)
	for _, value := range []float64{0, 42.5, 100} {
		result, err := updater.UpdateProgress(op.ID, &value)
		if err != nil || result.Progress == nil || *result.Progress != value {
			t.Fatalf("valid progress %v: %+v, %v", value, result, err)
		}
	}
	for _, value := range []float64{-1, 101, math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := updater.UpdateProgress(op.ID, &value); err == nil || err == ErrInvalidTransition {
			t.Fatalf("invalid progress %v: %v", value, err)
		}
		got, _ := store.Get(op.ID)
		if got.Progress == nil || *got.Progress != 100 {
			t.Fatal("invalid progress changed snapshot")
		}
	}
	result, err := updater.UpdateProgress(op.ID, &progress)
	if err != nil {
		t.Fatal(err)
	}
	progress = 80
	*result.Progress = 99
	got, _ := store.Get(op.ID)
	if *got.Progress != 42.5 {
		t.Fatalf("progress alias: %v", *got.Progress)
	}
	*got.Progress = 1
	again, _ := store.Get(op.ID)
	if *again.Progress != 42.5 {
		t.Fatal("Get progress alias")
	}
	result, err = updater.UpdateProgress(op.ID, nil)
	if err != nil || result.Progress != nil {
		t.Fatalf("unknown progress: %+v, %v", result, err)
	}
	store.Update(op.ID, Success, nil)
	if _, err := updater.UpdateProgress(op.ID, &progress); err != ErrInvalidTransition {
		t.Fatalf("terminal progress error = %v", err)
	}
}

// TestStoreErrorOnlyOnFailed keeps errors out of running and successful snapshots.
func TestStoreErrorOnlyOnFailed(t *testing.T) {
	store := NewStore(time.Now)
	op, _ := store.Create("docker.restart", "docker:plex")
	operationError := &Error{Code: "FAILED"}
	running, _ := store.Update(op.ID, Running, operationError)
	if running.Error != nil {
		t.Fatal("running operation retained a failure")
	}
	completed, _ := store.Update(op.ID, Success, operationError)
	if completed.Error != nil {
		t.Fatal("successful operation retained a failure")
	}
}
