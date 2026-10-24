package operation

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

// finishOperation creates and completes one operation using the Store lifecycle.
func finishOperation(t *testing.T, store *Store, resource string, state State) Operation {
	t.Helper()
	op, err := store.Create("docker.restart", resource)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(op.ID, Running, nil); err != nil {
		t.Fatal(err)
	}
	result, err := store.Update(op.ID, state, nil)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

// TestStoreTerminalCount evicts oldest outcomes while retaining active operations.
func TestStoreTerminalCount(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	store := NewStore(func() time.Time { return at })
	pending, _ := store.Create("docker.start", "docker:pending")
	running, _ := store.Create("docker.start", "docker:running")
	store.Update(running.ID, Running, nil)
	var completed []Operation
	for i := 0; i < 105; i++ {
		completed = append(completed, finishOperation(t, store, fmt.Sprintf("docker:%d", i), []State{Success, Failed, Cancelled}[i%3]))
	}
	for i, op := range completed {
		_, exists := store.Get(op.ID)
		if exists != (i >= 5) {
			t.Fatalf("terminal %d exists = %v", i, exists)
		}
	}
	for _, op := range []Operation{pending, running} {
		if _, exists := store.Get(op.ID); !exists {
			t.Fatalf("active %s was evicted", op.ID)
		}
		if _, err := store.Create("docker.stop", op.Resource); err != ErrResourceBusy {
			t.Fatalf("active lock changed: %v", err)
		}
	}
}

// TestStoreRetentionUsesEndedAt orders outcomes by completion, not creation.
func TestStoreRetentionUsesEndedAt(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	store := NewStore(func() time.Time { return at })
	late, _ := store.Create("docker.restart", "docker:late")
	store.Update(late.ID, Running, nil)
	early := finishOperation(t, store, "docker:early", Failed)
	at = at.Add(time.Minute)
	store.Update(late.ID, Success, nil)
	for i := 0; i < 99; i++ {
		at = at.Add(time.Minute)
		finishOperation(t, store, fmt.Sprintf("docker:%d", i), Success)
	}
	if _, exists := store.Get(early.ID); exists {
		t.Fatal("earliest endedAt retained")
	}
	if _, exists := store.Get(late.ID); !exists {
		t.Fatal("earliest created operation evicted despite later endedAt")
	}
}

// TestStoreTerminalTTL uses fake time and preserves reused resource locks.
func TestStoreTerminalTTL(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	store := NewStore(func() time.Time { return at })
	old := finishOperation(t, store, "docker:plex", Success)
	reused, _ := store.Create("docker.restart", old.Resource)
	running, _ := store.Create("docker.restart", "docker:running")
	store.Update(running.ID, Running, nil)
	at = at.Add(23 * time.Hour)
	newer := finishOperation(t, store, "docker:new", Cancelled)
	if _, exists := store.Get(old.ID); !exists {
		t.Fatal("record expired before 24 hours")
	}
	at = at.Add(time.Hour + time.Nanosecond)
	if _, exists := store.Get(old.ID); exists {
		t.Fatal("record retained longer than 24 hours")
	}
	for _, op := range []Operation{reused, running, newer} {
		if _, exists := store.Get(op.ID); !exists {
			t.Fatalf("%s incorrectly expired", op.ID)
		}
	}
	if _, err := store.Create("docker.stop", reused.Resource); err != ErrResourceBusy {
		t.Fatalf("eviction released the replacement's lock: %v", err)
	}
	at = at.Add(24 * time.Hour)
	store.Create("docker.start", "docker:trigger")
	store.mu.Lock()
	_, retained := store.operations[newer.ID]
	store.mu.Unlock()
	if retained {
		t.Fatal("Create did not prune expired records")
	}
}

// TestStoreRestartDoesNotRecoverOrFailOperations checks independent Store instances.
func TestStoreRestartDoesNotRecoverOrFailOperations(t *testing.T) {
	first := NewStore(time.Now)
	op, _ := first.Create("docker.restart", "docker:plex")
	second := NewStore(time.Now)
	if _, exists := second.Get(op.ID); exists {
		t.Fatal("new Store recovered an old operation")
	}
	if _, err := second.Create("docker.restart", "docker:plex"); err != nil {
		t.Fatalf("old Store resource lock leaked: %v", err)
	}
	got, _ := first.Get(op.ID)
	if got.State != Pending {
		t.Fatal("restart changed the original operation")
	}
}

// TestStoreRunPrunesAndStops exercises background cleanup without waiting for TTL.
func TestStoreRunPrunesAndStops(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	sampled := make(chan struct{}, 1)
	store := NewStore(func() time.Time {
		select {
		case sampled <- struct{}{}:
		default:
		}
		return at
	})
	runner, ok := any(store).(interface{ Run(context.Context) })
	if !ok {
		t.Fatal("Store has no context-owned cleanup loop")
	}
	old := finishOperation(t, store, "docker:old", Success)
	<-sampled
	at = at.Add(25 * time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { runner.Run(ctx); close(done) }()
	select {
	case <-sampled:
	case <-time.After(time.Second):
		t.Fatal("background cleanup did not sample the injected clock")
	}
	store.mu.Lock()
	_, retained := store.operations[old.ID]
	store.mu.Unlock()
	if retained {
		t.Fatal("background cleanup retained expired operation")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup loop did not stop")
	}
}

type expiryTestTimer struct {
	delay   time.Duration
	fired   chan time.Time
	stopped chan struct{}
}

// awaitExpiryTimer waits for scheduling, without waiting for real time to pass.
func awaitExpiryTimer(t *testing.T, timers <-chan *expiryTestTimer) *expiryTestTimer {
	t.Helper()
	select {
	case timer := <-timers:
		return timer
	case <-time.After(time.Second):
		t.Fatal("expiry timer was not scheduled")
		return nil
	}
}

// TestStoreRunTimerLifecycle drives expiry, wake rescheduling and shutdown with
// a fake clock and fake timer delivery, never waiting for a real TTL.
func TestStoreRunTimerLifecycle(t *testing.T) {
	at := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	var clockMu sync.Mutex
	store := NewStore(func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return at
	})
	setTime := func(next time.Time) {
		clockMu.Lock()
		at = next
		clockMu.Unlock()
	}
	runner, ok := any(store).(interface {
		run(context.Context, func(time.Duration) (<-chan time.Time, func()))
	})
	if !ok {
		t.Fatal("cleanup loop cannot be driven by deterministic timer delivery")
	}
	base := at
	old := finishOperation(t, store, "docker:old", Success)
	active, _ := store.Create("docker.start", "docker:active")
	// Remove the pre-start wake so the first scheduled timer remains installed.
	<-store.wake
	timers := make(chan *expiryTestTimer, 8)
	factory := func(delay time.Duration) (<-chan time.Time, func()) {
		timer := &expiryTestTimer{delay: delay, fired: make(chan time.Time, 1), stopped: make(chan struct{})}
		timers <- timer
		return timer.fired, func() { close(timer.stopped) }
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { runner.run(ctx, factory); close(done) }()
	first := awaitExpiryTimer(t, timers)
	if first.delay != 24*time.Hour {
		t.Fatalf("first expiry delay = %v", first.delay)
	}
	setTime(base.Add(6 * time.Hour))
	newer := finishOperation(t, store, "docker:new", Failed)
	second := awaitExpiryTimer(t, timers)
	if second.delay != 18*time.Hour {
		t.Fatalf("rescheduled delay = %v, want 18h", second.delay)
	}
	select {
	case <-first.stopped:
	default:
		t.Fatal("wake did not stop the previous timer")
	}
	setTime(base.Add(24 * time.Hour))
	second.fired <- base.Add(24 * time.Hour)
	third := awaitExpiryTimer(t, timers)
	if third.delay != 6*time.Hour {
		t.Fatalf("next record expiry delay = %v, want 6h", third.delay)
	}
	store.mu.Lock()
	_, oldRetained := store.operations[old.ID]
	_, newRetained := store.operations[newer.ID]
	activeSnapshot, activeRetained := store.operations[active.ID]
	activeLock := store.resources[active.Resource]
	store.mu.Unlock()
	if oldRetained || !newRetained || !activeRetained || activeSnapshot.State != Pending || activeLock != active.ID {
		t.Fatal("timer expiry removed a fresh/active operation or kept the expired one")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup with an installed timer did not exit")
	}
	select {
	case <-third.stopped:
	default:
		t.Fatal("shutdown did not stop the installed timer")
	}
}
