package operation

import (
	"context"
	"sort"
	"time"
)

const (
	terminalLimit = 100
	terminalTTL   = 24 * time.Hour
)

type terminalRecord struct {
	id      string
	endedAt time.Time
}

// retain inserts a terminal record by endedAt, preserving completion order on ties.
// The caller holds the Store mutex.
func (s *Store) retain(record terminalRecord) {
	index := sort.Search(len(s.terminals), func(i int) bool {
		return s.terminals[i].endedAt.After(record.endedAt)
	})
	s.terminals = append(s.terminals, terminalRecord{})
	copy(s.terminals[index+1:], s.terminals[index:])
	s.terminals[index] = record
}

// prune enforces both terminal bounds without changing any resource reservation.
// The caller holds the Store mutex.
func (s *Store) prune(now time.Time) {
	for len(s.terminals) > 0 {
		oldest := s.terminals[0]
		if len(s.terminals) <= terminalLimit && now.Before(oldest.endedAt.Add(terminalTTL)) {
			return
		}
		delete(s.operations, oldest.id)
		s.terminals[0] = terminalRecord{}
		s.terminals = s.terminals[1:]
	}
}

// Run expires idle terminal records until shutdown, without executing operations.
// Start it with the server's context; other Store methods also prune on access.
func (s *Store) Run(ctx context.Context) {
	s.run(ctx, func(delay time.Duration) (<-chan time.Time, func()) {
		timer := time.NewTimer(delay)
		return timer.C, func() { timer.Stop() }
	})
}

// run uses the supplied timer factory to schedule the next expiry. Keeping
// clock reads and timer creation together permits deterministic lifecycle tests.
func (s *Store) run(ctx context.Context, newTimer func(time.Duration) (<-chan time.Time, func())) {
	for {
		s.mu.Lock()
		now := s.now().UTC()
		s.prune(now)
		var stopTimer func()
		var expired <-chan time.Time
		if len(s.terminals) > 0 {
			expired, stopTimer = newTimer(s.terminals[0].endedAt.Add(terminalTTL).Sub(now))
		}
		s.mu.Unlock()

		select {
		case <-ctx.Done():
			if stopTimer != nil {
				stopTimer()
			}
			return
		case <-s.wake:
		case <-expired:
		}
		if stopTimer != nil {
			stopTimer()
		}
	}
}
