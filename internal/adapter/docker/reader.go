// Package docker reads a restricted subset of the Docker Engine Unix API.
package docker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	appdocker "github.com/unraid-mobile/unraid-mobile/internal/app/docker"
)

const (
	maxResponseBytes = 8 << 20
	maxContainers    = 1024
	telemetryWorkers = 4
	requestTimeout   = 2 * time.Second
	sampleTimeout    = 8 * time.Second
)

type Reader struct {
	client *http.Client
	readMu sync.Mutex
	nextID string
}

// NewReader binds the reader to a Unix socket, never to environment endpoints.
func NewReader(socketPath string) *Reader {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: requestTimeout}).DialContext(ctx, "unix", socketPath)
		},
		MaxConnsPerHost:       telemetryWorkers,
		MaxIdleConnsPerHost:   telemetryWorkers,
		IdleConnTimeout:       30 * time.Second,
		ResponseHeaderTimeout: requestTimeout,
	}
	return &Reader{client: &http.Client{
		Transport:     transport,
		Timeout:       requestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Docker redirects are forbidden") },
	}}
}

// Read returns the container list and optional telemetry.
func (r *Reader) Read(ctx context.Context) (appdocker.Raw, error) {
	r.readMu.Lock()
	defer r.readMu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, sampleTimeout)
	defer cancel()
	version, err := r.negotiate(ctx)
	if err != nil {
		return appdocker.Raw{}, err
	}
	var list []struct {
		ID     string   `json:"Id"`
		Names  []string `json:"Names"`
		State  string   `json:"State"`
		Labels struct {
			Folder string `json:"folder.view2"`
		} `json:"Labels"`
	}
	if err := r.getJSON(ctx, "/v"+version+"/containers/json?all=1", &list); err != nil {
		return appdocker.Raw{}, errors.New("Docker container list unavailable")
	}
	if len(list) > maxContainers {
		return appdocker.Raw{}, errors.New("Docker container list exceeds safety limit")
	}
	raw := appdocker.Raw{Containers: make([]appdocker.RawContainer, len(list)), Diagnostics: []string{}}
	for i, item := range list {
		name := ""
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		state := item.State
		switch state {
		case "running", "created", "exited", "dead", "paused", "restarting", "removing":
		default:
			state = "unknown"
		}
		raw.Containers[i] = appdocker.RawContainer{ID: item.ID, Name: name, State: state, FolderName: item.Labels.Folder, Diagnostics: []string{}}
	}
	running := []int{}
	for i := range raw.Containers {
		if raw.Containers[i].State == "running" {
			running = append(running, i)
		}
	}
	offset := 0
	for position, i := range running {
		if raw.Containers[i].ID == r.nextID {
			offset = position
			break
		}
	}
	jobs := make(chan int, len(running))
	order := make([]int, 0, len(running))
	for position := range running {
		i := running[(offset+position)%len(running)]
		order = append(order, i)
		jobs <- i
	}
	close(jobs)
	attempted := make([]bool, len(list))
	var workers sync.WaitGroup
	for n := 0; n < telemetryWorkers; n++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for i := range jobs {
				if ctx.Err() != nil {
					raw.Containers[i].Diagnostics = append(raw.Containers[i].Diagnostics, "Sampling budget exhausted; telemetry deferred")
					continue
				}
				attempted[i] = true
				r.telemetry(ctx, version, &raw.Containers[i])
			}
		}()
	}
	workers.Wait()
	r.nextID = ""
	for _, i := range order {
		if !attempted[i] {
			r.nextID = raw.Containers[i].ID
			break
		}
	}
	return raw, nil
}

// negotiate intersects the daemon range with the supported 1.24 through 1.44 APIs.
func (r *Reader) negotiate(ctx context.Context) (string, error) {
	var version struct {
		API     string `json:"ApiVersion"`
		Minimum string `json:"MinAPIVersion"`
	}
	if err := r.getJSON(ctx, "/version", &version); err != nil {
		return "", errors.New("Docker Engine unavailable; check the Unix socket mount and permissions")
	}
	max, ok := apiMinor(version.API)
	min := 24
	if version.Minimum != "" {
		value, valid := apiMinor(version.Minimum)
		if !valid {
			return "", errors.New("Docker Engine API version unavailable")
		}
		if value > min {
			min = value
		}
	}
	if max > 44 {
		max = 44
	}
	if !ok || max < min {
		return "", errors.New("Docker Engine API version unsupported")
	}
	return "1." + strconv.Itoa(max), nil
}

// apiMinor accepts only a numeric Docker v1 minor version.
func apiMinor(version string) (int, bool) {
	if !strings.HasPrefix(version, "1.") || len(version) < 3 || len(version) > 5 {
		return 0, false
	}
	for _, ch := range version[2:] {
		if ch < '0' || ch > '9' {
			return 0, false
		}
	}
	value, err := strconv.Atoi(version[2:])
	return value, err == nil
}

// getJSON performs a bounded fixed GET and never returns daemon response bodies.
func (r *Reader) getJSON(ctx context.Context, path string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if err != nil {
		return errors.New("Invalid Docker read request")
	}
	response, err := r.client.Do(request)
	if err != nil {
		return errors.New("Docker read request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("Docker read request rejected")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return errors.New("Docker response exceeds safety limit or is incomplete")
	}
	if err := json.Unmarshal(data, out); err != nil {
		return errors.New("Docker response invalid")
	}
	return nil
}

// validID rejects path injection before constructing any container endpoint.
func validID(id string) bool {
	if len(id) != 64 {
		return false
	}
	for _, ch := range id {
		if !(ch >= '0' && ch <= '9') && !(ch >= 'a' && ch <= 'f') {
			return false
		}
	}
	return true
}

// telemetry independently reads start identity and one-shot resource counters.
func (r *Reader) telemetry(ctx context.Context, version string, c *appdocker.RawContainer) {
	if !validID(c.ID) {
		c.Diagnostics = append(c.Diagnostics, "Container identity invalid; telemetry unavailable")
		return
	}
	base := "/v" + version + "/containers/" + c.ID
	var inspect struct {
		State struct {
			StartedAt string `json:"StartedAt"`
		} `json:"State"`
	}
	if err := r.getJSON(ctx, base+"/json", &inspect); err != nil {
		c.Diagnostics = append(c.Diagnostics, "Container inspect unavailable")
	} else if start, err := time.Parse(time.RFC3339Nano, inspect.State.StartedAt); err == nil && !start.IsZero() {
		start = start.UTC()
		c.StartedAt = &start
	} else {
		c.Diagnostics = append(c.Diagnostics, "Container start time unavailable")
	}
	var stats struct {
		Read time.Time `json:"read"`
		CPU  struct {
			Usage struct {
				Total  *uint64  `json:"total_usage"`
				PerCPU []uint64 `json:"percpu_usage"`
			} `json:"cpu_usage"`
			System *uint64 `json:"system_cpu_usage"`
			Online uint32  `json:"online_cpus"`
		} `json:"cpu_stats"`
		Memory struct {
			Usage *uint64           `json:"usage"`
			Limit *uint64           `json:"limit"`
			Stats map[string]uint64 `json:"stats"`
		} `json:"memory_stats"`
		Networks map[string]struct {
			RX *uint64 `json:"rx_bytes"`
			TX *uint64 `json:"tx_bytes"`
		} `json:"networks"`
	}
	if err := r.getJSON(ctx, base+"/stats?stream=false&one-shot=true", &stats); err != nil {
		c.Diagnostics = append(c.Diagnostics, "Container stats unavailable")
		return
	}
	online := stats.CPU.Online
	if online == 0 {
		online = uint32(len(stats.CPU.Usage.PerCPU))
	}
	networks := make(map[string]appdocker.Network, len(stats.Networks))
	for name, n := range stats.Networks {
		if n.RX == nil || n.TX == nil {
			networks = nil
			break
		}
		networks[name] = appdocker.Network{RXBytes: *n.RX, TXBytes: *n.TX}
	}
	memory := make(map[string]uint64, 2)
	for _, key := range []string{"inactive_file", "cache"} {
		if value, ok := stats.Memory.Stats[key]; ok {
			memory[key] = value
		}
	}
	c.Stats = &appdocker.Stats{
		Read: stats.Read.UTC(), CPUUsage: stats.CPU.Usage.Total, SystemUsage: stats.CPU.System, OnlineCPUs: online,
		MemoryUsage: stats.Memory.Usage, MemoryLimit: stats.Memory.Limit, MemoryStats: memory, Networks: networks,
	}
	if c.StartedAt != nil {
		var confirmed struct {
			State struct {
				StartedAt string `json:"StartedAt"`
				Status    string `json:"Status"`
			} `json:"State"`
		}
		err := r.getJSON(ctx, base+"/json", &confirmed)
		start, parseErr := time.Parse(time.RFC3339Nano, confirmed.State.StartedAt)
		if err != nil || parseErr != nil || !start.Equal(*c.StartedAt) ||
			(confirmed.State.Status != "" && confirmed.State.Status != "running") {
			c.StartedAt = nil
			c.Diagnostics = append(c.Diagnostics, "Container startup identity changed or could not be confirmed; rates unavailable")
		}
	}
	if stats.Read.IsZero() {
		c.Diagnostics = append(c.Diagnostics, "Container stats timestamp unavailable")
	}
	if stats.CPU.Usage.Total == nil || stats.CPU.System == nil || online == 0 {
		c.Diagnostics = append(c.Diagnostics, "Container CPU counters unavailable")
	}
	if stats.Memory.Usage == nil || stats.Memory.Limit == nil {
		c.Diagnostics = append(c.Diagnostics, "Container memory counters unavailable")
	}
	if len(networks) == 0 {
		c.Diagnostics = append(c.Diagnostics, "Container network counters unavailable")
	}
}
