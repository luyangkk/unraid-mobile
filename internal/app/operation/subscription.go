package operation

import "sync"

// Subscribe receives future full snapshots with no replay; cancel must be called
// when the subscriber exits. A slow subscriber retains only the latest update.
func (s *Store) Subscribe() (<-chan Operation, func()) {
	s.mu.Lock()
	s.prune(s.now().UTC())
	events := make(chan Operation, 1)
	s.subscribers[events] = struct{}{}
	s.mu.Unlock()

	var once sync.Once
	return events, func() {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			delete(s.subscribers, events)
			select {
			case <-events:
			default:
			}
			close(events)
		})
	}
}

// publish gives each subscriber its own snapshot without blocking on consumers.
// The caller holds the Store mutex, serializing publishers and cancellation.
func (s *Store) publish(op Operation) {
	for events := range s.subscribers {
		snapshot := clone(op)
		select {
		case events <- snapshot:
		default:
			select {
			case <-events:
			default:
			}
			// Only this mutex-protected publisher can refill the drained buffer.
			events <- snapshot
		}
	}
}
