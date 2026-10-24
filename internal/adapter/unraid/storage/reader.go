// Package storage reads only whitelisted Unraid state files and host diskstats.
package storage

import (
	"bufio"
	"context"
	"fmt"
	"io/fs"
	"math"
	"sort"
	"strconv"
	"strings"

	domain "github.com/unraid-mobile/unraid-mobile/internal/app/storage"
)

type Reader struct{ files fs.FS }

func NewReader(files fs.FS) *Reader { return &Reader{files: files} }
func (r *Reader) Read(ctx context.Context) (domain.Snapshot, error) {
	result := domain.Snapshot{Source: "unraid-state-files", Array: domain.Array{State: "unknown"}, Parity: domain.Parity{State: "unknown"}, Pools: []domain.Pool{}, Disks: []domain.Disk{}, Diagnostics: []string{}}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	data, err := fs.ReadFile(r.files, "var/local/emhttp/disks.ini")
	if err != nil {
		return result, fmt.Errorf("Storage metadata unavailable; mount /var/local/emhttp at /host/var/local/emhttp read-only: %w", err)
	}
	_, sections, err := parseINI(string(data))
	if err != nil || len(sections) == 0 {
		return result, fmt.Errorf("Invalid Unraid disks.ini metadata")
	}
	vars := map[string]string{}
	if data, err := fs.ReadFile(r.files, "var/local/emhttp/var.ini"); err == nil {
		parsed, _, err := parseINI(string(data))
		if err == nil {
			vars = parsed
		} else {
			result.Diagnostics = append(result.Diagnostics, "Array state metadata is malformed")
		}
	} else {
		result.Diagnostics = append(result.Diagnostics, "var.ini unavailable; array and parity state unknown")
	}
	switch strings.ToLower(vars["fsState"]) {
	case "started":
		result.Array.State = "started"
	case "stopped":
		result.Array.State = "stopped"
	case "starting":
		result.Array.State = "starting"
	case "stopping":
		result.Array.State = "stopping"
	}
	counters := r.diskCounters()
	if counters == nil {
		result.Diagnostics = append(result.Diagnostics, "Host disk I/O unavailable; verify the read-only /proc mount")
	}
	names := make([]string, 0, len(sections))
	for name := range sections {
		names = append(names, name)
	}
	sort.Strings(names)
	poolDisks := map[string][]domain.Disk{}
	parities := 0
	total := domain.Capacity{}
	capacityComplete := result.Array.State == "started"
	dataCount := 0
	for _, name := range names {
		entry := sections[name]
		role := strings.ToLower(entry["type"])
		if role != "data" && role != "parity" && role != "cache" {
			continue
		}
		// Empty unassigned slots must not inflate disk or capacity counts.
		if entry["device"] == "" && entry["id"] == "" && entry["idSb"] == "" && (entry["status"] == "DISK_NP" || entry["status"] == "DISK_NP_DSBL") {
			continue
		}
		disk := domain.Disk{Name: name, Device: entry["device"], Identity: entry["id"], Role: role, Status: entry["status"], PowerState: powerState(entry["spundown"]), Filesystem: entry["fsType"], FilesystemStatus: entry["fsStatus"], SizeBytes: kib(entry["size"])}
		if temp, err := strconv.ParseFloat(entry["temp"], 64); err == nil && !math.IsNaN(temp) && !math.IsInf(temp, 0) && temp >= 0 && temp <= 150 {
			disk.Temperature = &temp
		}
		if value, ok := counters[disk.Device]; ok {
			copy := value
			disk.Counters = &copy
		}
		if role != "parity" && entry["fsStatus"] == "Mounted" && (role != "data" || result.Array.State == "started") {
			disk.Capacity = capacity(entry)
			if disk.Capacity == nil && entry["fsSize"] != "" {
				result.Diagnostics = append(result.Diagnostics, name+": filesystem capacity is invalid or unavailable")
			}
		}
		switch role {
		case "data":
			dataCount++
			if disk.Capacity == nil {
				capacityComplete = false
			} else if !addCapacity(&total, *disk.Capacity) {
				capacityComplete = false
			}
		case "parity":
			parities++
		case "cache":
			disk.Pool = strings.TrimRight(name, "0123456789")
			poolDisks[disk.Pool] = append(poolDisks[disk.Pool], disk)
		}
		result.Disks = append(result.Disks, disk)
	}
	result.Array.DiskCount = dataCount
	if capacityComplete && dataCount > 0 {
		result.Array.Capacity = &total
	}
	if !capacityComplete && dataCount > 0 {
		result.Diagnostics = append(result.Diagnostics, "Array capacity unavailable until all assigned data filesystems are mounted and valid")
	}
	poolNames := make([]string, 0, len(poolDisks))
	for name := range poolDisks {
		poolNames = append(poolNames, name)
	}
	sort.Strings(poolNames)
	for _, name := range poolNames {
		members := poolDisks[name]
		pool := domain.Pool{Name: name, State: "unknown", DiskCount: len(members)}
		for _, member := range members {
			if member.Name == name {
				pool.State = member.FilesystemStatus
				pool.Filesystem = member.Filesystem
				pool.Capacity = member.Capacity
				break
			}
		}
		// A pool's filesystem is counted once; never sum mirrored member devices.
		result.Pools = append(result.Pools, pool)
	}
	if parities == 0 {
		result.Parity.State = "not_configured"
	} else if vars["mdResync"] != "" && vars["mdResyncPos"] != "" {
		active, ae := strconv.ParseUint(vars["mdResync"], 10, 64)
		position, pe := strconv.ParseUint(vars["mdResyncPos"], 10, 64)
		if ae == nil && pe == nil {
			result.Parity.State = "idle"
			if active > 0 {
				result.Parity.State = "running"
			} else if position > 0 {
				result.Parity.State = "paused"
			}
			if active > 0 || position > 0 {
				result.Parity.Action = vars["mdResyncAction"]
				size, se := strconv.ParseUint(vars["mdResyncSize"], 10, 64)
				if se == nil && size > 0 && position <= size {
					progress := 100 * float64(position) / float64(size)
					result.Parity.Progress = &progress
				}
			}
		}
	}
	return result, nil
}

func powerState(spundown string) string {
	switch spundown {
	case "0":
		return "active"
	case "1":
		return "standby"
	default:
		return "unknown"
	}
}

func kib(text string) *uint64 {
	value, err := strconv.ParseUint(text, 10, 64)
	if err != nil || value > math.MaxUint64/1024 {
		return nil
	}
	value *= 1024
	return &value
}
func capacity(entry map[string]string) *domain.Capacity {
	size, free, used := kib(entry["fsSize"]), kib(entry["fsFree"]), kib(entry["fsUsed"])
	if entry["fsUsed"] != "" && used == nil {
		return nil
	}
	if strings.TrimPrefix(entry["fsType"], "luks:") == "btrfs" && used != nil && free != nil {
		if *used > math.MaxUint64-*free {
			return nil
		}
		effective := *used + *free
		size = &effective
	}
	if size == nil || free == nil || *size == 0 || *free > *size {
		return nil
	}
	if used == nil {
		value := *size - *free
		used = &value
	}
	if *used > *size {
		return nil
	}
	return &domain.Capacity{TotalBytes: *size, UsedBytes: *used, FreeBytes: *free}
}
func addCapacity(total *domain.Capacity, c domain.Capacity) bool {
	if total.TotalBytes > math.MaxUint64-c.TotalBytes || total.UsedBytes > math.MaxUint64-c.UsedBytes || total.FreeBytes > math.MaxUint64-c.FreeBytes {
		return false
	}
	total.TotalBytes += c.TotalBytes
	total.UsedBytes += c.UsedBytes
	total.FreeBytes += c.FreeBytes
	return true
}
func (r *Reader) diskCounters() map[string]domain.Counters {
	data, err := fs.ReadFile(r.files, "proc/diskstats")
	if err != nil {
		return nil
	}
	result := map[string]domain.Counters{}
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) < 10 {
			continue
		}
		rx, re := strconv.ParseUint(f[5], 10, 64)
		tx, te := strconv.ParseUint(f[9], 10, 64)
		if re == nil && te == nil && rx <= math.MaxUint64/512 && tx <= math.MaxUint64/512 {
			result[f[2]] = domain.Counters{ReadBytes: rx * 512, WriteBytes: tx * 512}
		}
	}
	return result
}

// Parse the generated INI syntax as inert data. Never evaluate PHP, shell or
// interpolate values. Only the explicit response fields above are exported.
func parseINI(data string) (map[string]string, map[string]map[string]string, error) {
	root := map[string]string{}
	sections := map[string]map[string]string{}
	current := root
	scanner := bufio.NewScanner(strings.NewReader(strings.TrimPrefix(data, "\uFEFF")))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			if !strings.HasSuffix(line, "]") {
				return nil, nil, fmt.Errorf("invalid INI section")
			}
			name, err := iniValue(strings.TrimSpace(line[1 : len(line)-1]))
			if err != nil || name == "" {
				return nil, nil, fmt.Errorf("invalid INI section")
			}
			if _, exists := sections[name]; exists {
				return nil, nil, fmt.Errorf("duplicate INI section")
			}
			current = map[string]string{}
			sections[name] = current
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" {
			return nil, nil, fmt.Errorf("invalid INI assignment")
		}
		decoded, err := iniValue(strings.TrimSpace(value))
		if err != nil {
			return nil, nil, err
		}
		current[key] = decoded
	}
	if err := scanner.Err(); err != nil {
		return nil, nil, err
	}
	return root, sections, nil
}
func iniValue(value string) (string, error) {
	if strings.HasPrefix(value, "\"") {
		decoded, err := strconv.Unquote(value)
		if err != nil {
			return "", fmt.Errorf("invalid quoted INI value")
		}
		return decoded, nil
	}
	if strings.HasPrefix(value, "'") {
		if len(value) < 2 || !strings.HasSuffix(value, "'") {
			return "", fmt.Errorf("invalid quoted INI value")
		}
		return value[1 : len(value)-1], nil
	}
	return value, nil
}
