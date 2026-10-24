package operation

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestStoreCreatesAndAdvancesOperation(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 9, 21, 1, 0, 0, 0, time.UTC)
	store := NewStore(func() time.Time { return now })

	op, err := store.Create("docker.restart", "docker:plex")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if op.State != Pending {
		t.Fatalf("initial State = %q, want %q", op.State, Pending)
	}
	if !op.StartedAt.Equal(now) {
		t.Fatalf("StartedAt = %v, want %v", op.StartedAt, now)
	}

	if _, err := store.Update(op.ID, Running, nil); err != nil {
		t.Fatalf("Update(running) error = %v", err)
	}
	completed, err := store.Update(op.ID, Success, nil)
	if err != nil {
		t.Fatalf("Update(success) error = %v", err)
	}
	if completed.EndedAt == nil || !completed.EndedAt.Equal(now) {
		t.Fatalf("EndedAt = %v, want %v", completed.EndedAt, now)
	}
}

func TestStoreRejectsConflictingOrInvalidTransitions(t *testing.T) {
	t.Parallel()

	store := NewStore(time.Now)
	first, err := store.Create("docker.restart", "docker:plex")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := store.Create("docker.stop", "docker:plex"); err != ErrResourceBusy {
		t.Fatalf("second Create() error = %v, want %v", err, ErrResourceBusy)
	}
	if _, err := store.Update(first.ID, Success, nil); err != ErrInvalidTransition {
		t.Fatalf("Update(pending -> success) error = %v, want %v", err, ErrInvalidTransition)
	}
}

// TestStoreTransitionMatrix verifies every valid and invalid lifecycle edge.
func TestStoreTransitionMatrix(t *testing.T) {
	for _, from := range []State{Pending, Running, Success, Failed, Cancelled} {
		for _, to := range []State{Pending, Running, Success, Failed, Cancelled, "unknown"} {
			t.Run(string(from)+"/"+string(to), func(t *testing.T) {
				store := NewStore(time.Now)
				op, _ := store.Create("docker.restart", "docker:plex")
				if from != Pending {
					store.Update(op.ID, Running, nil)
				}
				if from != Pending && from != Running {
					store.Update(op.ID, from, nil)
				}
				wantValid := from == Pending && to == Running ||
					from == Running && (to == Success || to == Failed || to == Cancelled)
				updated, err := store.Update(op.ID, to, nil)
				if wantValid {
					if err != nil || updated.State != to {
						t.Fatalf("valid edge: %+v, %v", updated, err)
					}
					if to != Running && updated.EndedAt == nil {
						t.Fatal("terminal state lacks endedAt")
					}
				} else {
					if err != ErrInvalidTransition {
						t.Fatalf("invalid edge error = %v", err)
					}
					got, _ := store.Get(op.ID)
					if got.State != from {
						t.Fatalf("rejected transition changed state to %s", got.State)
					}
				}
			})
		}
	}
}

// TestStoreTerminalReleasesResource checks mutual exclusion in both active states.
func TestStoreTerminalReleasesResource(t *testing.T) {
	for _, terminal := range []State{Success, Failed, Cancelled} {
		t.Run(string(terminal), func(t *testing.T) {
			store := NewStore(time.Now)
			op, _ := store.Create("docker.restart", "docker:plex")
			for _, state := range []State{Pending, Running} {
				if state == Running {
					store.Update(op.ID, Running, nil)
				}
				if _, err := store.Create("docker.stop", op.Resource); err != ErrResourceBusy {
					t.Fatalf("%s conflict = %v", state, err)
				}
			}
			store.Update(op.ID, terminal, nil)
			if _, err := store.Create("docker.stop", op.Resource); err != nil {
				t.Fatalf("terminal state kept resource locked: %v", err)
			}
		})
	}
}

// TestStoreCopiesInputAndOutputPointers prevents callers from corrupting snapshots.
func TestStoreCopiesInputAndOutputPointers(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	store := NewStore(func() time.Time { return at })
	op, _ := store.Create("docker.restart", "docker:plex")
	store.Update(op.ID, Running, nil)
	operationError := &Error{Code: "EXECUTION_FAILED", Message: "Failed", Details: "detail", Retryable: true}
	failed, err := store.Update(op.ID, Failed, operationError)
	if err != nil {
		t.Fatal(err)
	}
	operationError.Code = "input mutated"
	failed.Error.Message = "output mutated"
	*failed.EndedAt = time.Time{}
	got, ok := store.Get(op.ID)
	if !ok || got.Error.Code != "EXECUTION_FAILED" || got.Error.Message != "Failed" || !got.EndedAt.Equal(at) {
		t.Fatalf("input/output alias: %+v", got)
	}
	got.Error.Details = "getter mutated"
	*got.EndedAt = time.Time{}
	again, _ := store.Get(op.ID)
	if again.Error.Details != "detail" || !again.EndedAt.Equal(at) {
		t.Fatalf("Get alias: %+v", again)
	}
}

// TestStoreConcurrentResources checks distinct resources and contested creation.
func TestStoreConcurrentResources(t *testing.T) {
	store := NewStore(time.Now)
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			op, err := store.Create("docker.restart", fmt.Sprintf("docker:%d", i))
			if err != nil {
				t.Error(err)
				return
			}
			for j := 0; j < 10; j++ {
				if got, ok := store.Get(op.ID); !ok || got.State != Pending {
					t.Errorf("concurrent Get = %+v, %v", got, ok)
				}
			}
			if _, err := store.Update(op.ID, Running, nil); err != nil {
				t.Error(err)
			}
			if _, err := store.Update(op.ID, Success, nil); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	results := make(chan error, 64)
	for i := 0; i < cap(results); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.Create("docker.restart", "docker:shared")
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		} else if err != ErrResourceBusy {
			t.Fatal(err)
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted %d operations on one resource", accepted)
	}
}

// TestStoreUnknownUpdate distinguishes missing IDs from invalid transitions.
func TestStoreUnknownUpdate(t *testing.T) {
	if _, err := NewStore(time.Now).Update("missing", Running, nil); err != ErrOperationNotFound {
		t.Fatalf("missing operation error = %v", err)
	}
}
