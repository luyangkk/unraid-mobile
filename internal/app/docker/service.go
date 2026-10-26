// Package docker owns read-only container snapshots and telemetry deltas.
package docker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"slices"
	"sync"
	"time"
)

type Container struct {
	IconVersion      string   `json:"iconVersion,omitempty"`
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	State            string   `json:"state"`
	CPUUsage         *float64 `json:"cpuUsage"`
	MemoryUsedBytes  *uint64  `json:"memoryUsedBytes"`
	MemoryLimitBytes *uint64  `json:"memoryLimitBytes"`
	UptimeSeconds    *float64 `json:"uptimeSeconds"`
	NetworkRXRate    *float64 `json:"networkRXRate"`
	NetworkTXRate    *float64 `json:"networkTXRate"`
	Diagnostics      []string `json:"diagnostics"`
}

// Folder contains only read-only grouping and icon fields from FolderView2.
type Folder struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	ContainerIDs []string `json:"containerIds"`
	MatchPattern string   `json:"matchPattern,omitempty"`
	IconURL      string   `json:"iconUrl,omitempty"`
	IconVersion  string   `json:"iconVersion,omitempty"`
}

type RawFolder struct {
	ID, Name, MatchPattern, IconURL string
	ContainerIDs                    []string
	IconPNG                         []byte
}

type Summary struct {
	Running int `json:"running"`
	Stopped int `json:"stopped"`
	Other   int `json:"other"`
}

type Snapshot struct {
	Folders     []Folder    `json:"folders,omitempty"`
	Timestamp   time.Time   `json:"timestamp"`
	Available   bool        `json:"available"`
	Reason      string      `json:"reason"`
	Containers  []Container `json:"containers"`
	Summary     Summary     `json:"summary"`
	Diagnostics []string    `json:"diagnostics"`
}

type Network struct{ RXBytes, TXBytes uint64 }

type Stats struct {
	Read        time.Time
	CPUUsage    *uint64
	SystemUsage *uint64
	OnlineCPUs  uint32
	MemoryUsage *uint64
	MemoryLimit *uint64
	MemoryStats map[string]uint64
	Networks    map[string]Network
}

type RawContainer struct {
	FolderName      string
	IconPNG         []byte
	ID, Name, State string
	StartedAt       *time.Time
	Stats           *Stats
	Diagnostics     []string
}

type Raw struct {
	Folders     []RawFolder
	Containers  []RawContainer
	Diagnostics []string
}

type Reader interface {
	Read(context.Context) (Raw, error)
}

type cachedIcon struct {
	version string
	png     []byte
}

type Service struct {
	icons     map[string]cachedIcon
	collectMu sync.Mutex
	mu        sync.RWMutex
	reader    Reader
	now       func() time.Time
	latest    Snapshot
	previous  map[string]Stats
}

// NewService creates the Docker sampler.
func NewService(reader Reader, now func() time.Time) *Service {
	return &Service{reader: reader, now: now, latest: Unavailable(now(), "Waiting for first Docker sample")}
}

// Unavailable creates an empty snapshot with an explicit collection reason.
func Unavailable(at time.Time, reason string) Snapshot {
	return Snapshot{Timestamp: at.UTC(), Reason: reason, Containers: []Container{}, Diagnostics: []string{}}
}

// Collect serializes sampling without holding the snapshot lock during I/O.
func (s *Service) Collect(ctx context.Context) Snapshot {
	s.collectMu.Lock()
	defer s.collectMu.Unlock()
	var raw Raw
	var err error
	if s.reader != nil {
		raw, err = s.reader.Read(ctx)
	}
	now := s.now().UTC()
	next := Unavailable(now, "Docker Engine unavailable")
	if err != nil {
		// The adapter sanitizes errors before they cross the app boundary.
		next.Reason = err.Error()
	}
	current := make(map[string]Stats)
	icons := make(map[string]cachedIcon)
	if err == nil && s.reader != nil {
		next.Available = true
		next.Reason = ""
		next.Diagnostics = stringsCopy(raw.Diagnostics)
		for _, r := range raw.Containers {
			c := Container{ID: r.ID, Name: r.Name, State: r.State, Diagnostics: stringsCopy(r.Diagnostics)}
			if len(r.IconPNG) > 0 {
				digest := sha256.Sum256(r.IconPNG)
				c.IconVersion = hex.EncodeToString(digest[:])
				icons[r.ID] = cachedIcon{version: c.IconVersion, png: slices.Clone(r.IconPNG)}
			}
			switch r.State {
			case "running":
				next.Summary.Running++
			case "created", "exited", "dead":
				next.Summary.Stopped++
			default:
				next.Summary.Other++
			}
			if r.State == "running" {
				validStart := r.StartedAt != nil && !r.StartedAt.IsZero() && !r.StartedAt.After(now)
				if validStart {
					uptime := now.Sub(*r.StartedAt).Seconds()
					c.UptimeSeconds = &uptime
				}
				if r.Stats != nil {
					stats := r.Stats
					c.MemoryLimitBytes = copyPtr(stats.MemoryLimit)
					if stats.MemoryUsage != nil {
						used := *stats.MemoryUsage
						cache, ok := stats.MemoryStats["inactive_file"]
						if !ok {
							cache = stats.MemoryStats["cache"]
						}
						if cache <= used {
							used -= cache
						}
						c.MemoryUsedBytes = &used
					}
					if validStart && !stats.Read.IsZero() && !stats.Read.Before(*r.StartedAt) {
						key := r.ID + ":" + r.StartedAt.UTC().Format(time.RFC3339Nano)
						prev, exists := s.previous[key]
						if !exists || stats.Read.After(prev.Read) {
							current[key] = cloneStats(*stats)
							if exists {
								if stats.CPUUsage != nil && prev.CPUUsage != nil && stats.SystemUsage != nil && prev.SystemUsage != nil &&
									*stats.CPUUsage >= *prev.CPUUsage && *stats.SystemUsage > *prev.SystemUsage && stats.OnlineCPUs > 0 {
									cpu := float64(*stats.CPUUsage-*prev.CPUUsage) / float64(*stats.SystemUsage-*prev.SystemUsage) * float64(stats.OnlineCPUs) * 100
									c.CPUUsage = &cpu
								}
								c.NetworkRXRate, c.NetworkTXRate = networkRates(*stats, prev)
							}
						}
					}
				}
			}
			next.Containers = append(next.Containers, c)
		}
	}
	for _, r := range raw.Folders {
		if !next.Available {
			break
		}
		f := Folder{ID: r.ID, Name: r.Name, ContainerIDs: slices.Clone(r.ContainerIDs), MatchPattern: r.MatchPattern, IconURL: r.IconURL}
		if len(r.IconPNG) > 0 {
			digest := sha256.Sum256(r.IconPNG)
			f.IconVersion = hex.EncodeToString(digest[:])
			icons[r.ID] = cachedIcon{version: f.IconVersion, png: slices.Clone(r.IconPNG)}
		}
		next.Folders = append(next.Folders, f)
	}

	s.previous = current
	s.mu.Lock()
	s.latest = next
	s.icons = icons
	s.mu.Unlock()
	return clone(next)
}

// networkRates requires matching interfaces and non-regressing counters.
func networkRates(next, prev Stats) (*float64, *float64) {
	if len(next.Networks) == 0 || len(next.Networks) != len(prev.Networks) {
		return nil, nil
	}
	var rx, tx float64
	for name, n := range next.Networks {
		p, ok := prev.Networks[name]
		if !ok || n.RXBytes < p.RXBytes || n.TXBytes < p.TXBytes {
			return nil, nil
		}
		rx += float64(n.RXBytes - p.RXBytes)
		tx += float64(n.TXBytes - p.TXBytes)
	}
	elapsed := next.Read.Sub(prev.Read).Seconds()
	if elapsed <= 0 {
		return nil, nil
	}
	rx /= elapsed
	tx /= elapsed
	return &rx, &tx
}

// Latest returns a defensive copy without waiting for the Engine.
func (s *Service) Latest() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return clone(s.latest)
}

// Run samples until cancellation.
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

// copyPtr prevents optional metrics from sharing mutable storage.
func copyPtr[T any](p *T) *T {
	if p == nil {
		return nil
	}
	value := *p
	return &value
}

// stringsCopy preserves JSON arrays even when a provider supplies nil slices.
func stringsCopy(values []string) []string {
	if values == nil {
		return []string{}
	}
	return slices.Clone(values)
}

// clone isolates all snapshot fields exposed to API callers.
func clone(s Snapshot) Snapshot {
	s.Folders = slices.Clone(s.Folders)
	for i := range s.Folders {
		s.Folders[i].ContainerIDs = slices.Clone(s.Folders[i].ContainerIDs)
	}
	s.Diagnostics = stringsCopy(s.Diagnostics)
	s.Containers = slices.Clone(s.Containers)
	if s.Containers == nil {
		s.Containers = []Container{}
	}
	for i := range s.Containers {
		c := &s.Containers[i]
		c.Diagnostics = stringsCopy(c.Diagnostics)
		c.CPUUsage = copyPtr(c.CPUUsage)
		c.MemoryUsedBytes = copyPtr(c.MemoryUsedBytes)
		c.MemoryLimitBytes = copyPtr(c.MemoryLimitBytes)
		c.UptimeSeconds = copyPtr(c.UptimeSeconds)
		c.NetworkRXRate = copyPtr(c.NetworkRXRate)
		c.NetworkTXRate = copyPtr(c.NetworkTXRate)
	}
	return s
}

// cloneStats owns the counters retained for the next sampling interval.
func cloneStats(s Stats) Stats {
	s.CPUUsage = copyPtr(s.CPUUsage)
	s.SystemUsage = copyPtr(s.SystemUsage)
	s.MemoryUsage = copyPtr(s.MemoryUsage)
	s.MemoryLimit = copyPtr(s.MemoryLimit)
	networks := make(map[string]Network, len(s.Networks))
	for name, n := range s.Networks {
		networks[name] = n
	}
	s.Networks = networks
	s.MemoryStats = nil
	return s
}

// Icon returns an isolated image from the current sample, without host I/O.
func (s *Service) Icon(id, version string) ([]byte, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	icon, ok := s.icons[id]
	if !s.latest.Available || !ok || version == "" || icon.version != version {
		return nil, false
	}
	return slices.Clone(icon.png), true
}
