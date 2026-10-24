// Package system reads only the explicitly mounted host procfs and sysfs trees.
package system

import (
	"context"
	"fmt"
	"io/fs"
	"math"
	"path"
	"strconv"
	"strings"

	domain "github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

type Reader struct {
	files    fs.FS
	Hostname string
}

// NewReader accepts a filesystem rooted at /host in production and fixtures in tests.
func NewReader(files fs.FS) *Reader { return &Reader{files: files} }
func (r *Reader) text(name string) (string, error) {
	b, err := fs.ReadFile(r.files, name)
	return strings.TrimSpace(string(b)), err
}

func (r *Reader) Read(ctx context.Context) (domain.Raw, error) {
	if err := ctx.Err(); err != nil {
		return domain.Raw{}, err
	}
	raw := domain.Raw{Diagnostics: map[string]string{}}
	stat, err := r.text("proc/stat")
	if err != nil {
		return raw, fmt.Errorf("Host CPU unavailable; mount /proc at /host/proc read-only: %w", err)
	}
	fields := strings.Fields(strings.SplitN(stat, "\n", 2)[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return raw, fmt.Errorf("invalid host CPU counters")
	}
	for i := 1; i < len(fields) && i <= 8; i++ {
		value, e := strconv.ParseUint(fields[i], 10, 64)
		if e != nil {
			return raw, fmt.Errorf("invalid host CPU counter: %w", e)
		}
		raw.CPUTotal += value
		if i == 4 || i == 5 {
			raw.CPUIdle += value
		}
	}
	memory, err := r.text("proc/meminfo")
	if err != nil {
		return raw, fmt.Errorf("host memory unavailable: %w", err)
	}
	found := map[string]uint64{}
	for _, line := range strings.Split(memory, "\n") {
		parts := strings.Fields(line)
		if len(parts) < 1 || (parts[0] != "MemTotal:" && parts[0] != "MemAvailable:") {
			continue
		}
		if len(parts) != 3 || parts[2] != "kB" {
			return raw, fmt.Errorf("invalid host memory field")
		}
		v, e := strconv.ParseUint(parts[1], 10, 64)
		if e != nil || v > math.MaxUint64/1024 {
			return raw, fmt.Errorf("invalid host memory value")
		}
		found[parts[0]] = v * 1024
	}
	raw.MemoryTotal = found["MemTotal:"]
	available, ok := found["MemAvailable:"]
	if !ok || raw.MemoryTotal == 0 || available > raw.MemoryTotal {
		return raw, fmt.Errorf("missing or invalid MemTotal/MemAvailable")
	}
	raw.MemoryAvailable = available
	// The procfs hostname reflects the caller's UTS namespace. Use an explicit
	// display name or a mounted host file rather than the container hostname.
	raw.Hostname = r.Hostname
	if raw.Hostname == "" {
		raw.Hostname, _ = r.text("etc/hostname")
	}
	if up, e := r.text("proc/uptime"); e == nil {
		parts := strings.Fields(up)
		if len(parts) > 0 {
			if v, e := strconv.ParseFloat(parts[0], 64); e == nil && v >= 0 && !math.IsNaN(v) && !math.IsInf(v, 0) {
				raw.UptimeSeconds = &v
			}
		}
	}
	if err := r.network(&raw); err != nil {
		raw.Diagnostics["network"] = err.Error()
	}
	raw.CPUTemperature = r.temperature()
	if raw.CPUTemperature == nil {
		raw.Diagnostics["temperature"] = "No readable labelled CPU sensor; mount /sys at /host/sys read-only"
	}
	return raw, nil
}

func (r *Reader) network(raw *domain.Raw) error {
	// /proc/net resolves via self and would expose the container's namespace.
	routes, err := r.text("proc/1/net/route")
	if err != nil {
		return fmt.Errorf("Host network routes unavailable: %w", err)
	}
	iface := ""
	var best uint64 = math.MaxUint64
	for _, line := range strings.Split(routes, "\n") {
		f := strings.Fields(line)
		if len(f) < 8 || f[1] != "00000000" || f[7] != "00000000" {
			continue
		}
		flags, e := strconv.ParseUint(f[3], 16, 64)
		metric, me := strconv.ParseUint(f[6], 10, 64)
		if e == nil && me == nil && flags&1 != 0 && metric < best {
			iface = f[0]
			best = metric
		}
	}
	if iface == "" {
		return fmt.Errorf("No active host default IPv4 route; network rate unavailable")
	}
	data, err := r.text("proc/1/net/dev")
	if err != nil {
		return fmt.Errorf("Host network counters unavailable: %w", err)
	}
	for _, line := range strings.Split(data, "\n") {
		name, body, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(name) != iface {
			continue
		}
		f := strings.Fields(body)
		if len(f) < 16 {
			return fmt.Errorf("invalid host network counters")
		}
		rx, re := strconv.ParseUint(f[0], 10, 64)
		tx, te := strconv.ParseUint(f[8], 10, 64)
		if re != nil || te != nil {
			return fmt.Errorf("invalid host network byte counters")
		}
		raw.NetworkInterface = iface
		raw.NetworkRX = rx
		raw.NetworkTX = tx
		raw.NetworkAvailable = true
		return nil
	}
	return fmt.Errorf("Host default route interface %s has no counters", iface)
}

func (r *Reader) temperature() *float64 {
	var selected *float64
	best := 0
	devices, _ := fs.Glob(r.files, "sys/class/hwmon/hwmon*")
	for _, dir := range devices {
		driver, _ := r.text(path.Join(dir, "name"))
		if driver != "coretemp" && driver != "k10temp" && driver != "zenpower" {
			continue
		}
		sensors, _ := fs.Glob(r.files, path.Join(dir, "temp*_input"))
		for _, sensor := range sensors {
			label, _ := r.text(strings.TrimSuffix(sensor, "_input") + "_label")
			score := 0
			if strings.HasPrefix(label, "Package id ") {
				score = 3
			} else if label == "Tctl" || label == "Tdie" || label == "CPU" {
				score = 2
			} else if driver == "coretemp" && strings.HasPrefix(label, "Core ") {
				score = 1
			}
			if score == 0 {
				continue
			}
			value := r.temperatureValue(sensor)
			if value != nil && (score > best || (score == best && (selected == nil || *value > *selected))) {
				selected = value
				best = score
			}
		}
	}
	if selected != nil {
		return selected
	}
	zones, _ := fs.Glob(r.files, "sys/class/thermal/thermal_zone*")
	for _, dir := range zones {
		kind, _ := r.text(path.Join(dir, "type"))
		if kind == "x86_pkg_temp" || kind == "cpu-thermal" || kind == "cpu_thermal" {
			if value := r.temperatureValue(path.Join(dir, "temp")); value != nil && (selected == nil || *value > *selected) {
				selected = value
			}
		}
	}
	return selected
}
func (r *Reader) temperatureValue(name string) *float64 {
	text, err := r.text(name)
	if err != nil {
		return nil
	}
	v, err := strconv.ParseInt(text, 10, 64)
	if err != nil || v < 0 || v > 150000 {
		return nil
	}
	value := float64(v) / 1000
	return &value
}
