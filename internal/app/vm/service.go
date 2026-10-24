// Package vm owns cached, read-only virtual machine snapshots.
package vm

import (
	"context"
	"slices"
	"sync"
	"time"
)

type Domain struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	State         string   `json:"state"`
	VCPUs         *uint32  `json:"vcpus"`
	MemoryBytes   *uint64  `json:"memoryBytes"`
	UptimeSeconds *float64 `json:"uptimeSeconds"`
	Diagnostics   []string `json:"diagnostics"`
}

type Summary struct {
	Running int `json:"running"`
	Stopped int `json:"stopped"`
	Other   int `json:"other"`
}

type Snapshot struct {
	Timestamp   time.Time `json:"timestamp"`
	Available   bool      `json:"available"`
	Reason      string    `json:"reason"`
	Domains     []Domain  `json:"domains"`
	Summary     Summary   `json:"summary"`
	Diagnostics []string  `json:"diagnostics"`
}

type Reader interface {
	Read(context.Context) (Snapshot, error)
}

type Service struct {
	collectMu sync.Mutex
	mu        sync.RWMutex
	reader    Reader
	now       func() time.Time
	latest    Snapshot
}

func NewService(reader Reader, now func() time.Time) *Service {
	initial := Unavailable(now(), "Waiting for first VM sample")
	if reader == nil {
		initial.Reason = "VM preview disabled"
	}
	return &Service{reader: reader, now: now, latest: initial}
}

func Unavailable(at time.Time, reason string) Snapshot {
	return Snapshot{Timestamp: at.UTC(), Reason: reason, Domains: []Domain{}, Diagnostics: []string{}}
}

// Collect serializes I/O without blocking cached reads.
func (s *Service) Collect(ctx context.Context) Snapshot {
	s.collectMu.Lock()
	defer s.collectMu.Unlock()
	next := Unavailable(s.now(), "VM preview disabled")
	if s.reader != nil {
		raw, err := s.reader.Read(ctx)
		if err != nil {
			next.Reason = err.Error()
		} else {
			next = clone(raw)
			next.Available, next.Reason = true, ""
			next.Summary = Summary{}
			for _, d := range next.Domains {
				switch d.State {
				case "running":
					next.Summary.Running++
				case "shutoff":
					next.Summary.Stopped++
				default:
					next.Summary.Other++
				}
			}
		}
	}
	next.Timestamp = s.now().UTC()
	s.mu.Lock()
	s.latest = next
	s.mu.Unlock()
	return clone(next)
}

func (s *Service) Latest() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return clone(s.latest)
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.Collect(ctx)
		}
	}
}

func copyPtr[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}
func stringsCopy(v []string) []string {
	if v == nil {
		return []string{}
	}
	return slices.Clone(v)
}
func clone(s Snapshot) Snapshot {
	s.Diagnostics = stringsCopy(s.Diagnostics)
	s.Domains = slices.Clone(s.Domains)
	if s.Domains == nil {
		s.Domains = []Domain{}
	}
	for i := range s.Domains {
		d := &s.Domains[i]
		d.VCPUs = copyPtr(d.VCPUs)
		d.MemoryBytes = copyPtr(d.MemoryBytes)
		d.UptimeSeconds = copyPtr(d.UptimeSeconds)
		d.Diagnostics = stringsCopy(d.Diagnostics)
	}
	return s
}
