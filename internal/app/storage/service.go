// Package storage owns read-only storage snapshots and device I/O deltas.
package storage

import (
	"context"
	"slices"
	"sync"
	"time"
)

type Capacity struct {
	TotalBytes uint64 `json:"totalBytes"`
	UsedBytes  uint64 `json:"usedBytes"`
	FreeBytes  uint64 `json:"freeBytes"`
}
type Array struct {
	State     string    `json:"state"`
	DiskCount int       `json:"diskCount"`
	Capacity  *Capacity `json:"capacity"`
}
type Parity struct {
	State    string   `json:"state"`
	Action   string   `json:"action"`
	Progress *float64 `json:"progress"`
}
type Pool struct {
	Name       string    `json:"name"`
	State      string    `json:"state"`
	Filesystem string    `json:"filesystem"`
	DiskCount  int       `json:"diskCount"`
	Capacity   *Capacity `json:"capacity"`
}
type Counters struct{ ReadBytes, WriteBytes uint64 }
type Disk struct {
	Name                string    `json:"name"`
	Device              string    `json:"device"`
	Role                string    `json:"role"`
	Pool                string    `json:"pool,omitempty"`
	Status              string    `json:"status"`
	PowerState          string    `json:"powerState"`
	Filesystem          string    `json:"filesystem"`
	FilesystemStatus    string    `json:"filesystemStatus"`
	SizeBytes           *uint64   `json:"sizeBytes"`
	Temperature         *float64  `json:"temperature"`
	Capacity            *Capacity `json:"capacity"`
	ReadBytesPerSecond  *float64  `json:"readBytesPerSecond"`
	WriteBytesPerSecond *float64  `json:"writeBytesPerSecond"`
	Identity            string    `json:"-"`
	Counters            *Counters `json:"-"`
}
type Snapshot struct {
	Timestamp   time.Time `json:"timestamp"`
	Available   bool      `json:"available"`
	Reason      string    `json:"reason,omitempty"`
	Source      string    `json:"source"`
	Array       Array     `json:"array"`
	Parity      Parity    `json:"parity"`
	Pools       []Pool    `json:"pools"`
	Disks       []Disk    `json:"disks"`
	Diagnostics []string  `json:"diagnostics"`
}
type Provider interface {
	Read(context.Context) (Snapshot, error)
}
type Service struct {
	mu         sync.RWMutex
	provider   Provider
	now        func() time.Time
	latest     Snapshot
	previous   map[string]Counters
	previousAt time.Time
}

func NewService(provider Provider, now func() time.Time) *Service {
	return &Service{provider: provider, now: now, latest: unavailable("Waiting for first storage sample")}
}
func unavailable(reason string) Snapshot {
	return Snapshot{Reason: reason, Array: Array{State: "unknown"}, Parity: Parity{State: "unknown"}, Pools: []Pool{}, Disks: []Disk{}, Diagnostics: []string{}}
}
func deviceKey(d Disk) string { return d.Name + ":" + d.Device + ":" + d.Identity }
func (s *Service) Collect(ctx context.Context) Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	next, err := s.provider.Read(ctx)
	now := s.now().UTC()
	if err != nil {
		next = unavailable(err.Error())
		s.previous = nil
	} else {
		next = clone(next)
		next.Available = true
		current := make(map[string]Counters)
		for i := range next.Disks {
			d := &next.Disks[i]
			d.ReadBytesPerSecond = nil
			d.WriteBytesPerSecond = nil
			if d.Counters == nil {
				continue
			}
			key := deviceKey(*d)
			current[key] = *d.Counters
			if prev, ok := s.previous[key]; ok && now.After(s.previousAt) && d.Counters.ReadBytes >= prev.ReadBytes && d.Counters.WriteBytes >= prev.WriteBytes {
				elapsed := now.Sub(s.previousAt).Seconds()
				rx := float64(d.Counters.ReadBytes-prev.ReadBytes) / elapsed
				tx := float64(d.Counters.WriteBytes-prev.WriteBytes) / elapsed
				d.ReadBytesPerSecond = &rx
				d.WriteBytesPerSecond = &tx
			}
		}
		s.previous = current
		s.previousAt = now
	}
	next.Timestamp = now
	s.latest = next
	return clone(next)
}
func (s *Service) Latest() Snapshot { s.mu.RLock(); defer s.mu.RUnlock(); return clone(s.latest) }
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
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
func copyPtr[T any](v *T) *T {
	if v == nil {
		return nil
	}
	copy := *v
	return &copy
}
func clone(s Snapshot) Snapshot {
	s.Array.Capacity = copyPtr(s.Array.Capacity)
	s.Parity.Progress = copyPtr(s.Parity.Progress)
	s.Pools = slices.Clone(s.Pools)
	if s.Pools == nil {
		s.Pools = []Pool{}
	}
	for i := range s.Pools {
		s.Pools[i].Capacity = copyPtr(s.Pools[i].Capacity)
	}
	s.Disks = slices.Clone(s.Disks)
	if s.Disks == nil {
		s.Disks = []Disk{}
	}
	for i := range s.Disks {
		d := &s.Disks[i]
		d.SizeBytes = copyPtr(d.SizeBytes)
		d.Temperature = copyPtr(d.Temperature)
		d.Capacity = copyPtr(d.Capacity)
		d.Counters = copyPtr(d.Counters)
		d.ReadBytesPerSecond = copyPtr(d.ReadBytesPerSecond)
		d.WriteBytesPerSecond = copyPtr(d.WriteBytesPerSecond)
	}
	s.Diagnostics = slices.Clone(s.Diagnostics)
	if s.Diagnostics == nil {
		s.Diagnostics = []string{}
	}
	return s
}
