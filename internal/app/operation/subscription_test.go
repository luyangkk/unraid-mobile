package operation

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// subscribeStore reports a missing subscription contract as a behavioral failure.
func subscribeStore(t *testing.T, store *Store) (<-chan Operation, func()) {
	t.Helper()
	subscriber, ok := any(store).(interface {
		Subscribe() (<-chan Operation, func())
	})
	if !ok {
		t.Fatal("Store does not publish operation snapshots")
	}
	return subscriber.Subscribe()
}

// receiveOperation bounds a broken event delivery without sleeping for success.
func receiveOperation(t *testing.T, events <-chan Operation) Operation {
	t.Helper()
	select {
	case op, ok := <-events:
		if !ok {
			t.Fatal("subscription closed before event")
		}
		return op
	case <-time.After(time.Second):
		t.Fatal("operation event missing")
		return Operation{}
	}
}

// TestStorePublishesFullSnapshots checks create, lifecycle and actual progress changes.
func TestStorePublishesFullSnapshots(t *testing.T) {
	store := NewStore(time.Now)
	events, cancel := subscribeStore(t, store)
	defer cancel()
	select {
	case <-events:
		t.Fatal("subscription replayed an event")
	default:
	}
	op, _ := store.Create("docker.restart", "docker:plex")
	created := receiveOperation(t, events)
	if created.ID != op.ID || created.State != Pending || created.Type != "docker.restart" || created.Resource != "docker:plex" || created.StartedAt.IsZero() {
		t.Fatalf("create event: %+v", created)
	}
	store.Update(op.ID, Running, nil)
	if got := receiveOperation(t, events); got.ID != op.ID || got.State != Running {
		t.Fatalf("running event: %+v", got)
	}
	progress := 42.5
	store.UpdateProgress(op.ID, &progress)
	if got := receiveOperation(t, events); got.Progress == nil || *got.Progress != 42.5 || got.State != Running {
		t.Fatalf("progress event: %+v", got)
	}
	store.UpdateProgress(op.ID, &progress)
	select {
	case <-events:
		t.Fatal("unchanged progress published an update")
	default:
	}
	store.UpdateProgress(op.ID, nil)
	if got := receiveOperation(t, events); got.Progress != nil {
		t.Fatal("unknown progress event has a percentage")
	}
	store.Update(op.ID, Failed, &Error{Code: "FAILED", Message: "Execution failed"})
	if got := receiveOperation(t, events); got.State != Failed || got.EndedAt == nil || got.Error == nil || got.Error.Code != "FAILED" {
		t.Fatalf("terminal event: %+v", got)
	}
	store.Update(op.ID, Running, nil)
	store.UpdateProgress(op.ID, &progress)
	select {
	case <-events:
		t.Fatal("rejected update published an event")
	default:
	}
}

// TestStoreSubscriberCopies isolates subscribers from one another and the Store.
func TestStoreSubscriberCopies(t *testing.T) {
	store := NewStore(time.Now)
	first, cancelFirst := subscribeStore(t, store)
	defer cancelFirst()
	second, cancelSecond := subscribeStore(t, store)
	defer cancelSecond()
	op, _ := store.Create("docker.restart", "docker:plex")
	store.Update(op.ID, Running, nil)
	progress := 50.0
	store.UpdateProgress(op.ID, &progress)
	store.Update(op.ID, Failed, &Error{Code: "FAILED", Details: "detail"})
	got := receiveOperation(t, first)
	got.Error.Code = "mutated"
	*got.Progress = 99
	*got.EndedAt = time.Time{}
	other := receiveOperation(t, second)
	snapshot, _ := store.Get(op.ID)
	for _, value := range []Operation{other, snapshot} {
		if value.Error.Code != "FAILED" || *value.Progress != 50 || value.EndedAt.IsZero() {
			t.Fatalf("subscriber alias: %+v", value)
		}
	}
}

// TestStoreSlowSubscriberKeepsLatest checks nonblocking delivery and cancellation.
func TestStoreSlowSubscriberKeepsLatest(t *testing.T) {
	store := NewStore(time.Now)
	slow, cancelSlow := subscribeStore(t, store)
	fast, cancelFast := subscribeStore(t, store)
	defer cancelFast()
	op, _ := store.Create("docker.restart", "docker:plex")
	receiveOperation(t, fast)
	store.Update(op.ID, Running, nil)
	receiveOperation(t, fast)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i <= 100; i++ {
			value := float64(i)
			if _, err := store.UpdateProgress(op.ID, &value); err != nil {
				t.Error(err)
			}
			// A consumer drains fast while slow is never consumed.
			select {
			case event := <-fast:
				if event.Progress == nil || *event.Progress != value {
					t.Error("fast subscriber did not receive latest progress")
				}
			default:
				t.Error("fast subscriber missing progress")
			}
		}
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("slow subscriber blocked UpdateProgress")
	}
	latest := receiveOperation(t, slow)
	if latest.Progress == nil || *latest.Progress != 100 {
		t.Fatalf("slow subscriber did not retain latest: %+v", latest)
	}
	store.Update(op.ID, Success, nil)
	cancelSlow()
	cancelSlow()
	if _, ok := <-slow; ok {
		t.Fatal("cancelled subscription delivered queued data")
	}
	if _, err := store.Create("docker.restart", op.Resource); err != nil {
		t.Fatal(err)
	}
}

// TestStoreConcurrentPublishingAndCancellation checks subscriber lifecycle races.
func TestStoreConcurrentPublishingAndCancellation(t *testing.T) {
	store := NewStore(time.Now)
	// Check availability before spawning goroutines.
	_, cancel := subscribeStore(t, store)
	cancel()
	subscriber := any(store).(interface {
		Subscribe() (<-chan Operation, func())
	})
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			op, err := store.Create("docker.restart", fmt.Sprintf("docker:%d", i))
			if err != nil {
				t.Error(err)
				return
			}
			store.Update(op.ID, Running, nil)
			value := float64(i)
			store.UpdateProgress(op.ID, &value)
			store.Get(op.ID)
			store.Update(op.ID, Failed, &Error{Code: "FAILED"})
		}(i)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				events, stop := subscriber.Subscribe()
				select {
				case op := <-events:
					if op.Progress != nil {
						*op.Progress = 99
					}
					if op.Error != nil {
						op.Error.Code = "caller mutation"
					}
				default:
				}
				stop()
				stop()
				if _, ok := <-events; ok {
					t.Error("cancelled subscription delivered data")
				}
			}
		}()
	}
	wg.Wait()
}
