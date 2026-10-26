// Package system owns host snapshots and rate calculation without OS-specific paths.
package system

import (
	"context"
	"encoding/json"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"
)

type NetworkInterfaceRaw struct {
	Name      string
	Available bool
	Reason    string
	RX, TX    uint64
	Identity  *uint64
}

type NetworkInterfaceSnapshot struct {
	Name             string   `json:"name"`
	Available        bool     `json:"available"`
	Reason           string   `json:"reason,omitempty"`
	RXBytesPerSecond *float64 `json:"rxBytesPerSecond"`
	TXBytesPerSecond *float64 `json:"txBytesPerSecond"`
}

type Raw struct {
	Hostname                     string
	UptimeSeconds                *float64
	CPUTotal, CPUIdle            uint64
	CPUInfo                      *CPUInfo
	CPULogicalProcessors         []CPULogicalProcessorRaw
	MemoryTotal, MemoryAvailable uint64
	NetworkInterface             string
	NetworkRX, NetworkTX         uint64
	NetworkAvailable             bool
	NetworkInterfaces            []NetworkInterfaceRaw
	CPUTemperature               *float64
	Diagnostics                  map[string]string
}

type Snapshot struct {
	Timestamp            time.Time                     `json:"timestamp"`
	Available            bool                          `json:"available"`
	Reason               string                        `json:"reason,omitempty"`
	Hostname             string                        `json:"hostname"`
	UptimeSeconds        *float64                      `json:"uptimeSeconds"`
	CPUUsage             *float64                      `json:"cpuUsage"`
	CPUTemperature       *float64                      `json:"cpuTemperature"`
	CPUInfo              *CPUInfo                      `json:"cpuInfo"`
	CPULogicalProcessors []CPULogicalProcessorSnapshot `json:"cpuLogicalProcessors"`
	MemoryUsedBytes      uint64                        `json:"memoryUsedBytes"`
	MemoryTotalBytes     uint64                        `json:"memoryTotalBytes"`
	NetworkInterface     string                        `json:"networkInterface"`
	NetworkRXRate        *float64                      `json:"networkRXRate"`
	NetworkTXRate        *float64                      `json:"networkTXRate"`
	NetworkInterfaces    []NetworkInterfaceSnapshot    `json:"networkInterfaces"`
	Diagnostics          map[string]string             `json:"diagnostics"`
}

type Reader interface {
	Read(context.Context) (Raw, error)
}

type networkBaseline struct {
	RX, TX   uint64
	Identity *uint64
	At       time.Time
}

type Service struct {
	mu          sync.Mutex
	reader      Reader
	now         func() time.Time
	previous    *Raw
	previousAt  time.Time
	cpu         *cpuBaseline
	logicalCPU  map[int]cpuBaseline
	network     map[string]networkBaseline
	latest      Snapshot
	subscribers map[chan Snapshot]struct{}
}

// MarshalJSON preserves an empty array even for unavailable zero-value snapshots.
func (s Snapshot) MarshalJSON() ([]byte, error) {
	type snapshotJSON Snapshot
	if s.NetworkInterfaces == nil {
		s.NetworkInterfaces = []NetworkInterfaceSnapshot{}
	}
	if s.CPULogicalProcessors == nil {
		s.CPULogicalProcessors = []CPULogicalProcessorSnapshot{}
	}
	return json.Marshal(snapshotJSON(s))
}

// NewService owns the latest snapshot and one-second sampler baselines.
func NewService(reader Reader, now func() time.Time) *Service {
	return &Service{reader: reader, now: now, latest: Snapshot{Reason: "Waiting for first host sample", Diagnostics: map[string]string{}, NetworkInterfaces: []NetworkInterfaceSnapshot{}, CPULogicalProcessors: []CPULogicalProcessorSnapshot{}}, subscribers: make(map[chan Snapshot]struct{})}
}

// Collect samples once and publishes independently owned complete snapshots.
func (s *Service) Collect(ctx context.Context) Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := s.reader.Read(ctx)
	now := s.now().UTC()
	next := Snapshot{Timestamp: now, Diagnostics: map[string]string{}, NetworkInterfaces: []NetworkInterfaceSnapshot{}, CPULogicalProcessors: []CPULogicalProcessorSnapshot{}}
	if err != nil {
		next.Reason = err.Error()
		s.previous = nil
		s.cpu = nil
		s.logicalCPU = nil
		s.network = nil
	} else {
		next.Available = true
		next.Hostname = raw.Hostname
		next.UptimeSeconds = copyPointer(raw.UptimeSeconds)
		next.CPUTemperature = copyPointer(raw.CPUTemperature)
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
			if raw.NetworkInterfaces == nil && raw.NetworkAvailable && prev.NetworkAvailable && raw.NetworkInterface == prev.NetworkInterface && raw.NetworkRX >= prev.NetworkRX && raw.NetworkTX >= prev.NetworkTX {
				seconds := now.Sub(s.previousAt).Seconds()
				rx := float64(raw.NetworkRX-prev.NetworkRX) / seconds
				tx := float64(raw.NetworkTX-prev.NetworkTX) / seconds
				next.NetworkRXRate = &rx
				next.NetworkTXRate = &tx
			}
		}
		s.collectCPU(raw, now, &next)
		s.collectNetwork(raw, now, &next)
		// Retain only legacy network counters, never caller-owned slices or pointers.
		s.previous = &Raw{NetworkInterface: raw.NetworkInterface,
			NetworkAvailable: raw.NetworkAvailable, NetworkRX: raw.NetworkRX, NetworkTX: raw.NetworkTX}
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

// collectNetwork computes independent adjacent rates and projects Auto from the same results.
func (s *Service) collectNetwork(raw Raw, now time.Time, next *Snapshot) {
	if raw.NetworkInterfaces == nil {
		// Old fake readers still use the legacy single-interface counters.
		s.network = nil
		return
	}
	items := slices.Clone(raw.NetworkInterfaces)
	slices.SortFunc(items, func(a, b NetworkInterfaceRaw) int { return strings.Compare(a.Name, b.Name) })
	baselines := make(map[string]networkBaseline, len(items))
	for _, item := range items {
		snapshot := NetworkInterfaceSnapshot{Name: item.Name, Available: item.Available, Reason: item.Reason}
		if item.Available {
			previous, found := s.network[item.Name]
			if !found || now.After(previous.At) {
				if found && sameIdentity(item.Identity, previous.Identity) && item.RX >= previous.RX && item.TX >= previous.TX {
					seconds := now.Sub(previous.At).Seconds()
					rx := float64(item.RX-previous.RX) / seconds
					tx := float64(item.TX-previous.TX) / seconds
					snapshot.RXBytesPerSecond, snapshot.TXBytesPerSecond = &rx, &tx
				}
				// Ordered readable samples seed the next interval, including counter rollback.
				baselines[item.Name] = networkBaseline{RX: item.RX, TX: item.TX, Identity: copyPointer(item.Identity), At: now}
			}
		}
		next.NetworkInterfaces = append(next.NetworkInterfaces, snapshot)
		if item.Name == raw.NetworkInterface {
			next.NetworkRXRate = copyPointer(snapshot.RXBytesPerSecond)
			next.NetworkTXRate = copyPointer(snapshot.TXBytesPerSecond)
		}
	}
	s.network = baselines
}

// sameIdentity treats observed loss or recovery as a change, without claiming reliable identity.
func sameIdentity(a, b *uint64) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// copyPointer gives each consumer ownership of an optional scalar value.
func copyPointer[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

// clone isolates all arrays, maps and optional metrics from cache and subscriber mutations.
func clone(s Snapshot) Snapshot {
	s.Diagnostics = maps.Clone(s.Diagnostics)
	s.UptimeSeconds = copyPointer(s.UptimeSeconds)
	s.CPUUsage = copyPointer(s.CPUUsage)
	s.CPUTemperature = copyPointer(s.CPUTemperature)
	s.CPUInfo = cloneCPUInfo(s.CPUInfo)
	s.CPULogicalProcessors = slices.Clone(s.CPULogicalProcessors)
	for i := range s.CPULogicalProcessors {
		s.CPULogicalProcessors[i].Usage = copyPointer(s.CPULogicalProcessors[i].Usage)
	}
	s.NetworkRXRate = copyPointer(s.NetworkRXRate)
	s.NetworkTXRate = copyPointer(s.NetworkTXRate)
	s.NetworkInterfaces = slices.Clone(s.NetworkInterfaces)
	for i := range s.NetworkInterfaces {
		item := &s.NetworkInterfaces[i]
		item.RXBytesPerSecond = copyPointer(item.RXBytesPerSecond)
		item.TXBytesPerSecond = copyPointer(item.TXBytesPerSecond)
	}
	return s
}

// Latest returns the cached sample without reading the host.
func (s *Service) Latest() Snapshot { s.mu.Lock(); defer s.mu.Unlock(); return clone(s.latest) }

// Subscribe supplies independent latest-only snapshots without triggering collection.
func (s *Service) Subscribe() (<-chan Snapshot, func()) {
	s.mu.Lock()
	ch := make(chan Snapshot, 1)
	ch <- clone(s.latest)
	s.subscribers[ch] = struct{}{}
	s.mu.Unlock()
	var once sync.Once
	return ch, func() { once.Do(func() { s.mu.Lock(); delete(s.subscribers, ch); close(ch); s.mu.Unlock() }) }
}

// Run collects host metrics on one background ticker until cancellation.
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
