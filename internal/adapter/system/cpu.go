package system

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"

	domain "github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

// cpuCounters parses only the first eight jiffy counters with checked uint64 addition.
func cpuCounters(fields []string) (total, idle uint64, err error) {
	if len(fields) < 4 {
		return 0, 0, fmt.Errorf("invalid host CPU counters")
	}
	for i, field := range fields[:min(len(fields), 8)] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil || value > math.MaxUint64-total {
			return 0, 0, fmt.Errorf("invalid or overflowing host CPU counter")
		}
		total += value
		if i == 3 || i == 4 {
			idle += value
		}
	}
	return total, idle, nil
}

// cpuStat parses aggregate and numeric logical rows from the same mounted stat read.
func cpuStat(stat string, raw *domain.Raw) error {
	found := false
	processors := map[int]domain.CPULogicalProcessorRaw{}
	for _, line := range strings.Split(stat, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if fields[0] == "cpu" {
			if found {
				return fmt.Errorf("duplicate host aggregate CPU counters")
			}
			var err error
			raw.CPUTotal, raw.CPUIdle, err = cpuCounters(fields[1:])
			if err != nil {
				return err
			}
			found = true
			continue
		}
		suffix, ok := strings.CutPrefix(fields[0], "cpu")
		if !ok || suffix == "" || strings.Trim(suffix, "0123456789") != "" {
			continue
		}
		id, err := strconv.ParseUint(suffix, 10, 31)
		if err != nil {
			raw.Diagnostics["cpuLogicalProcessors"] = "Invalid host logical CPU ID"
			continue
		}
		item := domain.CPULogicalProcessorRaw{ID: int(id), Available: true}
		item.Total, item.Idle, err = cpuCounters(fields[1:])
		_, duplicate := processors[item.ID]
		if err != nil || duplicate {
			item.Available = false
			item.Total, item.Idle = 0, 0
			item.Reason = "Invalid host logical CPU counters"
			raw.Diagnostics["cpuLogicalProcessors"] = item.Reason
		}
		processors[item.ID] = item
	}
	if !found {
		return fmt.Errorf("invalid host CPU counters")
	}
	raw.CPULogicalProcessors = make([]domain.CPULogicalProcessorRaw, 0, len(processors))
	for _, item := range processors {
		raw.CPULogicalProcessors = append(raw.CPULogicalProcessors, item)
	}
	slices.SortFunc(raw.CPULogicalProcessors, func(a, b domain.CPULogicalProcessorRaw) int { return a.ID - b.ID })
	if len(processors) == 0 {
		raw.Diagnostics["cpuLogicalProcessors"] = "No host logical CPU counters"
	}
	return nil
}

// cpuInfo reads only mounted model names and reported MHz, never unrelated metadata.
func (r *Reader) cpuInfo(raw *domain.Raw) {
	info := &domain.CPUInfo{}
	data, err := r.text("proc/cpuinfo")
	if err == nil {
		count := 0
		mean := 0.0
		for _, line := range strings.Split(data, "\n") {
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				continue
			}
			key, value = strings.TrimSpace(key), strings.TrimSpace(value)
			switch key {
			case "model name":
				if info.Model == nil && value != "" {
					model := value
					info.Model = &model
				}
			case "cpu MHz":
				mhz, err := strconv.ParseFloat(value, 64)
				hz := mhz * 1e6
				if err != nil || hz <= 0 || math.IsNaN(hz) || math.IsInf(hz, 0) {
					raw.Diagnostics["cpuFrequency"] = "Some host reported CPU frequencies are invalid"
					continue
				}
				count++
				// Incremental averaging avoids overflowing a sum of finite positive values.
				mean += (hz - mean) / float64(count)
			}
		}
		if count > 0 {
			info.ReportedFrequencyHz = &mean
		}
	}
	if info.Model == nil {
		raw.Diagnostics["cpuModel"] = "No readable host CPU model in mounted /proc/cpuinfo"
	}
	if info.ReportedFrequencyHz == nil {
		raw.Diagnostics["cpuFrequency"] = "No valid host reported CPU frequency in mounted /proc/cpuinfo"
	}
	if count := len(raw.CPULogicalProcessors); count > 0 {
		info.LogicalCPUCount = &count
	}
	if info.Model != nil || info.ReportedFrequencyHz != nil || info.LogicalCPUCount != nil {
		raw.CPUInfo = info
	}
}
