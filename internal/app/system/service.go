// Package system owns host snapshots and rate calculation without OS-specific paths.
package system

import (
	"context"
	"maps"
	"sync"
	"time"
)

type Raw struct {
	Hostname                     string
	UptimeSeconds                *float64
	CPUTotal, CPUIdle            uint64
	MemoryTotal, MemoryAvailable uint64
	NetworkInterface             string
	NetworkRX, NetworkTX         uint64
	NetworkAvailable             bool
	CPUTemperature               *float64
	Diagnostics                  map[string]string
}

type Snapshot struct {
	Timestamp        time.Time         `json:"timestamp"`
	Available        bool              `json:"available"`
	Reason           string            `json:"reason,omitempty"`
	Hostname         string            `json:"hostname"`
	UptimeSeconds    *float64          `json:"uptimeSeconds"`
	CPUUsage         *float64          `json:"cpuUsage"`
	CPUTemperature   *float64          `json:"cpuTemperature"`
	MemoryUsedBytes  uint64            `json:"memoryUsedBytes"`
	MemoryTotalBytes uint64            `json:"memoryTotalBytes"`
	NetworkInterface string            `json:"networkInterface"`
	NetworkRXRate    *float64          `json:"networkRXRate"`
	NetworkTXRate    *float64          `json:"networkTXRate"`
	Diagnostics      map[string]string `json:"diagnostics"`
}

type Reader interface {
	Read(context.Context) (Raw, error)
}

type Service struct {
	mu          sync.Mutex
	reader      Reader
	now         func() time.Time
	previous    *Raw
	previousAt  time.Time
	latest      Snapshot
	subscribers map[chan Snapshot]struct{}
}

func NewService(reader Reader, now func() time.Time) *Service {
	return &Service{reader: reader, now: now, latest: Snapshot{Reason: "Waiting for first host sample", Diagnostics: map[string]string{}}, subscribers: make(map[chan Snapshot]struct{})}
}

func (s *Service) Collect(ctx context.Context) Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := s.reader.Read(ctx)
	now := s.now().UTC()
	next := Snapshot{Timestamp: now, Diagnostics: map[string]string{}}
	if err != nil {
		next.Reason = err.Error()
		s.previous = nil
	} else {
		next.Available = true
		next.Hostname = raw.Hostname
		next.UptimeSeconds = raw.UptimeSeconds
		next.CPUTemperature = raw.CPUTemperature
		next.MemoryTotalBytes = raw.MemoryTotal
		if raw.MemoryAvailable <= raw.MemoryTotal {
			next.MemoryUsedBytes = raw.MemoryTotal - raw.MemoryAvailable
		}
		next.NetworkInterface = raw.NetworkInterface
		next.Diagnostics = maps.Clone(raw.Diagnostics)
		if next.Diagnostics == nil {
			next.Diagnostics = map[string]string{}
		}
		if prev := s.previous; prev != nil && now.After(s.previousAt) {
			if raw.CPUTotal > prev.CPUTotal && raw.CPUIdle >= prev.CPUIdle {
				total, idle := raw.CPUTotal-prev.CPUTotal, raw.CPUIdle-prev.CPUIdle
				if idle <= total {
					value := 100 * float64(total-idle) / float64(total)
					next.CPUUsage = &value
				}
			}
			if raw.NetworkAvailable && prev.NetworkAvailable && raw.NetworkInterface == prev.NetworkInterface && raw.NetworkRX >= prev.NetworkRX && raw.NetworkTX >= prev.NetworkTX {
				seconds := now.Sub(s.previousAt).Seconds()
				rx := float64(raw.NetworkRX-prev.NetworkRX) / seconds
				tx := float64(raw.NetworkTX-prev.NetworkTX) / seconds
				next.NetworkRXRate = &rx
				next.NetworkTXRate = &tx
			}
		}
		s.previous = &raw
		s.previousAt = now
	}
	s.latest = next
	for ch := range s.subscribers {
		select {
		case ch <- clone(next):
		default:
			select {
			case <-ch:
			default:
			}
			ch <- clone(next)
		}
	}
	return clone(next)
}

func clone(s Snapshot) Snapshot     { s.Diagnostics = maps.Clone(s.Diagnostics); return s }
func (s *Service) Latest() Snapshot { s.mu.Lock(); defer s.mu.Unlock(); return clone(s.latest) }
func (s *Service) Subscribe() (<-chan Snapshot, func()) {
	s.mu.Lock()
	ch := make(chan Snapshot, 1)
	ch <- clone(s.latest)
	s.subscribers[ch] = struct{}{}
	s.mu.Unlock()
	var once sync.Once
	return ch, func() { once.Do(func() { s.mu.Lock(); delete(s.subscribers, ch); close(ch); s.mu.Unlock() }) }
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
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
