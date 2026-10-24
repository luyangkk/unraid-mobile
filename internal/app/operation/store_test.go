package operation

import (
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
